import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { after, before, describe, it } from "node:test";
import type { Storage } from "@observatorio/storage";
import { cutClip, publishClips, withContext } from "./clips";
import { extractFrames, runFfmpeg } from "./ffmpeg";

// A video like the phone's: 2 fps, a keyframe every 2 s, Baseline profile (so no B-frames, `-bf 0`). Frames at 0-9.5 s,
// a recording gap, then 15-24.5 s. Stream copy relies on there being no B-frames at the cut.
describe("evidence clips", () => {
  let dir: string;
  let videoPath: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "clips-test-"));
    videoPath = path.join(dir, "video.mp4");
    await runFfmpeg([
      "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=2:duration=20",
      "-vf", "setpts='(N/2+if(gte(N,20),5,0))/TB'", "-fps_mode", "passthrough",
      "-c:v", "libx264", "-profile:v", "baseline", "-pix_fmt", "yuv420p", "-g", "4", "-bf", "0", "-video_track_timescale", "1000",
      "-y", videoPath,
    ]);
  });
  after(() => rm(dir, { recursive: true, force: true }));

  const timeline = async (file: string) => {
    const out = await mkdtemp(path.join(dir, "frames-"));
    return (await extractFrames(file, out, { everySeconds: 0 })).map((frame) => frame.ptsSecond);
  };

  it("widens the evidence by the context and clamps at the start", () => {
    assert.deepEqual(withContext({ startSecond: 10, endSecond: 12 }, 3), { startSecond: 7, endSecond: 15 });
    assert.deepEqual(withContext({ startSecond: 1, endSecond: 2 }, 3), { startSecond: 0, endSecond: 5 });
  });

  it("copies the footage without re-encoding: same frames, shifted to start at zero", async () => {
    const out = path.join(dir, "one.mp4");
    await cutClip(videoPath, out, [{ startSecond: 4, endSecond: 8 }]);
    const pts = await timeline(out);
    assert.deepEqual(pts, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]); // frames 4.0 ... 7.5 of the source
  });

  it("starts at the keyframe before the cut when the start is not on one", async () => {
    const out = path.join(dir, "offkey.mp4");
    await cutClip(videoPath, out, [{ startSecond: 5, endSecond: 7 }]); // keyframes at 4 and 6
    assert.equal((await timeline(out)).length, 6); // 4.0 ... 6.5: one second of extra lead-in, never fewer frames than asked
  });

  it("concatenates several cuts in order", async () => {
    const out = path.join(dir, "two.mp4");
    await cutClip(videoPath, out, [{ startSecond: 0, endSecond: 2 }, { startSecond: 16, endSecond: 18 }]);
    // 0-2 s gives 4 frames; 16-18 s starts at the keyframe at 15 s, so 6 frames (15.0 ... 17.5)
    assert.equal((await timeline(out)).length, 10);
  });

  it("publishes a clip and its edit list per observation, and survives one failing", async () => {
    const stored = new Map<string, Buffer>();
    const storage = {
      put: async (key: string, body: Buffer | Readable) => {
        stored.set(key, Buffer.isBuffer(body) ? body : Buffer.from(await text(body)));
      },
    } as unknown as Storage;
    const source = { mediaAssetId: "m-1", sha256: "a".repeat(64), videoPath };
    const errors: unknown[] = [];
    const log = console.error;
    console.error = (...args) => void errors.push(args);
    try {
      const published = await publishClips(storage, source, [
        { id: "bad", cuts: [] }, // no cuts: fails, must not stop the next one
        { id: "good", cuts: [{ startSecond: 5, endSecond: 7 }] },
      ]);
      assert.deepEqual(published, ["good"]);
    } finally {
      console.error = log;
    }
    assert.equal(errors.length, 1);
    assert.deepEqual([...stored.keys()].sort(), ["clips/good.edl.json", "clips/good.mp4"]);
    assert.ok(stored.get("clips/good.mp4")!.length > 1000);
    const edl = JSON.parse(stored.get("clips/good.edl.json")!.toString());
    assert.deepEqual(edl.source, { media_asset_id: "m-1", sha256: "a".repeat(64) });
    assert.deepEqual(edl.cuts, [{ startSecond: 2, endSecond: 10 }]); // 3 s of context on each side
  });
});
