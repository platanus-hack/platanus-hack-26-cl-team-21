import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTimeline, frameAt, nearestFrame, parseFramesCsv } from "./frames";

const T0 = 1795280400000;
const csv = (rtcs: number[], header = true) =>
  [...(header ? ["seq,rtc_epoch_ms,uptime_ms,bytes"] : []), ...rtcs.map((rtc, i) => `${i + 1},${rtc},${i * 500},1000`)].join("\n");

describe("parseFramesCsv", () => {
  it("parses rows with or without a header", () => {
    assert.deepEqual(parseFramesCsv(csv([T0, T0 + 500])), [
      { seq: 1, rtcEpochMs: T0 },
      { seq: 2, rtcEpochMs: T0 + 500 },
    ]);
    assert.equal(parseFramesCsv(csv([T0, T0 + 500], false) + "\n\n").length, 2);
  });

  it("rejects empty files, bad rows and a clock that does not increase", () => {
    assert.throws(() => parseFramesCsv("seq,rtc_epoch_ms,uptime_ms,bytes\n"), /no frames/);
    assert.throws(() => parseFramesCsv(csv([T0, 0])), /invalid row/);
    assert.throws(() => parseFramesCsv(csv([T0, T0])), /not increasing/);
  });
});

describe("timeline", () => {
  // 2 fps, then a 5 s gap (e.g. privacy switch) before the last two frames.
  const timeline = buildTimeline(parseFramesCsv(csv([T0, T0 + 500, T0 + 1000, T0 + 6000, T0 + 6500])));

  it("maps each row to its video second (pts = rtc - first rtc)", () => {
    assert.deepEqual(timeline.videoSeconds, [0, 0.5, 1, 6, 6.5]);
    assert.equal(timeline.durationSeconds, 6.5);
  });

  it("finds the nearest frame, also across the gap", () => {
    assert.equal(nearestFrame(timeline, 0.74), 1);
    assert.equal(nearestFrame(timeline, 0.76), 2);
    assert.equal(nearestFrame(timeline, 3), 2);
    assert.equal(nearestFrame(timeline, 100), 4);
    assert.equal(nearestFrame(timeline, -1), 0);
  });

  it("returns the device time of a decoded frame from frames.csv", () => {
    const frame = frameAt(timeline, 6.001);
    assert.equal(frame.index, 3);
    assert.equal(frame.videoSecond, 6);
    assert.equal(frame.deviceTime.getTime(), T0 + 6000);
  });

  it("refuses a pts that matches no row: video and frames.csv disagree", () => {
    assert.throws(() => frameAt(timeline, 3.5), /matches no frames.csv row/);
  });
});
