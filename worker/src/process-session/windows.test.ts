import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeCandidateWindows, samplingStep } from "./windows";

const labels = (candidates: number[], every = 5, until = 300) =>
  Array.from({ length: until / every + 1 }, (_, i) => ({ videoSecond: i * every, candidate: candidates.includes(i * every) }));

describe("mergeCandidateWindows", () => {
  const opts = { maxGapSeconds: 30, paddingSeconds: 10, durationSeconds: 300 };

  it("returns no windows without candidates", () => {
    assert.deepEqual(mergeCandidateWindows(labels([]), opts), []);
  });

  it("joins candidates closer than the gap and pads the run", () => {
    assert.deepEqual(mergeCandidateWindows(labels([100, 105, 130]), opts), [{ startSecond: 90, endSecond: 140 }]);
  });

  it("keeps runs further apart than the gap separate", () => {
    assert.deepEqual(mergeCandidateWindows(labels([100, 200]), opts), [
      { startSecond: 90, endSecond: 110 },
      { startSecond: 190, endSecond: 210 },
    ]);
  });

  it("merges runs whose padded ranges touch, so no footage is analyzed twice", () => {
    const windows = mergeCandidateWindows(labels([100, 135]), { ...opts, maxGapSeconds: 20, paddingSeconds: 20 });
    assert.deepEqual(windows, [{ startSecond: 80, endSecond: 155 }]);
  });

  it("clips padding to the video and accepts unsorted input", () => {
    const input = labels([0, 300]).reverse();
    assert.deepEqual(mergeCandidateWindows(input, opts), [
      { startSecond: 0, endSecond: 10 },
      { startSecond: 290, endSecond: 300 },
    ]);
  });
});

describe("samplingStep", () => {
  it("uses the minimum step for short windows", () => {
    assert.equal(samplingStep({ startSecond: 0, endSecond: 10 }, 1, 24), 1);
  });

  it("spreads long windows over at most maxFrames frames", () => {
    const step = samplingStep({ startSecond: 0, endSecond: 230 }, 1, 24);
    assert.equal(step, 10);
    assert.ok(Math.floor(230 / step) + 1 <= 24);
  });
});
