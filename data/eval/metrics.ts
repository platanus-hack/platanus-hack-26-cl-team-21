// Evaluation of the pipeline against annotated ground truth (AGENTS.md §6). Pure: times are epoch ms, intervals [start, end).

export interface Interval {
  start: number;
  end: number;
}

/** An episode: an eating or drinking event with its start and end. */
export type Episode = Interval;

export interface CoverageInterval extends Interval {
  status: string;
}

export const DEFAULT_MIN_IOU = 0.5;
/** A truth episode with less than this share of its time observed can't be judged: the pipeline never saw it. */
export const DEFAULT_MIN_OBSERVED_FRACTION = 0.5;

const length = (i: Interval) => Math.max(0, i.end - i.start);
const overlap = (a: Interval, b: Interval) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** Temporal intersection over union. */
export function iou(a: Interval, b: Interval): number {
  const shared = overlap(a, b);
  const union = length(a) + length(b) - shared;
  return union > 0 ? shared / union : 0;
}

export interface Match {
  reference: number; // index into the reference list
  candidate: number; // index into the candidate list
  iou: number;
}

/**
 * One-to-one matching: the pairs with the highest IoU first, each episode used once, only pairs with IoU >= minIoU.
 * (Greedy by IoU is the standard for detection metrics; ties go to the earlier episode.)
 */
export function matchEpisodes(reference: Episode[], candidate: Episode[], minIoU = DEFAULT_MIN_IOU) {
  const pairs: Match[] = [];
  for (const [r, ref] of reference.entries()) {
    for (const [c, cand] of candidate.entries()) {
      const value = iou(ref, cand);
      if (value > 0 && value >= minIoU) pairs.push({ reference: r, candidate: c, iou: value });
    }
  }
  pairs.sort((a, b) => b.iou - a.iou || a.reference - b.reference || a.candidate - b.candidate);
  const usedRef = new Set<number>();
  const usedCand = new Set<number>();
  const matches: Match[] = [];
  for (const pair of pairs) {
    if (usedRef.has(pair.reference) || usedCand.has(pair.candidate)) continue;
    usedRef.add(pair.reference);
    usedCand.add(pair.candidate);
    matches.push(pair);
  }
  return {
    matches: matches.sort((a, b) => a.reference - b.reference),
    unmatchedReference: reference.flatMap((_, i) => (usedRef.has(i) ? [] : i)),
    unmatchedCandidate: candidate.flatMap((_, i) => (usedCand.has(i) ? [] : i)),
  };
}

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export interface TimeError {
  matched: number;
  startMeanAbsSeconds: number | null;
  endMeanAbsSeconds: number | null;
  startMedianAbsSeconds: number | null;
  endMedianAbsSeconds: number | null;
}

function timeError(reference: Episode[], candidate: Episode[], matches: Match[]): TimeError {
  const start = matches.map((m) => Math.abs(candidate[m.candidate].start - reference[m.reference].start) / 1000);
  const end = matches.map((m) => Math.abs(candidate[m.candidate].end - reference[m.reference].end) / 1000);
  return {
    matched: matches.length,
    startMeanAbsSeconds: mean(start),
    endMeanAbsSeconds: mean(end),
    startMedianAbsSeconds: median(start),
    endMedianAbsSeconds: median(end),
  };
}

/** Share of the episode's time that lies inside the observed intervals (which must not overlap each other). */
export function observedFraction(episode: Episode, observed: Interval[]): number {
  const total = length(episode);
  return total > 0 ? observed.reduce((sum, o) => sum + overlap(episode, o), 0) / total : 0;
}

export interface Evaluation {
  minIoU: number;
  truth: { total: number; evaluated: number; unobservable: number[] };
  predicted: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** null when it can't be computed (no predictions for precision, no evaluated truth for recall): never a made-up 0. */
  precision: number | null;
  recall: number | null;
  f1: number | null;
  countError: { signed: number; absolute: number }; // predicted minus evaluated truth
  timeError: TimeError;
  matches: Match[];
}

/**
 * Scores `predicted` against `truth`. When `observed` is given, a truth episode that was mostly not observed (privacy
 * switch, excluded clip, device off) is set aside as `unobservable` instead of counting as a miss: absence of
 * detection is not absence of behavior (AGENTS.md §2), and the pipeline never saw that footage.
 */
export function evaluate(args: {
  truth: Episode[];
  predicted: Episode[];
  observed?: Interval[];
  minIoU?: number;
  minObservedFraction?: number;
}): Evaluation {
  const minIoU = args.minIoU ?? DEFAULT_MIN_IOU;
  const minObserved = args.minObservedFraction ?? DEFAULT_MIN_OBSERVED_FRACTION;
  const unobservable: number[] = [];
  const evaluatedIndexes = args.truth.flatMap((episode, i) => {
    if (args.observed && observedFraction(episode, args.observed) < minObserved) {
      unobservable.push(i);
      return [];
    }
    return i;
  });
  const truth = evaluatedIndexes.map((i) => args.truth[i]);
  const { matches, unmatchedReference, unmatchedCandidate } = matchEpisodes(truth, args.predicted, minIoU);

  const tp = matches.length;
  const fp = unmatchedCandidate.length;
  const fn = unmatchedReference.length;
  const precision = args.predicted.length ? tp / args.predicted.length : null;
  const recall = truth.length ? tp / truth.length : null;
  const f1 = precision === null || recall === null ? null : precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    minIoU,
    truth: { total: args.truth.length, evaluated: truth.length, unobservable },
    predicted: args.predicted.length,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1,
    countError: { signed: args.predicted.length - truth.length, absolute: Math.abs(args.predicted.length - truth.length) },
    timeError: timeError(truth, args.predicted, matches),
    matches: matches.map((m) => ({ ...m, reference: evaluatedIndexes[m.reference] })),
  };
}

export interface Agreement {
  a: number;
  b: number;
  matched: number;
  /** 2 * matched / (a + b): symmetric, so it doesn't matter which side is the reference. null when both are empty. */
  f1: number | null;
  timeError: TimeError;
}

/** How much two episode sets agree: two runs of the pipeline (consistency) or two annotators. */
export function agreement(a: Episode[], b: Episode[], minIoU = DEFAULT_MIN_IOU): Agreement {
  const { matches } = matchEpisodes(a, b, minIoU);
  return {
    a: a.length,
    b: b.length,
    matched: matches.length,
    f1: a.length + b.length ? (2 * matches.length) / (a.length + b.length) : null,
    timeError: timeError(a, b, matches),
  };
}

export interface CoverageSummary {
  totalSeconds: number;
  secondsByStatus: Record<string, number>;
  /** Observed seconds over the recorded span; null for an empty span. */
  observedFraction: number | null;
}

/** Coverage of the recorded span [from, to): seconds per status, and the observed share. Time with no row isn't counted as observed. */
export function summarizeCoverage(intervals: CoverageInterval[], from: number, to: number): CoverageSummary {
  const secondsByStatus: Record<string, number> = {};
  for (const interval of intervals) {
    const seconds = overlap(interval, { start: from, end: to }) / 1000;
    if (seconds > 0) secondsByStatus[interval.status] = (secondsByStatus[interval.status] ?? 0) + seconds;
  }
  const totalSeconds = length({ start: from, end: to }) / 1000;
  return { totalSeconds, secondsByStatus, observedFraction: totalSeconds > 0 ? (secondsByStatus.observed ?? 0) / totalSeconds : null };
}
