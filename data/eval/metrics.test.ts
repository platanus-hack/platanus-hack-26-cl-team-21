import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { agreement, evaluate, iou, matchEpisodes, observedFraction, summarizeCoverage } from "./metrics";

const s = (seconds: number) => seconds * 1000;
const ep = (start: number, end: number) => ({ start: s(start), end: s(end) });

describe("matching", () => {
  test("iou is the shared time over the union", () => {
    assert.equal(iou(ep(0, 10), ep(5, 15)), 5 / 15);
    assert.equal(iou(ep(0, 10), ep(10, 20)), 0);
    assert.equal(iou(ep(0, 10), ep(2, 8)), 0.6);
  });

  test("matches one-to-one by the highest overlap, so a split prediction counts one hit and one false positive", () => {
    const { matches, unmatchedCandidate, unmatchedReference } = matchEpisodes([ep(0, 100)], [ep(0, 60), ep(60, 100)], 0.3);
    assert.deepEqual(matches.map((m) => [m.reference, m.candidate]), [[0, 0]]);
    assert.deepEqual(unmatchedCandidate, [1]);
    assert.deepEqual(unmatchedReference, []);
  });

  test("does not match below the IoU threshold", () => {
    assert.equal(matchEpisodes([ep(0, 10)], [ep(8, 30)], 0.5).matches.length, 0);
  });
});

describe("evaluate", () => {
  test("scores a perfect run", () => {
    const r = evaluate({ truth: [ep(0, 60), ep(300, 360)], predicted: [ep(0, 60), ep(300, 360)] });
    assert.deepEqual([r.precision, r.recall, r.f1], [1, 1, 1]);
    assert.deepEqual(r.countError, { signed: 0, absolute: 0 });
    assert.equal(r.timeError.startMeanAbsSeconds, 0);
  });

  test("counts a miss and a false positive, and measures start and end error on the hits", () => {
    const r = evaluate({
      truth: [ep(0, 60), ep(300, 360), ep(900, 960)],
      predicted: [ep(2, 64), ep(305, 355), ep(2000, 2050)], // two hits (errors 2/4 s and 5/5 s), one extra, one missed
    });
    assert.deepEqual([r.truePositives, r.falsePositives, r.falseNegatives], [2, 1, 1]);
    assert.equal(r.precision, 2 / 3);
    assert.equal(r.recall, 2 / 3);
    assert.equal(r.f1, 2 / 3);
    assert.deepEqual(r.countError, { signed: 0, absolute: 0 });
    assert.equal(r.timeError.startMeanAbsSeconds, 3.5);
    assert.equal(r.timeError.endMeanAbsSeconds, 4.5);
    assert.equal(r.timeError.startMedianAbsSeconds, 3.5);
  });

  test("reports a count error with its sign", () => {
    const r = evaluate({ truth: [ep(0, 60)], predicted: [ep(0, 60), ep(100, 160), ep(200, 260)] });
    assert.deepEqual(r.countError, { signed: 2, absolute: 2 });
  });

  test("never turns an undefined rate into zero", () => {
    const none = evaluate({ truth: [ep(0, 60)], predicted: [] });
    assert.equal(none.precision, null);
    assert.equal(none.recall, 0);
    assert.equal(none.f1, null);
    const nothingToFind = evaluate({ truth: [], predicted: [ep(0, 60)] });
    assert.equal(nothingToFind.recall, null);
    assert.equal(nothingToFind.precision, 0);
    assert.equal(evaluate({ truth: [ep(0, 60)], predicted: [ep(500, 560)] }).f1, 0);
  });

  test("a truth episode that was not observed is set aside, not counted as a miss", () => {
    const observed = [ep(0, 100), ep(400, 1000)]; // privacy switch / excluded clip from 100 to 400
    const r = evaluate({ truth: [ep(10, 50), ep(200, 260), ep(380, 440)], predicted: [ep(10, 50)], observed });
    // The middle one is entirely unobserved. The third is 40 of its 60 s observed, so it is judged (and missed).
    assert.deepEqual(r.truth, { total: 3, evaluated: 2, unobservable: [1] });
    assert.deepEqual([r.truePositives, r.falseNegatives], [1, 1]);
    assert.equal(r.recall, 0.5);
  });
});

describe("observation and coverage", () => {
  test("observedFraction is the observed share of the episode", () => {
    assert.equal(observedFraction(ep(90, 110), [ep(0, 100)]), 0.5);
  });

  test("summarizes seconds per status inside the recorded span, without inventing observed time", () => {
    const c = summarizeCoverage(
      [{ ...ep(0, 600), status: "observed" }, { ...ep(600, 700), status: "privacy_switch" }, { ...ep(700, 1300), status: "observed" }],
      s(0),
      s(1000),
    );
    assert.deepEqual(c.secondsByStatus, { observed: 900, privacy_switch: 100 });
    assert.equal(c.observedFraction, 0.9);
    assert.equal(summarizeCoverage([], s(0), s(1000)).observedFraction, 0); // no rows: not observed
  });
});

describe("agreement", () => {
  test("is symmetric and compares two runs", () => {
    const run1 = [ep(0, 60), ep(300, 360)];
    const run2 = [ep(1, 61), ep(900, 960)];
    const forward = agreement(run1, run2);
    const backward = agreement(run2, run1);
    assert.equal(forward.matched, 1);
    assert.equal(forward.f1, 0.5);
    assert.equal(backward.f1, 0.5);
    assert.equal(agreement([], []).f1, null);
  });
});
