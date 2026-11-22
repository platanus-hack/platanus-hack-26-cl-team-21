// Markdown report of an evaluation. Rates that can't be computed print "n/a", never 0.
import type { Agreement, CoverageSummary, Evaluation } from "./metrics";

/** Below this many judged truth episodes the rates swing with one episode; the report says so instead of hiding it. */
export const SMALL_SAMPLE = 10;

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const sec = (v: number | null) => (v === null ? "n/a" : `${v.toFixed(1)} s`);

export function evaluationTable(e: Evaluation): string {
  const t = e.timeError;
  return [
    "| Metric | Value |",
    "|---|---|",
    `| Truth episodes judged / total | ${e.truth.evaluated} / ${e.truth.total} (${e.truth.unobservable.length} not observed, set aside) |`,
    `| Predicted episodes | ${e.predicted} |`,
    `| True positives / false positives / false negatives | ${e.truePositives} / ${e.falsePositives} / ${e.falseNegatives} |`,
    `| Precision | ${pct(e.precision)} |`,
    `| Recall | ${pct(e.recall)} |`,
    `| F1 | ${pct(e.f1)} |`,
    `| Count error (predicted - judged truth) | ${e.countError.signed > 0 ? "+" : ""}${e.countError.signed} (absolute ${e.countError.absolute}) |`,
    `| Start time error, mean / median (${t.matched} matched) | ${sec(t.startMeanAbsSeconds)} / ${sec(t.startMedianAbsSeconds)} |`,
    `| End time error, mean / median | ${sec(t.endMeanAbsSeconds)} / ${sec(t.endMedianAbsSeconds)} |`,
  ].join("\n");
}

export function agreementLine(a: Agreement): string {
  return `${a.a} vs ${a.b} episodes, ${a.matched} matched, agreement F1 ${pct(a.f1)}; start / end error ${sec(a.timeError.startMeanAbsSeconds)} / ${sec(a.timeError.endMeanAbsSeconds)}`;
}

export function coverageTable(c: CoverageSummary): string {
  const rows = Object.entries(c.secondsByStatus).sort((a, b) => b[1] - a[1]).map(([status, seconds]) => `| ${status} | ${seconds.toFixed(0)} s |`);
  return ["| Coverage status | Time |", "|---|---|", ...rows, `| **observed share of the recorded span** | **${pct(c.observedFraction)}** of ${c.totalSeconds.toFixed(0)} s |`].join("\n");
}

export const smallSampleNote = (judged: number) =>
  judged < SMALL_SAMPLE
    ? `> Only ${judged} truth episode${judged === 1 ? "" : "s"} judged: these rates move by whole episodes and are not stable estimates. Report the counts, not just the percentages.`
    : null;
