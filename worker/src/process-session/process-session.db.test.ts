import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type * as Db from "@observatorio/db";
import { LocalDirSource, sha256File } from "./source";
import { FakeModel, FIRST_FRAME_MS, makeSession } from "./test-helpers";

// Needs a migrated and seeded database (npm run db:migrate && npm run db:seed); skipped without one.
describe("process_session against the seeded database (Claude mocked)", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, () => {
  let root: string;
  let db: typeof Db;
  let processSession: typeof import(".").processSession;
  let jobId: number;

  async function batch(recordedFrom = new Date(FIRST_FRAME_MS), recordedTo = new Date(FIRST_FRAME_MS + 24_500)) {
    const uploadId = randomUUID();
    const [participant] = await db.db.select().from(db.participants).where(db.eq(db.participants.pseudonym, "P-001"));
    const [assignment] = await db.db.select().from(db.deviceAssignments).where(db.eq(db.deviceAssignments.participantId, participant.id));
    const metadata = { participantId: participant.id, deviceId: assignment.deviceId, firmwareVersion: "cam-0.1.0", recordedFrom, recordedTo };
    await db.db.insert(db.syncBatches).values({
      id: uploadId,
      ...metadata,
      payloadSha256: randomBytes(32).toString("hex"),
      status: "processing",
      completedAt: new Date(),
      jobId,
    });
    return { uploadId, metadata };
  }

  async function upload(declaredSha256?: string) {
    const { uploadId, metadata } = await batch();
    const dir = path.join(root, uploadId);
    await mkdir(dir);
    const { videoPath, framesCsv } = await makeSession(dir, uploadId);
    const sha256 = declaredSha256 ?? await sha256File(videoPath);
    await db.db.insert(db.mediaAssets).values({
      id: uploadId,
      ...metadata,
      kind: "video",
      sha256,
      sizeBytes: 1,
      mimeType: "video/mp4",
      storageKey: `uploads/test/${uploadId}/video.mp4`,
      baseRetainUntil: new Date(Date.now() + 7 * 86_400_000),
    });
    await db.db.insert(db.syncBatchFiles).values([
      { batchId: uploadId, kind: "video", sha256, sizeBytes: 1, contentType: "video/mp4" },
      { batchId: uploadId, kind: "frames", sha256: await sha256File(path.join(dir, "frames.csv")), sizeBytes: Buffer.byteLength(framesCsv), contentType: "text/csv" },
    ]);
    return { uploadId, framesCsv };
  }

  const run = (uploadId: string, model = new FakeModel({ from: 15, to: 18 })) =>
    processSession({ id: jobId, payload: { upload_id: uploadId } }, { model, source: new LocalDirSource(root) });

  before(async () => {
    db = await import("@observatorio/db");
    ({ processSession } = await import("."));
    root = await mkdtemp(path.join(tmpdir(), "process-session-db-"));
    [{ id: jobId }] = await db.db.insert(db.jobs).values({ type: "process_session", status: "running" }).returning({ id: db.jobs.id });
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
    await db?.db.$client.end();
  });

  it("writes a run with provenance, observations and evidence, and supersedes them on a re-run", async () => {
    const { uploadId } = await upload();
    const first = await run(uploadId);
    assert.ok(first);
    assert.equal(first.observations, 1);

    const [runRow] = await db.db.select().from(db.pipelineRuns).where(db.eq(db.pipelineRuns.id, first.runId));
    assert.equal(runRow.status, "succeeded");
    assert.equal(runRow.jobId, jobId);
    assert.equal(runRow.modelProvider, "anthropic");
    assert.equal(runRow.modelName, "claude-haiku-5-5+claude-opus-5-5");
    assert.equal(runRow.modelVersion, "detect=claude-haiku-5-5;extract=claude-opus-5-5");
    assert.match(runRow.pipelineVersion, /^0\.1\.0/);
    assert.match(runRow.promptSha256!, /^[0-9a-f]{64}$/);
    assert.ok((runRow.params as { stats: unknown }).stats);
    const inputs = await db.db.select().from(db.pipelineRunInputs).where(db.eq(db.pipelineRunInputs.runId, first.runId));
    assert.deepEqual(inputs.map((input) => input.mediaAssetId), [uploadId]);

    const [observation] = await db.db.select().from(db.observations).where(db.eq(db.observations.pipelineRunId, first.runId));
    assert.equal(observation.startedAt.getTime(), FIRST_FRAME_MS + 15_000);
    assert.equal(observation.endedAt.getTime(), FIRST_FRAME_MS + 18_000);
    assert.deepEqual(observation.quality, { visibility: "clear" });
    const [evidence] = await db.db.select().from(db.observationEvidence).where(db.eq(db.observationEvidence.observationId, observation.id));
    assert.equal(evidence.mediaAssetId, uploadId);
    assert.deepEqual([evidence.startSecond, evidence.endSecond], [15, 20]);

    const second = await run(uploadId);
    assert.ok(second);
    const [superseded] = await db.db.select().from(db.observations).where(db.eq(db.observations.id, observation.id));
    assert.equal(superseded.supersededByRunId, second.runId);
    const [video] = await db.db.select().from(db.mediaAssets).where(db.eq(db.mediaAssets.id, uploadId));
    assert.equal(video.status, "processed");
    const [batch] = await db.db.select().from(db.syncBatches).where(db.eq(db.syncBatches.id, uploadId));
    assert.equal(batch.status, "processed");
  });

  it("marks the run and the video failed when the model call fails", async () => {
    const { uploadId } = await upload();
    const failing = new FakeModel();
    failing.generate = async () => {
      throw new Error("model unavailable");
    };
    await assert.rejects(run(uploadId, failing), /model unavailable/);
    const [failed] = await db.db
      .select()
      .from(db.pipelineRuns)
      .where(db.sql`${db.pipelineRuns.id} in (select run_id from pipeline_run_inputs where media_asset_id = ${uploadId})`);
    assert.equal(failed.status, "failed");
    assert.match(failed.error!, /model unavailable/);
    const [video] = await db.db.select().from(db.mediaAssets).where(db.eq(db.mediaAssets.id, uploadId));
    assert.equal(video.status, "failed");
    const [batch] = await db.db.select().from(db.syncBatches).where(db.eq(db.syncBatches.id, uploadId));
    assert.deepEqual([batch.status, batch.errorCode], ["failed", "processing_failed"]);
  });

  it("rejects a video whose hash does not match the upload, before any model call", async () => {
    const { uploadId } = await upload(randomBytes(32).toString("hex"));
    const model = new FakeModel();
    await assert.rejects(run(uploadId, model), /files_mismatch/);
    assert.equal(model.requests.length, 0);
    const [batch] = await db.db.select().from(db.syncBatches).where(db.eq(db.syncBatches.id, uploadId));
    assert.deepEqual([batch.status, batch.errorCode], ["failed", "files_mismatch"]);
  });

  it("rejects a shifted RTC even though relative frame timestamps still match the video", async () => {
    const { uploadId, framesCsv } = await upload();
    const shifted = framesCsv.replace(/^(\d+),(\d+)/gm, (_, seq, rtc) => `${seq},${Number(rtc) + 1000}`);
    await writeFile(path.join(root, uploadId, "frames.csv"), shifted);
    const model = new FakeModel();
    await assert.rejects(run(uploadId, model), /files_mismatch: frames\.csv sha256/);
    assert.equal(model.requests.length, 0);
    const [failed] = await db.db.select().from(db.syncBatches).where(db.eq(db.syncBatches.id, uploadId));
    assert.deepEqual([failed.status, failed.errorCode], ["failed", "files_mismatch"]);
  });

  it("completes a sensor-only upload without a model call and keeps its no_upload coverage", async () => {
    const recordedFrom = new Date(FIRST_FRAME_MS + 24 * 60 * 60 * 1000);
    const recordedTo = new Date(recordedFrom.getTime() + 1000);
    const { uploadId, metadata } = await batch(recordedFrom, recordedTo);
    await db.db.insert(db.syncBatchFiles).values({
      batchId: uploadId, kind: "sensors", sha256: randomBytes(32).toString("hex"), sizeBytes: 1, contentType: "text/csv",
    });
    await db.db.insert(db.coverageIntervals).values({
      batchId: uploadId, participantId: metadata.participantId, deviceId: metadata.deviceId,
      startedAt: recordedFrom, endedAt: recordedTo, status: "no_upload", source: "derived",
    });
    try {
      const model = new FakeModel();
      assert.equal(await run(uploadId, model), null);
      assert.equal(model.requests.length, 0);
      const [completed] = await db.db.select().from(db.syncBatches).where(db.eq(db.syncBatches.id, uploadId));
      assert.equal(completed.status, "processed");
      const [coverage] = await db.db.select().from(db.coverageIntervals).where(db.eq(db.coverageIntervals.batchId, uploadId));
      assert.equal(coverage.status, "no_upload");
    } finally {
      await db.db.delete(db.coverageIntervals).where(db.eq(db.coverageIntervals.batchId, uploadId));
    }
  });

  it("fails an upload that declared a video but has no video record", async () => {
    const { uploadId } = await batch();
    await db.db.insert(db.syncBatchFiles).values({
      batchId: uploadId, kind: "video", sha256: randomBytes(32).toString("hex"), sizeBytes: 1, contentType: "video/mp4",
    });
    await assert.rejects(run(uploadId), /has no video/);
    const [failed] = await db.db.select().from(db.syncBatches).where(db.eq(db.syncBatches.id, uploadId));
    assert.equal(failed.status, "failed");
  });

  it("rejects payloads without a uuid upload_id or without a video", async () => {
    await assert.rejects(processSession({ id: jobId, payload: { upload_id: "../etc" } }), /uuid upload_id/);
    await assert.rejects(run(randomUUID()), /has no video/);
  });
});
