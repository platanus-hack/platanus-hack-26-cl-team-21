import { createHash } from "node:crypto";
import { and, gt, isNull, lte, ne, or } from "drizzle-orm";
import {
  coverageIntervals,
  db,
  eq,
  eventTypes,
  mediaAssets,
  observationEvidence,
  observations,
  participantProtocols,
  pipelineRunInputs,
  pipelineRuns,
  protocolVersions,
  sql,
  syncBatchFiles,
  syncBatches,
} from "@observatorio/db";
import { AnthropicJsonModel, type JsonModel } from "./model";
import { type AnalysisResult, analyzeSession, type ModelUse } from "./pipeline";
import { type PipelineConfig, type ProtocolContext, promptSha256, resolveConfig } from "./protocol";
import { sha256File, type SessionSource, sourceFromEnv } from "./source";

// Bump on any change to how results are produced (prompts, sampling, merging, validation).
export const PIPELINE_VERSION = "0.1.0";
const pipelineVersion = () => {
  const commit = process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT;
  return commit ? `${PIPELINE_VERSION}+${commit.slice(0, 12)}` : PIPELINE_VERSION;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProcessSessionDeps = { model?: JsonModel; source?: SessionSource };

export async function loadProtocolContext(protocolVersionId: string): Promise<ProtocolContext> {
  const [version] = await db.select().from(protocolVersions).where(eq(protocolVersions.id, protocolVersionId));
  const types = await db.select().from(eventTypes).where(eq(eventTypes.protocolVersionId, protocolVersionId)).orderBy(eventTypes.key);
  if (types.length === 0) throw new Error(`protocol ${version.versionLabel} has no event types`);
  return {
    protocolVersionId,
    versionLabel: version.versionLabel,
    definition: version.definition as Record<string, unknown>,
    eventTypes: types.map((type) => ({ ...type, attributesSchema: type.attributesSchema as Record<string, unknown> })),
  };
}

/** The participant's protocol version in force when the video started. */
async function protocolAt(participantId: string, at: Date) {
  const [row] = await db
    .select({ id: participantProtocols.protocolVersionId })
    .from(participantProtocols)
    .where(
      and(
        eq(participantProtocols.participantId, participantId),
        lte(participantProtocols.validFrom, at),
        or(isNull(participantProtocols.validTo), gt(participantProtocols.validTo, at)),
      ),
    );
  if (!row) throw new Error(`participant ${participantId} has no protocol assigned at ${at.toISOString()}`);
  return row.id;
}

const modelSummary = (use: ModelUse) => (use.calls ? [...use.served].sort().join("|") : "unused");

/**
 * process_session job (payload `{ upload_id }`): analyzes the upload's video and writes a
 * pipeline run, its observations and their evidence. Re-running supersedes the previous run's
 * observations for that video; nothing is updated in place.
 */
export async function processSession(job: { id: number; payload: unknown }, deps: ProcessSessionDeps = {}) {
  const uploadId = (job.payload as { upload_id?: unknown } | null)?.upload_id;
  if (typeof uploadId !== "string" || !UUID.test(uploadId)) throw new Error("process_session payload needs a uuid upload_id");
  try {
    return await runPipeline(uploadId, job.id, deps);
  } catch (error) {
    await markUploadFailed(uploadId, error);
    throw error;
  }
}

export class FilesMismatchError extends Error {}

/** The upload status the app polls. Uploads still awaiting files are never touched. */
function uploadInProgress(uploadId: string) {
  return and(eq(syncBatches.id, uploadId), ne(syncBatches.status, "awaiting_files"));
}

async function markUploadFailed(uploadId: string, error: unknown) {
  await db
    .update(syncBatches)
    .set({ status: "failed", errorCode: error instanceof FilesMismatchError ? "files_mismatch" : "processing_failed", errorMessage: String(error) })
    .where(uploadInProgress(uploadId));
}

async function runPipeline(uploadId: string, jobId: number, deps: ProcessSessionDeps) {
  const [video] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, uploadId), eq(mediaAssets.kind, "video")));
  const declarations = await db.select().from(syncBatchFiles).where(eq(syncBatchFiles.batchId, uploadId));
  const declaredVideo = declarations.find((file) => file.kind === "video");
  if (!video && !declaredVideo && declarations.length > 0) {
    const [completed] = await db.update(syncBatches)
      .set({ status: "processed", errorCode: null, errorMessage: null })
      .where(and(eq(syncBatches.id, uploadId), or(eq(syncBatches.status, "processing"), eq(syncBatches.status, "processed"))))
      .returning({ id: syncBatches.id });
    if (completed) return null;
  }
  if (!video) throw new Error(`upload ${uploadId} has no video`);
  const declaredFrames = declarations.find((file) => file.kind === "frames");
  if (!declaredVideo || !declaredFrames) throw new FilesMismatchError(`upload ${uploadId} is missing video or frames.csv declarations`);
  if (!video.storageKey) throw new Error(`video ${uploadId} was deleted (${video.deletionReason})`);

  const ctx = await loadProtocolContext(await protocolAt(video.participantId, video.recordedFrom));
  const config = resolveConfig(ctx);
  const media = await (deps.source ?? sourceFromEnv()).fetch(uploadId);
  try {
    const actual = await sha256File(media.videoPath);
    if (actual !== video.sha256 || actual !== declaredVideo.sha256) {
      throw new FilesMismatchError(`files_mismatch: video sha256 does not match upload ${uploadId}`);
    }
    if (createHash("sha256").update(media.framesCsv).digest("hex") !== declaredFrames.sha256) {
      throw new FilesMismatchError(`files_mismatch: frames.csv sha256 does not match upload ${uploadId}`);
    }
    const coverage = await db.select().from(coverageIntervals)
      .where(eq(coverageIntervals.batchId, uploadId))
      .orderBy(coverageIntervals.startedAt);
    const observed = coverage.length > 0 ? coverage.filter((interval) => interval.status === "observed") : undefined;

    const [run] = await db
      .insert(pipelineRuns)
      .values({
        protocolVersionId: ctx.protocolVersionId,
        jobId,
        trigger: "upload",
        modelProvider: "anthropic",
        modelName: `${config.detectionModel}+${config.extractionModel}`,
        modelVersion: "pending",
        promptSha256: promptSha256(ctx),
        params: { config },
        pipelineVersion: pipelineVersion(),
        status: "running",
        startedAt: new Date(),
      })
      .returning({ id: pipelineRuns.id });
    await db.insert(pipelineRunInputs).values({ runId: run.id, mediaAssetId: video.id });
    await db.update(mediaAssets).set({ status: "processing" }).where(eq(mediaAssets.id, video.id));

    try {
      const result = await analyzeSession(
        { videoPath: media.videoPath, framesCsv: media.framesCsv.toString("utf8") },
        ctx,
        config,
        deps.model ?? new AnthropicJsonModel(),
        observed,
      );
      await store(run.id, video, ctx, config, result);
      return { runId: run.id, observations: result.episodes.length, result };
    } catch (error) {
      await db.update(pipelineRuns).set({ status: "failed", finishedAt: new Date(), error: String(error) }).where(eq(pipelineRuns.id, run.id));
      await db.update(mediaAssets).set({ status: "failed" }).where(eq(mediaAssets.id, video.id));
      throw error;
    }
  } finally {
    await media.cleanup?.();
  }
}

/** Writes the run's observations and evidence, and closes the run, in one transaction. */
async function store(
  runId: string,
  video: typeof mediaAssets.$inferSelect,
  ctx: ProtocolContext,
  config: PipelineConfig,
  result: AnalysisResult,
) {
  const typeIds = new Map(ctx.eventTypes.map((type) => [type.key, type.id]));
  await db.transaction(async (tx) => {
    // Earlier current observations of this video are superseded by this run (the only allowed update).
    await tx
      .update(observations)
      .set({ supersededByRunId: runId })
      .where(
        and(
          isNull(observations.supersededByRunId),
          sql`${observations.id} in (select ${observationEvidence.observationId} from ${observationEvidence} where ${observationEvidence.mediaAssetId} = ${video.id})`,
        ),
      );
    for (const episode of result.episodes) {
      const [observation] = await tx
        .insert(observations)
        .values({
          participantId: video.participantId,
          pipelineRunId: runId,
          eventTypeId: typeIds.get(episode.eventTypeKey)!,
          startedAt: episode.startedAt,
          endedAt: episode.endedAt,
          attributes: episode.attributes,
          confidence: episode.confidence,
          quality: { visibility: episode.visibility },
        })
        .returning({ id: observations.id });
      await tx.insert(observationEvidence).values({ observationId: observation.id, mediaAssetId: video.id, ...episode.evidence });
    }
    const { detection, extraction } = result.usage;
    await tx
      .update(pipelineRuns)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        modelVersion: `detect=${modelSummary(detection)};extract=${modelSummary(extraction)}`,
        params: {
          config,
          stats: result.stats,
          usage: Object.fromEntries(Object.entries(result.usage).map(([pass, use]) => [pass, { ...use, served: [...use.served] }])),
        },
      })
      .where(eq(pipelineRuns.id, runId));
    await tx.update(mediaAssets).set({ status: "processed" }).where(eq(mediaAssets.id, video.id));
    await tx.update(syncBatches).set({ status: "processed", errorCode: null, errorMessage: null }).where(uploadInProgress(video.id));
  });
}
