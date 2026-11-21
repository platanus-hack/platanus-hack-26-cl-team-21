// One real end-to-end run against the seeded DB and the Claude API (costs money: a few cents).
//   npm run smoke -w worker                                   # synthetic 25 s test video
//   npm run smoke -w worker -- <video.mp4> <frames.csv>       # a real session bundle
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, deviceAssignments, eq, jobs, mediaAssets, observations, participants, syncBatchFiles, syncBatches } from "@observatorio/db";
import { processSession } from ".";
import { LocalDirSource, sha256File } from "./source";
import { makeSession } from "./test-helpers";

const [videoArg, framesArg] = process.argv.slice(2);
const root = await mkdtemp(path.join(tmpdir(), "process-session-smoke-"));
try {
  const staging = path.join(root, "staging");
  await mkdir(staging);
  if (videoArg && framesArg) {
    await copyFile(videoArg, path.join(staging, "video.mp4"));
    await copyFile(framesArg, path.join(staging, "frames.csv"));
  } else {
    await makeSession(staging, "smoke");
  }
  const videoPath = path.join(staging, "video.mp4");
  const sha256 = await sha256File(videoPath);
  const framesPath = path.join(staging, "frames.csv");
  const framesCsv = await readFile(framesPath);
  const rtcs = framesCsv.toString("utf8").trim().split("\n").slice(1).map((line) => Number(line.split(",")[1]));

  const [participant] = await db.select().from(participants).where(eq(participants.pseudonym, "P-001"));
  const [assignment] = await db.select().from(deviceAssignments).where(eq(deviceAssignments.participantId, participant.id));
  const [existing] = await db.select({ id: mediaAssets.id, storageKey: mediaAssets.storageKey }).from(mediaAssets).where(eq(mediaAssets.sha256, sha256));
  if (existing && !existing.storageKey?.startsWith("smoke/")) throw new Error("video already belongs to a non-smoke upload");
  const uploadId = existing?.id ?? crypto.randomUUID();
  const recordedFrom = new Date(rtcs[0]);
  const recordedTo = new Date(rtcs.at(-1)!);
  const videoBytes = (await stat(videoPath)).size;
  if (!existing) {
    await db.insert(mediaAssets).values({
      id: uploadId,
      participantId: participant.id,
      deviceId: assignment.deviceId,
      firmwareVersion: "smoke",
      kind: "video",
      recordedFrom,
      recordedTo,
      sha256,
      sizeBytes: videoBytes,
      mimeType: "video/mp4",
      storageKey: `smoke/${uploadId}/video.mp4`,
      baseRetainUntil: new Date(Date.now() + 7 * 86_400_000),
    });
  }
  await mkdir(path.join(root, uploadId));
  await copyFile(videoPath, path.join(root, uploadId, "video.mp4"));
  await writeFile(path.join(root, uploadId, "frames.csv"), framesCsv);

  const payload = { upload_id: uploadId };
  const [job] = await db.insert(jobs).values({ type: "process_session", payload, status: "running" }).returning();
  await db.insert(syncBatches).values({
    id: uploadId, participantId: participant.id, deviceId: assignment.deviceId, firmwareVersion: "smoke",
    recordedFrom, recordedTo, payloadSha256: sha256, completedAt: new Date(), status: "processing", jobId: job.id,
  }).onConflictDoNothing({ target: syncBatches.id });
  await db.insert(syncBatchFiles).values([
    { batchId: uploadId, kind: "video", sha256, sizeBytes: videoBytes, contentType: "video/mp4" },
    { batchId: uploadId, kind: "frames", sha256: await sha256File(framesPath), sizeBytes: framesCsv.length, contentType: "text/csv" },
  ]).onConflictDoNothing();
  const result = await processSession(job, { source: new LocalDirSource(root) }).catch(async (error) => {
    await db.update(jobs).set({ status: "failed", error: String(error), updatedAt: new Date() }).where(eq(jobs.id, job.id));
    throw error;
  });
  await db.update(jobs).set({ status: "done", updatedAt: new Date() }).where(eq(jobs.id, job.id));

  if (!result) throw new Error("smoke video did not produce a pipeline run");
  const rows = await db.select().from(observations).where(eq(observations.pipelineRunId, result.runId));
  const { detection, extraction } = result.result.usage;
  console.log(JSON.stringify({ runId: result.runId, uploadId, observations: rows, stats: result.result.stats }, null, 2));
  for (const [pass, use] of Object.entries({ detection, extraction })) {
    console.log(`${pass}: ${use.calls} calls, ${use.inputTokens} input + ${use.outputTokens} output tokens, served by ${[...use.served].join(", ") || "-"}`);
  }
} finally {
  await rm(root, { recursive: true, force: true });
  await db.$client.end();
}
