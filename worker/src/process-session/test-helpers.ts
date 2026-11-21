import { writeFile } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "./ffmpeg";
import type { JsonModel, JsonRequest, JsonResponse } from "./model";
import type { ProtocolContext } from "./protocol";

// Same attribute schema the seed gives eating-v1's event types.
export const ATTRIBUTES_SCHEMA = {
  type: "object",
  required: ["episode_kind", "visible_items", "context"],
  properties: {
    episode_kind: { enum: ["meal", "snack", "drink"] },
    visible_items: { type: "array", items: { type: "string" } },
    context: { enum: ["seated_table", "desk", "standing", "walking", "kitchen"] },
  },
};

export const CTX: ProtocolContext = {
  protocolVersionId: "00000000-0000-4000-8000-000000000001",
  versionLabel: "eating-v1",
  definition: { out_of_scope: ["calories", "portion_weight", "nutrients"] },
  eventTypes: [
    { id: "00000000-0000-4000-8000-000000000002", key: "drinking_episode", label: "Drinking episode", attributesSchema: ATTRIBUTES_SCHEMA },
    { id: "00000000-0000-4000-8000-000000000003", key: "eating_episode", label: "Eating episode", attributesSchema: ATTRIBUTES_SCHEMA },
  ],
};

export const FIRST_FRAME_MS = Date.parse("2026-11-21T14:00:00.000-03:00");

/**
 * A synthetic session like the phone uploads: 2 fps, variable frame rate, 20 frames over 0–9.5 s, a
 * recording gap, then 20 frames over 15–24.5 s. frames.csv rows match the video frames.
 */
export async function makeSession(dir: string, tag = "test") {
  const videoPath = path.join(dir, "video.mp4");
  await runFfmpeg([
    "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=2:duration=20",
    "-vf", "setpts='(N/2+if(gte(N,20),5,0))/TB'",
    "-fps_mode", "passthrough",
    "-metadata", `comment=${tag}`, // different tags give files with different hashes
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "4", "-video_track_timescale", "1000",
    "-y", videoPath,
  ]);
  const rows = Array.from({ length: 40 }, (_, i) => {
    const second = i / 2 + (i >= 20 ? 5 : 0);
    return `${i + 1},${FIRST_FRAME_MS + second * 1000},${100_000 + second * 1000},20000`;
  });
  const framesCsv = ["seq,rtc_epoch_ms,uptime_ms,bytes", ...rows].join("\n") + "\n";
  await writeFile(path.join(dir, "frames.csv"), framesCsv);
  return { videoPath, framesCsv };
}

const videoSecondOf = (caption: string) => Number(/video \+([\d.]+) s/.exec(caption)![1]);

/**
 * Fake Claude: "sees" an eating episode between video seconds `from` and `to`. Detection flags the frames
 * inside it; extraction reports one episode spanning the first and last frame inside it.
 */
export class FakeModel implements JsonModel {
  requests: JsonRequest[] = [];
  constructor(private episode = { from: 15, to: 18 }, private extractionOverride?: (request: JsonRequest) => unknown) {}

  async generate(request: JsonRequest): Promise<JsonResponse> {
    this.requests.push(request);
    const inside = request.frames.map((frame) => {
      const second = videoSecondOf(frame.caption);
      return second >= this.episode.from && second <= this.episode.to;
    });
    let output: unknown;
    if ("frames" in (request.schema.properties as object)) {
      output = { frames: inside.map((hit, index) => ({ index, event_type: hit ? "eating_episode" : "none" })) };
    } else if (this.extractionOverride) {
      output = this.extractionOverride(request);
    } else {
      const first = inside.indexOf(true);
      output = {
        episodes:
          first < 0
            ? []
            : [
                {
                  event_type: "eating_episode",
                  start_frame: first,
                  end_frame: inside.lastIndexOf(true),
                  confidence: 0.8,
                  visibility: "clear",
                  attributes: { episode_kind: "snack", visible_items: ["apple"], context: "desk" },
                },
              ],
      };
    }
    return { output, servedModel: request.model, usage: { inputTokens: 100 * request.frames.length, outputTokens: 50 } };
  }
}
