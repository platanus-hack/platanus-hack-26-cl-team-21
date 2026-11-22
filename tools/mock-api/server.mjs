import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const STUDY_ID = "study-eating-001";
const PROTOCOL_VERSION = "eating-v1";
const ENROLLMENT_CODES = {
  "EAT-001-P00": { participant_id: "p-00", used: true },
  "EAT-001-P01": { participant_id: "p-01", used: false },
  "EAT-001-P02": { participant_id: "p-02", used: false },
  "EAT-001-P03": { participant_id: "p-03", used: false },
};
const FILE_EXTENSIONS = { video: "mp4", frames: "csv", sensors: "csv", events: "csv", manifest: "json" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ISO_WITH_OFFSET_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const FAILING_SESSION_PREFIX = "fail";
const MAX_JSON_BYTES = 1024 * 1024;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const invalid = (message) => new ApiError(400, "invalid_request", message);
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const isTimestamp = (value) => typeof value === "string" && ISO_WITH_OFFSET_PATTERN.test(value) && !Number.isNaN(Date.parse(value));

export function createMockApi({ dataDir, processingDelayMs = 3000, urlTtlSeconds = 3600 }) {
  const codes = structuredClone(ENROLLMENT_CODES);
  const participantsByToken = new Map();
  const uploads = new Map();

  function sendJson(response, status, body) {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }

  async function readJson(request) {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) throw invalid("Body too large");
      chunks.push(chunk);
    }
    if (chunks.length === 0) return {};
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error();
      return body;
    } catch {
      throw invalid("Body must be a JSON object");
    }
  }

  function authenticate(request) {
    const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "");
    const participant = match && participantsByToken.get(match[1]);
    if (!participant) throw new ApiError(401, "unauthorized", "Missing or invalid participant token");
    return participant;
  }

  function findOwnUpload(participant, uploadId) {
    if (!UUID_PATTERN.test(uploadId)) throw invalid("upload_id must be a UUID");
    const upload = uploads.get(uploadId.toLowerCase());
    if (!upload || upload.participant_id !== participant.participant_id) {
      throw new ApiError(404, "upload_not_found", "Unknown upload_id");
    }
    return upload;
  }

  async function enroll(request, response) {
    const { code, device_id } = await readJson(request);
    if (!isNonEmptyString(code)) throw invalid("code is required");
    if (device_id !== undefined && !isNonEmptyString(device_id)) throw invalid("device_id must be a non-empty string");
    const entry = Object.hasOwn(codes, code) ? codes[code] : undefined;
    if (!entry) throw new ApiError(404, "enrollment_code_not_found", "Unknown enrollment code");
    if (entry.used) throw new ApiError(409, "enrollment_code_used", "Enrollment code was already used");
    entry.used = true;
    const participantToken = randomBytes(24).toString("hex");
    participantsByToken.set(participantToken, { participant_id: entry.participant_id, device_id });
    sendJson(response, 201, {
      participant_id: entry.participant_id,
      study_id: STUDY_ID,
      protocol_version: PROTOCOL_VERSION,
      participant_token: participantToken,
    });
  }

  function validateUploadBody(body) {
    if (!isNonEmptyString(body.upload_id) || !UUID_PATTERN.test(body.upload_id)) throw invalid("upload_id must be a UUID");
    for (const field of ["device_id", "firmware_version", "device_session_id"]) {
      if (!isNonEmptyString(body[field])) throw invalid(`${field} is required`);
    }
    for (const field of ["recorded_from", "recorded_to"]) {
      if (!isTimestamp(body[field])) throw invalid(`${field} must be an ISO 8601 timestamp with offset`);
    }
    if (Date.parse(body.recorded_from) > Date.parse(body.recorded_to)) throw invalid("recorded_from must not be after recorded_to");
    if (!Array.isArray(body.files) || body.files.length === 0) throw invalid("files must be a non-empty array");
    const seenKinds = new Set();
    for (const file of body.files) {
      if (!file || !Object.hasOwn(FILE_EXTENSIONS, file.kind)) throw invalid(`file kind must be one of ${Object.keys(FILE_EXTENSIONS).join(", ")}`);
      if (seenKinds.has(file.kind)) throw invalid(`Duplicate file kind ${file.kind}`);
      seenKinds.add(file.kind);
      if (typeof file.sha256 !== "string" || !SHA256_PATTERN.test(file.sha256)) throw invalid(`${file.kind}.sha256 must be 64 lowercase hex characters`);
      if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) throw invalid(`${file.kind}.bytes must be a non-negative integer`);
      if (!isNonEmptyString(file.content_type)) throw invalid(`${file.kind}.content_type is required`);
    }
  }

  function canonicalUploadBody(body) {
    return JSON.stringify({
      upload_id: body.upload_id.toLowerCase(),
      device_id: body.device_id,
      firmware_version: body.firmware_version,
      device_session_id: body.device_session_id,
      recorded_from: body.recorded_from,
      recorded_to: body.recorded_to,
      files: body.files.map(({ kind, sha256, bytes, content_type }) => ({ kind, sha256, bytes, content_type })),
    });
  }

  function storageKey(upload, kind) {
    return `uploads/${STUDY_ID}/${upload.participant_id}/${upload.upload_id}/${kind}.${FILE_EXTENSIONS[kind]}`;
  }

  function issuePutUrls(request, upload) {
    const expiresAt = new Date(Date.now() + urlTtlSeconds * 1000);
    const expires = Math.floor(expiresAt.getTime() / 1000);
    return upload.files.map(({ kind }) => {
      const signature = randomBytes(16).toString("hex");
      upload.signatures.set(kind, { signature, expires });
      const putUrl = `http://${request.headers.host}/storage/${storageKey(upload, kind)}?expires=${expires}&signature=${signature}`;
      return { kind, put_url: putUrl, expires_at: expiresAt.toISOString() };
    });
  }

  async function createUpload(request, response) {
    const participant = authenticate(request);
    const body = await readJson(request);
    validateUploadBody(body);
    const uploadId = body.upload_id.toLowerCase();
    const canonicalBody = canonicalUploadBody(body);
    const existing = uploads.get(uploadId);
    if (existing) {
      if (existing.participant_id !== participant.participant_id || existing.canonicalBody !== canonicalBody) {
        throw new ApiError(409, "upload_conflict", "upload_id was already used with a different body");
      }
      return sendJson(response, 200, { upload_id: uploadId, files: issuePutUrls(request, existing) });
    }
    const upload = {
      upload_id: uploadId,
      participant_id: participant.participant_id,
      device_session_id: body.device_session_id,
      canonicalBody,
      files: body.files.map(({ kind, sha256, bytes }) => ({ kind, sha256, bytes })),
      signatures: new Map(),
      status: "awaiting_files",
    };
    uploads.set(uploadId, upload);
    sendJson(response, 201, { upload_id: uploadId, files: issuePutUrls(request, upload) });
  }

  async function receiveObject(request, response, url) {
    const match = /^\/storage\/uploads\/[^/]+\/[^/]+\/([^/]+)\/([a-z]+)\.[a-z0-9]+$/.exec(url.pathname);
    const upload = match && uploads.get(match[1]);
    const kind = match?.[2];
    if (!upload || !Object.hasOwn(FILE_EXTENSIONS, kind) || url.pathname !== `/storage/${storageKey(upload, kind)}`) {
      throw new ApiError(404, "object_not_found", "Unknown storage key");
    }
    const issued = upload.signatures.get(kind);
    if (!issued || url.searchParams.get("signature") !== issued.signature || url.searchParams.get("expires") !== String(issued.expires)) {
      throw new ApiError(403, "invalid_signature", "PUT URL signature does not match");
    }
    if (Date.now() / 1000 > issued.expires) throw new ApiError(403, "url_expired", "PUT URL has expired");
    if (upload.status !== "awaiting_files") throw new ApiError(409, "upload_already_completed", "Upload was already completed");
    const destination = path.join(dataDir, storageKey(upload, kind));
    const partial = `${destination}.${randomUUID()}.part`;
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await pipeline(request, createWriteStream(partial));
      await rename(partial, destination);
    } finally {
      await rm(partial, { force: true });
    }
    response.writeHead(200).end();
  }

  async function sha256Of(filePath) {
    const hash = createHash("sha256");
    await pipeline(createReadStream(filePath), hash);
    return hash.digest("hex");
  }

  async function findFileProblems(upload) {
    const missing = [];
    const mismatched = [];
    for (const file of upload.files) {
      const filePath = path.join(dataDir, storageKey(upload, file.kind));
      const info = await stat(filePath).catch(() => null);
      if (!info) missing.push(file.kind);
      else if (info.size !== file.bytes || (await sha256Of(filePath)) !== file.sha256) mismatched.push(file.kind);
    }
    return { missing, mismatched };
  }

  function validateExcludedIntervals(body) {
    const intervals = body.excluded_intervals ?? [];
    if (!Array.isArray(intervals)) throw invalid("excluded_intervals must be an array");
    for (const interval of intervals) {
      if (!interval || !isTimestamp(interval.start) || !isTimestamp(interval.end)) {
        throw invalid("Each excluded interval needs ISO 8601 start and end with offset");
      }
      if (Date.parse(interval.start) >= Date.parse(interval.end)) throw invalid("Excluded interval start must be before end");
    }
    return intervals;
  }

  async function completeUpload(request, response, uploadId) {
    const participant = authenticate(request);
    const upload = findOwnUpload(participant, uploadId);
    const excludedIntervals = validateExcludedIntervals(await readJson(request));
    if (upload.status !== "awaiting_files") {
      return sendJson(response, 202, { upload_id: upload.upload_id, status: upload.status, job_id: upload.job_id });
    }
    const { missing, mismatched } = await findFileProblems(upload);
    if (missing.length > 0) throw new ApiError(409, "files_missing", `Missing files: ${missing.join(", ")}`);
    if (mismatched.length > 0) throw new ApiError(409, "files_mismatch", `Size or sha256 mismatch: ${mismatched.join(", ")}`);
    upload.excluded_intervals = excludedIntervals;
    upload.status = "processing";
    upload.job_id = randomUUID();
    setTimeout(() => {
      upload.status = upload.device_session_id.startsWith(FAILING_SESSION_PREFIX) ? "failed" : "processed";
    }, processingDelayMs).unref();
    sendJson(response, 202, { upload_id: upload.upload_id, status: upload.status, job_id: upload.job_id });
  }

  function getUpload(request, response, uploadId) {
    const upload = findOwnUpload(authenticate(request), uploadId);
    const error = upload.status === "failed" ? { code: "processing_failed", message: "Mock processing failure" } : undefined;
    sendJson(response, 200, { upload_id: upload.upload_id, status: upload.status, error });
  }

  async function route(request, response) {
    const url = new URL(request.url, "http://mock");
    const uploadMatch = /^\/api\/v1\/uploads\/([^/]+)(\/complete)?$/.exec(url.pathname);
    if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { ok: true });
    if (request.method === "POST" && url.pathname === "/api/v1/enrollments") return enroll(request, response);
    if (request.method === "POST" && url.pathname === "/api/v1/uploads") return createUpload(request, response);
    if (request.method === "POST" && uploadMatch?.[2]) return completeUpload(request, response, uploadMatch[1]);
    if (request.method === "GET" && uploadMatch && !uploadMatch[2]) return getUpload(request, response, uploadMatch[1]);
    if (request.method === "PUT" && url.pathname.startsWith("/storage/")) return receiveObject(request, response, url);
    throw new ApiError(404, "not_found", `No route for ${request.method} ${url.pathname}`);
  }

  return http.createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      if (!(error instanceof ApiError)) console.error(error);
      const apiError = error instanceof ApiError ? error : new ApiError(500, "internal_error", "Unexpected error");
      if (response.headersSent) return response.destroy();
      request.resume();
      sendJson(response, apiError.status, { error: { code: apiError.code, message: apiError.message } });
    }
  });
}
