import {
  and,
  db,
  devices,
  eq,
  jobs,
  ne,
  sql,
  syncBatchFiles,
  syncBatches,
} from "@observatorio/db";
import { createHash } from "node:crypto";
import { createStorage, uploadFileKey, UPLOAD_FILES, type UploadFileKind } from "@observatorio/storage";
import { ApiError, errorResponse, invalidRequest, isNonEmptyString, readJsonObject } from "./errors";
import { ingestSession, purgeFailedUploads } from "./ingest";
import { authenticateParticipant } from "./participant-token";

type Participant = Awaited<ReturnType<typeof authenticateParticipant>>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const CONTENT_TYPES: Record<UploadFileKind, string> = {
  video: "video/mp4",
  frames: "text/csv",
  sensors: "text/csv",
  events: "text/csv",
  manifest: "application/json",
};
const KINDS = Object.keys(UPLOAD_FILES) as UploadFileKind[];
// A whole-clip exclusion uploads no video, so only these are always required; `video` and `frames` come as a pair.
const REQUIRED_KINDS: UploadFileKind[] = ["sensors", "events", "manifest"];
// Short on purpose (MON-27): a late PUT to an old URL could leave an orphan object after a retry deleted its upload.
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

interface DeclaredFile {
  kind: UploadFileKind;
  sha256: string;
  bytes: number;
  contentType: string;
}

const isTimestamp = (value: unknown): value is string => typeof value === "string" && TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));

// POST /api/v1/uploads (ADR 0002 §2): registers the declared files and returns presigned PUT URLs.
export async function createUpload(request: Request) {
  try {
    const participant = await authenticateParticipant(request);
    const body = await readJsonObject(request);
    const upload = parseUploadBody(body);

    // shortcut: v0 only checks the device exists, not that it is assigned to this participant (accepted in ADR 0002, §2).
    const [device] = await db.select({ id: devices.id }).from(devices).where(eq(devices.serial, upload.deviceSerial));
    if (!device) throw invalidRequest("Unknown device_id");

    const manifest = upload.files.find((file) => file.kind === "manifest")!;
    const storage = createStorage();
    const staleKeys: string[] = [];
    const inserted = await db.transaction(async (tx) => {
      const [overlap] = await tx
        .select({ id: syncBatches.id })
        .from(syncBatches)
        .where(
          and(
            eq(syncBatches.participantId, participant.participantId),
            ne(syncBatches.id, upload.id),
            ne(syncBatches.status, "failed"),
            sql`${syncBatches.recordedFrom} < ${upload.recordedTo}::timestamptz and ${syncBatches.recordedTo} > ${upload.recordedFrom}::timestamptz`,
          ),
        )
        .limit(1);
      if (overlap) throw new ApiError(409, "upload_conflict", "Recorded range overlaps another upload");
      staleKeys.push(...(await purgeFailedUploads(tx, participant, upload.deviceSessionId, upload.recordedFrom, upload.recordedTo)));

      // Also swallows the (device, payload hash) unique violation; the lookup below turns it into a 409.
      const [row] = await tx
        .insert(syncBatches)
        .values({
          id: upload.id,
          deviceId: device.id,
          participantId: participant.participantId,
          firmwareVersion: upload.firmwareVersion,
          recordedFrom: new Date(upload.recordedFrom),
          recordedTo: new Date(upload.recordedTo),
          payloadSha256: manifest.sha256,
          rawStorageKey: uploadFileKey(participant.studyId, participant.participantId, upload.id, "manifest").replace(/manifest\.json$/, ""),
          deviceSessionId: upload.deviceSessionId,
        })
        .onConflictDoNothing()
        .returning({ id: syncBatches.id });
      if (row) {
        await tx.insert(syncBatchFiles).values(upload.files.map((file) => ({ batchId: upload.id, kind: file.kind, sha256: file.sha256, sizeBytes: file.bytes, contentType: file.contentType as never })));
      }
      return Boolean(row);
    });

    // After the commit, so a failed delete can't undo the database cleanup; `delete` is idempotent.
    await Promise.all(staleKeys.map((key) => storage.delete(key)));
    if (!inserted) await assertSameUpload(participant, upload, device.id);
    const files = await presignFiles(storage, participant, upload.id, upload.files);
    return Response.json({ upload_id: upload.id, files }, { status: inserted ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/v1/uploads/{id}/complete: checks the objects exist with the declared size, records the
// participant's exclusions as coverage and enqueues the `process_session` job.
export async function completeUpload(request: Request, uploadId: string) {
  try {
    const participant = await authenticateParticipant(request);
    const batch = await findOwnBatch(participant, uploadId);
    const excluded = parseExcludedIntervals(await readJsonObject(request));

    if (batch.status === "awaiting_files") {
      const storage = createStorage();
      const declared = await db.select().from(syncBatchFiles).where(eq(syncBatchFiles.batchId, batch.id));
      const problems = { missing: [] as string[], mismatched: [] as string[] };
      for (const file of declared) {
        const info = await storage.head(uploadFileKey(participant.studyId, participant.participantId, batch.id, file.kind));
        if (!info) problems.missing.push(file.kind);
        else if (info.size !== file.sizeBytes) problems.mismatched.push(file.kind);
      }
      if (problems.missing.length) throw new ApiError(409, "files_missing", `Missing files: ${problems.missing.join(", ")}`);
      if (problems.mismatched.length) throw new ApiError(409, "files_mismatch", `Size mismatch: ${problems.mismatched.join(", ")}`);

      const text = Object.fromEntries(
        await Promise.all(
          (["frames", "sensors", "events", "manifest"] as const).map(async (kind) => {
            const file = declared.find((f) => f.kind === kind);
            if (!file) return [kind, ""]; // frames of an upload with no video

            if (file.sizeBytes > MAX_TEXT_FILE_BYTES) throw invalidRequest(`${kind} is too large`);
            const content = await readText(storage, uploadFileKey(participant.studyId, participant.participantId, batch.id, kind));
            if (createHash("sha256").update(content).digest("hex") !== file.sha256) throw new ApiError(409, "files_mismatch", `sha256 mismatch: ${kind}`);
            return [kind, content];
          }),
        ),
      ) as Record<"frames" | "sensors" | "events" | "manifest", string>;
      assertSameExclusions(text.manifest, excluded);

      const video = declared.find((f) => f.kind === "video");
      const [device] = await db.select({ serial: devices.serial }).from(devices).where(eq(devices.id, batch.deviceId));
      await db.transaction(async (tx) => {
        // Lock the row so two concurrent `complete` calls enqueue a single job.
        const [locked] = await tx.select({ status: syncBatches.status }).from(syncBatches).where(eq(syncBatches.id, batch.id)).for("update");
        if (locked.status !== "awaiting_files") return;
        await ingestSession(tx, {
          batchId: batch.id,
          studyId: participant.studyId,
          participantId: participant.participantId,
          deviceId: batch.deviceId,
          deviceSerial: device.serial,
          firmwareVersion: batch.firmwareVersion,
          recordedFrom: batch.recordedFrom,
          recordedTo: batch.recordedTo,
          video: video && { sha256: video.sha256, bytes: video.sizeBytes, storageKey: uploadFileKey(participant.studyId, participant.participantId, batch.id, "video") },
          frames: text.frames,
          sensors: text.sensors,
          events: text.events,
          excluded: excluded.map((i) => ({ start: Date.parse(i.start), end: Date.parse(i.end) })),
        });
        const [job] = await tx.insert(jobs).values({ type: "process_session", payload: { upload_id: batch.id } }).returning({ id: jobs.id });
        await tx.update(syncBatches).set({ status: "processing", completedAt: sql`now()`, jobId: job.id }).where(eq(syncBatches.id, batch.id));
      });
    }

    const current = await findOwnBatch(participant, uploadId);
    return Response.json({ upload_id: current.id, status: current.status, job_id: current.jobId }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

// GET /api/v1/uploads/{id}
export async function getUpload(request: Request, uploadId: string) {
  try {
    const batch = await findOwnBatch(await authenticateParticipant(request), uploadId);
    const error = batch.status === "failed" ? { code: batch.errorCode, message: batch.errorMessage } : undefined;
    return Response.json({ upload_id: batch.id, status: batch.status, error });
  } catch (error) {
    return errorResponse(error);
  }
}

async function findOwnBatch(participant: Participant, uploadId: string) {
  if (!UUID_PATTERN.test(uploadId)) throw invalidRequest("upload_id must be a UUID");
  const [batch] = await db
    .select()
    .from(syncBatches)
    .where(and(eq(syncBatches.id, uploadId.toLowerCase()), eq(syncBatches.participantId, participant.participantId)));
  if (!batch) throw new ApiError(404, "upload_not_found", "Unknown upload_id");
  return batch;
}

function parseUploadBody(body: Record<string, unknown>) {
  const { upload_id, device_id, firmware_version, device_session_id, recorded_from, recorded_to, files } = body;
  if (typeof upload_id !== "string" || !UUID_PATTERN.test(upload_id)) throw invalidRequest("upload_id must be a UUID");
  if (!isNonEmptyString(device_id)) throw invalidRequest("device_id is required");
  if (!isNonEmptyString(firmware_version)) throw invalidRequest("firmware_version is required");
  if (!isNonEmptyString(device_session_id)) throw invalidRequest("device_session_id is required");
  if (!isTimestamp(recorded_from) || !isTimestamp(recorded_to)) throw invalidRequest("recorded_from and recorded_to must be ISO 8601 timestamps with offset");
  if (Date.parse(recorded_from) > Date.parse(recorded_to)) throw invalidRequest("recorded_from must not be after recorded_to");
  if (!Array.isArray(files)) throw invalidRequest("files must be an array");

  const declared = new Map<UploadFileKind, DeclaredFile>();
  for (const file of files) {
    const { kind, sha256, bytes, content_type: contentType } = (file ?? {}) as Record<string, unknown>;
    if (typeof kind !== "string" || !KINDS.includes(kind as UploadFileKind)) throw invalidRequest(`file kind must be one of ${KINDS.join(", ")}`);
    if (declared.has(kind as UploadFileKind)) throw invalidRequest(`Duplicate file kind ${kind}`);
    if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) throw invalidRequest(`${kind}.sha256 must be 64 lowercase hex characters`);
    if (!Number.isSafeInteger(bytes) || (bytes as number) <= 0) throw invalidRequest(`${kind}.bytes must be a positive integer`);
    if (contentType !== CONTENT_TYPES[kind as UploadFileKind]) throw invalidRequest(`${kind}.content_type must be ${CONTENT_TYPES[kind as UploadFileKind]}`);
    declared.set(kind as UploadFileKind, { kind: kind as UploadFileKind, sha256, bytes: bytes as number, contentType });
  }
  const missing = REQUIRED_KINDS.filter((kind) => !declared.has(kind));
  if (missing.length) throw invalidRequest(`files must declare: ${missing.join(", ")}`);
  if (declared.has("video") !== declared.has("frames")) throw invalidRequest("video and frames must be declared together");

  return {
    id: upload_id.toLowerCase(),
    deviceSerial: device_id,
    firmwareVersion: firmware_version,
    deviceSessionId: device_session_id,
    recordedFrom: recorded_from,
    recordedTo: recorded_to,
    files: KINDS.flatMap((kind) => declared.get(kind) ?? []),
  };
}

// Same upload_id must carry the same body; anything else is a conflict (409).
async function assertSameUpload(participant: Participant, upload: ReturnType<typeof parseUploadBody>, deviceId: string) {
  const [stored] = await db.select().from(syncBatches).where(eq(syncBatches.id, upload.id));
  const files = stored ? await db.select().from(syncBatchFiles).where(eq(syncBatchFiles.batchId, upload.id)) : [];
  const same =
    stored &&
    stored.participantId === participant.participantId &&
    stored.deviceId === deviceId &&
    stored.firmwareVersion === upload.firmwareVersion &&
    stored.deviceSessionId === upload.deviceSessionId &&
    stored.recordedFrom.getTime() === Date.parse(upload.recordedFrom) &&
    stored.recordedTo.getTime() === Date.parse(upload.recordedTo) &&
    files.length === upload.files.length &&
    upload.files.every((file) => files.some((f) => f.kind === file.kind && f.sha256 === file.sha256 && f.sizeBytes === file.bytes));
  if (!same) throw new ApiError(409, "upload_conflict", "upload_id was already used with a different body");
}

async function presignFiles(storage: ReturnType<typeof createStorage>, participant: Participant, uploadId: string, files: DeclaredFile[]) {
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
  return Promise.all(
    files.map(async (file) => ({
      kind: file.kind,
      put_url: await storage.presignPut(uploadFileKey(participant.studyId, participant.participantId, uploadId, file.kind), {
        contentType: file.contentType,
        contentLength: file.bytes,
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      }),
      expires_at: expiresAt,
    })),
  );
}

function parseExcludedIntervals(body: Record<string, unknown>) {
  const intervals = body.excluded_intervals ?? [];
  if (!Array.isArray(intervals)) throw invalidRequest("excluded_intervals must be an array");
  return intervals.map((interval) => {
    const { start, end } = (interval ?? {}) as Record<string, unknown>;
    if (!isTimestamp(start) || !isTimestamp(end)) throw invalidRequest("Each excluded interval needs ISO 8601 start and end with offset");
    if (Date.parse(start) >= Date.parse(end)) throw invalidRequest("Excluded interval start must be before end");
    return { start, end };
  });
}

const MAX_TEXT_FILE_BYTES = 20 * 1024 * 1024;

async function readText(storage: ReturnType<typeof createStorage>, key: string) {
  const chunks: Buffer[] = [];
  for await (const chunk of await storage.getStream(key)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

// ADR 0002 §1: the excluded intervals in the manifest and in `complete` must be identical.
function assertSameExclusions(manifestJson: string, excluded: { start: string; end: string }[]) {
  const instants = (list: { start: string; end: string }[]) => list.map((i) => `${Date.parse(i.start)}-${Date.parse(i.end)}`).sort().join(",");
  let inManifest: { start: string; end: string }[] = [];
  try {
    inManifest = JSON.parse(manifestJson).excluded_intervals ?? [];
  } catch {
    throw new ApiError(409, "files_mismatch", "manifest is not valid JSON");
  }
  if (!Array.isArray(inManifest) || instants(inManifest) !== instants(excluded)) {
    throw new ApiError(409, "files_mismatch", "excluded_intervals differ between the manifest and complete");
  }
}
