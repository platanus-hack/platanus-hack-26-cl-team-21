// Coverage derivation of ADR 0002 §5. Pure: times are epoch ms, intervals are [start, end).

export interface Interval {
  start: number;
  end: number;
}

export type CoverageStatus = "observed" | "excluded_by_participant" | "privacy_switch" | "device_off" | "no_upload";
export type CoverageSource = "device" | "app" | "derived";
export interface CoverageRow extends Interval {
  status: CoverageStatus;
  source: CoverageSource;
}

/** Consecutive frames further apart than this leave a gap (ADR 0002 §5, step 3). */
export const MAX_FRAME_GAP_MS = 2000;

const clip = (ranges: Interval[], from: number, to: number) =>
  ranges.map((r) => ({ start: Math.max(r.start, from), end: Math.min(r.end, to) })).filter((r) => r.end > r.start);

function merge(ranges: Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/** `ranges` minus `blockers`; both must already be merged. */
function subtract(ranges: Interval[], blockers: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const range of ranges) {
    let start = range.start;
    for (const b of blockers) {
      if (b.end <= start || b.start >= range.end) continue;
      if (b.start > start) out.push({ start, end: b.start });
      start = Math.max(start, b.end);
    }
    if (start < range.end) out.push({ start, end: range.end });
  }
  return out;
}

/** Runs of frames with no gap above MAX_FRAME_GAP_MS. A lone frame covers no time, so it makes no run. */
export function frameRuns(frameTimesMs: number[]): Interval[] {
  const times = [...frameTimesMs].sort((a, b) => a - b);
  const runs: Interval[] = [];
  let start = 0;
  for (let i = 1; i <= times.length; i++) {
    if (i === times.length || times[i] - times[i - 1] > MAX_FRAME_GAP_MS) {
      if (times[i - 1] > times[start]) runs.push({ start: times[start], end: times[i - 1] });
      start = i;
    }
  }
  return runs;
}

/**
 * Every instant of [from, to) gets one status, never two. Precedence: privacy switch, participant exclusion,
 * observed (uploaded frames), then the rest: `device_off` (camera brownout, dropped frames) or `no_upload` when
 * the upload has no video.
 */
export function deriveCoverage(args: {
  from: number;
  to: number;
  privacy: Interval[];
  excluded: Interval[];
  frameTimesMs: number[];
  hasVideo: boolean;
}): CoverageRow[] {
  const { from, to } = args;
  const privacy = merge(clip(args.privacy, from, to));
  const excluded = subtract(merge(clip(args.excluded, from, to)), privacy);
  const blocked = merge([...privacy, ...excluded]);
  const observed = args.hasVideo ? subtract(merge(clip(frameRuns(args.frameTimesMs), from, to)), blocked) : [];
  const rest = subtract(to > from ? [{ start: from, end: to }] : [], merge([...blocked, ...observed]));

  const rows: CoverageRow[] = [
    ...privacy.map((r): CoverageRow => ({ ...r, status: "privacy_switch", source: "device" })),
    ...excluded.map((r): CoverageRow => ({ ...r, status: "excluded_by_participant", source: "app" })),
    ...observed.map((r): CoverageRow => ({ ...r, status: "observed", source: "derived" })),
    ...rest.map((r): CoverageRow => ({ ...r, status: args.hasVideo ? "device_off" : "no_upload", source: "derived" })),
  ];
  return rows.sort((a, b) => a.start - b.start);
}
