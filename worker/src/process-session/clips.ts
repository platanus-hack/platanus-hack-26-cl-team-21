import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { clipEdlKey, clipKey, type Storage } from "@observatorio/storage";
import { runFfmpeg } from "./ffmpeg";

/** Seconds of the original video kept before and after the evidence, so a reviewer sees what led to the episode. */
export const CLIP_CONTEXT_SECONDS = 3;

export type Cut = { startSecond: number; endSecond: number };

/** Evidence widened by the context and clamped at the start of the video. */
export const withContext = (cut: Cut, context = CLIP_CONTEXT_SECONDS): Cut => ({
  startSecond: Math.max(0, cut.startSecond - context),
  endSecond: cut.endSecond + context,
});

/**
 * Cuts authentic footage into one MP4, never re-rendering it: the video stream is copied, so each cut starts at the
 * keyframe at or before its start (the phone encodes a keyframe at least every 2 s) and the picture is untouched.
 * Several cuts are concatenated in order.
 */
export async function cutClip(videoPath: string, outPath: string, cuts: Cut[]) {
  if (cuts.length === 0) throw new Error("a clip needs at least one cut");
  const dir = await mkdtemp(path.join(tmpdir(), "clip-"));
  try {
    const parts: string[] = [];
    for (const [i, cut] of cuts.entries()) {
      const part = path.join(dir, `part-${i}.mp4`);
      await runFfmpeg([
        "-loglevel", "error",
        "-ss", String(cut.startSecond),
        "-i", videoPath,
        "-t", String(cut.endSecond - cut.startSecond),
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        "-y", cuts.length === 1 ? outPath : part,
      ]);
      parts.push(part);
    }
    if (cuts.length > 1) {
      const list = path.join(dir, "list.txt");
      await writeFile(list, parts.map((part) => `file '${part}'`).join("\n"));
      await runFfmpeg(["-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", "-y", outPath]);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type ClipSource = { mediaAssetId: string; sha256: string; videoPath: string };
export type ClipObservation = { id: string; cuts: Cut[] };

/**
 * Publishes one clip per observation at `clips/<observation_id>.mp4`, with its edit list (the source video's hash and
 * the cuts, evidence plus context) next to it. The clip is a cache derived from the evidence: it needs no database
 * row, and a failure here must not fail the run, so errors are reported and the next observation goes on.
 * Returns the ids of the observations whose clip was published.
 */
export async function publishClips(storage: Storage, source: ClipSource, observations: ClipObservation[]): Promise<string[]> {
  const published: string[] = [];
  const dir = await mkdtemp(path.join(tmpdir(), "clips-"));
  try {
    for (const observation of observations) {
      try {
        const cuts = observation.cuts.map((cut) => withContext(cut));
        const out = path.join(dir, `${observation.id}.mp4`);
        await cutClip(source.videoPath, out, cuts);
        await storage.put(clipKey(observation.id), createReadStream(out), { contentType: "video/mp4", contentLength: (await stat(out)).size });
        const edl = { observation_id: observation.id, source: { media_asset_id: source.mediaAssetId, sha256: source.sha256 }, context_seconds: CLIP_CONTEXT_SECONDS, cuts };
        await storage.put(clipEdlKey(observation.id), Buffer.from(JSON.stringify(edl)), { contentType: "application/json" });
        published.push(observation.id);
      } catch (error) {
        console.error(`clip for observation ${observation.id} was not published: ${error instanceof Error ? error.message : error}`);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return published;
}
