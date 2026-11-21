import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractFrames, type ExtractedFrame } from "./ffmpeg";
import { buildTimeline, frameAt, observedSegments, parseFramesCsv, type ObservedInterval, type ObservedSegment, type Timeline } from "./frames";
import type { FrameImage, JsonModel, Usage } from "./model";
import {
  detectionSchema,
  detectionSystemPrompt,
  extractionSchema,
  extractionSystemPrompt,
  type PipelineConfig,
  type ProtocolContext,
} from "./protocol";
import { attributeValidators, type Episode, readDetection, readExtraction, type Rejected } from "./validate";
import { mergeCandidateWindows, samplingStep, type FrameLabel, type Window } from "./windows";

export type SessionMedia = { videoPath: string; framesCsv: string };

/** One observation ready to store: device times from frames.csv, evidence as seconds of the video. */
export type DetectedEpisode = Omit<Episode, "startFrame" | "endFrame"> & {
  startedAt: Date;
  endedAt: Date;
  evidence: { startSecond: number; endSecond: number };
};

export type ModelUse = { requested: string; served: Set<string>; calls: number } & Usage;

export type AnalysisResult = {
  episodes: DetectedEpisode[];
  stats: {
    videoFrames: number;
    videoDurationS: number;
    detectionFrames: number;
    detectionUnlabeled: number;
    candidateFrames: number;
    windows: Window[];
    extractionFrames: number;
    rejected: Rejected[];
  };
  usage: { detection: ModelUse; extraction: ModelUse };
};

type SampledFrame = ExtractedFrame & { index: number; videoSecond: number; deviceTime: Date };

async function sample(media: SessionMedia, timeline: Timeline, workDir: string, name: string, opts: Parameters<typeof extractFrames>[2]) {
  const outDir = path.join(workDir, name);
  await mkdir(outDir);
  const frames = await extractFrames(media.videoPath, outDir, opts);
  return frames.map((frame): SampledFrame => ({ ...frame, ...frameAt(timeline, frame.ptsSecond) }));
}

async function toImages(frames: SampledFrame[], timeline: Timeline): Promise<FrameImage[]> {
  return Promise.all(
    frames.map(async (frame, i) => ({
      caption: `Frame ${i} | video +${frame.videoSecond.toFixed(1)} s of ${timeline.durationSeconds.toFixed(1)} s | device time ${frame.deviceTime.toISOString()}`,
      jpegBase64: (await readFile(frame.path)).toString("base64"),
    })),
  );
}

function track(use: ModelUse, response: { servedModel: string; usage: Usage }) {
  use.calls++;
  use.served.add(response.servedModel);
  use.inputTokens += response.usage.inputTokens;
  use.outputTokens += response.usage.outputTokens;
}

/**
 * The model-facing part of process_session, with no database access:
 * 1. sample frames every `detectionIntervalS` and map each back to device time through frames.csv;
 * 2. detection pass (cheap model) over batches of frames → candidate frames → merged, padded windows;
 * 3. extraction pass (detailed model) per window on denser frames → episodes with protocol attributes;
 * 4. validate every episode and turn frame indices into device times and evidence offsets.
 * Claude only ever receives still images; evidence offsets point into the original, unmodified video.
 */
export async function analyzeSession(media: SessionMedia, ctx: ProtocolContext, config: PipelineConfig, model: JsonModel, observed?: readonly ObservedInterval[]): Promise<AnalysisResult> {
  const timeline = buildTimeline(parseFramesCsv(media.framesCsv));
  const segments = observedSegments(timeline, observed);
  const usage = {
    detection: { requested: config.detectionModel, served: new Set<string>(), calls: 0, inputTokens: 0, outputTokens: 0 },
    extraction: { requested: config.extractionModel, served: new Set<string>(), calls: 0, inputTokens: 0, outputTokens: 0 },
  };
  const workDir = await mkdtemp(path.join(tmpdir(), "process-session-"));
  try {
    const sampledDetectionFrames = await sample(media, timeline, workDir, "detection", {
      everySeconds: config.detectionIntervalS,
      width: config.detectionImageWidth,
    });

    let segmentIndex = 0;
    const detectionFrames = sampledDetectionFrames.flatMap((frame) => {
      while (segments[segmentIndex] && frame.index > segments[segmentIndex].lastFrame) segmentIndex++;
      const segment = segments[segmentIndex];
      return segment && frame.index >= segment.firstFrame ? [{ ...frame, segment }] : [];
    });
    const candidates: boolean[] = [];
    let detectionUnlabeled = 0;
    const system = detectionSystemPrompt(ctx);
    const schema = detectionSchema(ctx);
    for (let start = 0; start < detectionFrames.length; start += config.detectionBatchSize) {
      const batch = detectionFrames.slice(start, start + config.detectionBatchSize);
      const response = await model.generate({
        model: config.detectionModel,
        system,
        frames: await toImages(batch, timeline),
        instruction: `Label each of the ${batch.length} frames above (indices 0 to ${batch.length - 1}).`,
        schema,
        effort: "low",
      });
      track(usage.detection, response);
      const read = readDetection(response.output, ctx, batch.length);
      candidates.push(...read.candidates);
      detectionUnlabeled += read.unlabeled;
    }

    const labelsBySegment = new Map<ObservedSegment, FrameLabel[]>();
    for (const [index, frame] of detectionFrames.entries()) {
      const labels = labelsBySegment.get(frame.segment) ?? [];
      labels.push({ videoSecond: frame.videoSecond, candidate: candidates[index] });
      labelsBySegment.set(frame.segment, labels);
    }
    const extractionWindows = [...labelsBySegment].flatMap(([segment, labels]) =>
      mergeCandidateWindows(labels, {
        maxGapSeconds: config.mergeGapS,
        paddingSeconds: config.windowPaddingS,
        durationSeconds: segment.endSecond,
      }).map((window) => ({
        segment,
        window: { ...window, startSecond: Math.max(segment.startSecond, window.startSecond) },
      })),
    );

    const episodes: DetectedEpisode[] = [];
    const rejected: Rejected[] = [];
    const validators = attributeValidators(ctx);
    let extractionFrames = 0;
    for (const [w, { segment, window }] of extractionWindows.entries()) {
      const sampled = await sample(media, timeline, workDir, `window-${w}`, {
        everySeconds: samplingStep(window, config.extractionIntervalS, config.extractionMaxFrames),
        fromSecond: window.startSecond,
        toSecond: window.endSecond,
        width: config.extractionImageWidth,
      });
      const frames = sampled.filter((frame) => frame.index >= segment.firstFrame && frame.index <= segment.lastFrame);
      if (frames.length === 0) continue;
      extractionFrames += frames.length;
      const response = await model.generate({
        model: config.extractionModel,
        system: extractionSystemPrompt(ctx),
        frames: await toImages(frames, timeline),
        instruction: `Report the episodes visible in the ${frames.length} frames above (indices 0 to ${frames.length - 1}).`,
        schema: extractionSchema(ctx),
        effort: "medium",
      });
      track(usage.extraction, response);
      const read = readExtraction(response.output, ctx, frames.length, validators);
      rejected.push(...read.rejected);
      for (const { startFrame, endFrame, ...episode } of read.episodes) {
        const first = frames[startFrame];
        const last = frames[endFrame];
        const startSecond = Math.max(segment.startSecond, first.videoSecond - config.evidencePaddingS);
        const endSecond = Math.min(segment.endSecond, last.videoSecond + config.evidencePaddingS);
        episodes.push({ ...episode, startedAt: first.deviceTime, endedAt: last.deviceTime, evidence: { startSecond, endSecond } });
      }
    }

    return {
      episodes,
      stats: {
        videoFrames: timeline.rows.length,
        videoDurationS: timeline.durationSeconds,
        detectionFrames: detectionFrames.length,
        detectionUnlabeled,
        candidateFrames: candidates.filter(Boolean).length,
        windows: extractionWindows.map(({ window }) => window),
        extractionFrames,
        rejected,
      },
      usage,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
