import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deriveCoverage, frameRuns } from "./coverage";

const range = (rows: ReturnType<typeof deriveCoverage>) => rows.map((r) => `${r.status}:${r.start}-${r.end}`);

describe("deriveCoverage", () => {
  test("splits frame runs at gaps above 2 s and ignores a lone frame", () => {
    assert.deepEqual(frameRuns([0, 500, 1000, 4000, 4500, 9000]), [{ start: 0, end: 1000 }, { start: 4000, end: 4500 }]);
  });

  test("gives every instant one status, with privacy over exclusion over observed", () => {
    const rows = deriveCoverage({
      from: 0,
      to: 10_000,
      privacy: [{ start: 7000, end: 8000 }],
      excluded: [{ start: 3000, end: 5000 }, { start: 7500, end: 8500 }],
      frameTimesMs: [0, 500, 1000, 1500, 2000, 2500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10_000],
      hasVideo: true,
    });
    assert.deepEqual(range(rows), [
      "observed:0-2500",
      "device_off:2500-3000",
      "excluded_by_participant:3000-5000",
      "observed:5000-7000",
      "privacy_switch:7000-8000",
      "excluded_by_participant:8000-8500",
      "observed:8500-10000",
    ]);
  });

  test("clips to the recorded range and marks a video-less upload no_upload after privacy and exclusions", () => {
    const rows = deriveCoverage({ from: 1000, to: 5000, privacy: [{ start: 0, end: 2000 }], excluded: [{ start: 4000, end: 9000 }], frameTimesMs: [], hasVideo: false });
    assert.deepEqual(range(rows), ["privacy_switch:1000-2000", "no_upload:2000-4000", "excluded_by_participant:4000-5000"]);
  });
});
