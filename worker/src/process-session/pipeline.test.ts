import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { analyzeSession, type SessionMedia } from "./pipeline";
import { DEFAULT_CONFIG } from "./protocol";
import { CTX, FakeModel, FIRST_FRAME_MS, makeSession } from "./test-helpers";

describe("analyzeSession on a synthetic video (Claude mocked)", () => {
  let dir: string;
  let media: SessionMedia;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pipeline-test-"));
    media = await makeSession(dir);
  });
  after(() => rm(dir, { recursive: true, force: true }));

  const config = { ...DEFAULT_CONFIG, detectionIntervalS: 2, detectionBatchSize: 5, windowPaddingS: 2, mergeGapS: 4, evidencePaddingS: 1 };

  it("samples frames with their real timestamps across the recording gap", async () => {
    const model = new FakeModel({ from: 1000, to: 1000 });
    const result = await analyzeSession(media, CTX, config, model);
    const seconds = model.requests.flatMap((request) => request.frames.map((frame) => Number(/video \+([\d.]+)/.exec(frame.caption)![1])));
    // Every 2 s of video time up to the last frame before the gap (9.5 s), then from the first one after it (15 s).
    assert.deepEqual(seconds, [0, 2, 4, 6, 8, 15, 17, 19, 21, 23]);
    assert.equal(model.requests.length, 2); // batches of 5
    assert.ok(model.requests.every((request) => request.model === "claude-haiku-5-5" && request.effort === "low"));
    assert.ok(model.requests[0].frames.every((frame) => frame.jpegBase64.startsWith("/9j/"))); // JPEG
    assert.match(model.requests[1].frames[0].caption, /device time 2026-11-21T17:00:15\.000Z/);
    assert.deepEqual(result.episodes, []);
    assert.deepEqual(result.stats.windows, []);
    assert.equal(result.usage.extraction.calls, 0);
  });

  it("detects, extracts and maps an episode to device time and evidence seconds", async () => {
    const model = new FakeModel({ from: 15, to: 18 });
    const result = await analyzeSession(media, CTX, config, model);

    assert.deepEqual(result.stats.windows, [{ startSecond: 15, endSecond: 19 }]);
    const extraction = model.requests.filter((request) => request.model === "claude-opus-5-5");
    assert.equal(extraction.length, 1);
    assert.equal(extraction[0].effort, "medium");
    assert.equal(extraction[0].frames.length, 5); // 15, 16, 17, 18, 19 (1 s step)

    assert.equal(result.episodes.length, 1);
    const [episode] = result.episodes;
    assert.equal(episode.eventTypeKey, "eating_episode");
    assert.equal(episode.startedAt.getTime(), FIRST_FRAME_MS + 15_000);
    assert.equal(episode.endedAt.getTime(), FIRST_FRAME_MS + 18_000);
    assert.deepEqual(episode.evidence, { startSecond: 15, endSecond: 19 });
    assert.deepEqual(episode.attributes, { episode_kind: "snack", visible_items: ["apple"], context: "desk" });
    assert.equal(result.usage.detection.calls, 2);
    assert.deepEqual([...result.usage.extraction.served], ["claude-opus-5-5"]);
  });

  it("separates candidate windows at a recording gap and keeps evidence on each side", async () => {
    const model = new FakeModel({ from: 6, to: 18 });
    const result = await analyzeSession(media, CTX, { ...config, mergeGapS: 30, windowPaddingS: 10 }, model);
    assert.equal(result.usage.extraction.calls, 2);
    assert.deepEqual(result.stats.windows, [{ startSecond: 0, endSecond: 9.5 }, { startSecond: 15, endSecond: 24.5 }]);
    assert.deepEqual(result.episodes.map((episode) => episode.evidence), [
      { startSecond: 5, endSecond: 9.5 },
      { startSecond: 15, endSecond: 19 },
    ]);
  });

  it("sends no frames outside observed coverage and splits episodes at coverage boundaries", async () => {
    const model = new FakeModel({ from: 0, to: 24.5 });
    const observed = [[0, 4], [5, 9.5]].map(([start, end]) => ({
      startedAt: new Date(FIRST_FRAME_MS + start * 1000),
      endedAt: new Date(FIRST_FRAME_MS + end * 1000),
    }));
    const result = await analyzeSession(media, CTX, { ...config, mergeGapS: 30 }, model, observed);
    const seconds = model.requests.flatMap((request) => request.frames.map((frame) => Number(/video \+([\d.]+)/.exec(frame.caption)![1])));
    assert.ok(seconds.every((second) => second < 4 || (second >= 5 && second < 9.5)));
    assert.equal(result.usage.extraction.calls, 2);
    assert.deepEqual(result.episodes.map((episode) => episode.evidence), [
      { startSecond: 0, endSecond: 3.5 },
      { startSecond: 5, endSecond: 9 },
    ]);
  });

  it("keeps an episode continuous across adjacent observed intervals", async () => {
    const model = new FakeModel({ from: 2, to: 6 });
    const observed = [[0, 4], [4, 9.5]].map(([start, end]) => ({
      startedAt: new Date(FIRST_FRAME_MS + start * 1000),
      endedAt: new Date(FIRST_FRAME_MS + end * 1000),
    }));
    const result = await analyzeSession(media, CTX, config, model, observed);
    assert.equal(result.usage.extraction.calls, 1);
    assert.deepEqual(result.episodes.map((episode) => episode.evidence), [{ startSecond: 1, endSecond: 7 }]);
  });

  it("drops invalid model output instead of storing it", async () => {
    const model = new FakeModel({ from: 15, to: 18 }, () => ({
      episodes: [{ event_type: "eating_episode", start_frame: 0, end_frame: 99, confidence: 0.9, visibility: "clear", attributes: {} }],
    }));
    const result = await analyzeSession(media, CTX, config, model);
    assert.deepEqual(result.episodes, []);
    assert.equal(result.stats.rejected.length, 1);
  });

  it("fails when frames.csv does not describe the video", async () => {
    const shifted = media.framesCsv.replace(/^(\d+),(\d+)/gm, (_, seq, rtc) => `${seq},${Number(rtc) + (Number(seq) > 2 ? 300 : 0)}`);
    await assert.rejects(analyzeSession({ ...media, framesCsv: shifted }, CTX, config, new FakeModel()), /matches no frames.csv row/);
  });
});
