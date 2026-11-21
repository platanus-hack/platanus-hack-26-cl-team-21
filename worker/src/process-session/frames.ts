// frames.csv ↔ video timeline: row i is video frame i, and the phone encodes the video
// with pts = (rtc_epoch_ms_i − rtc_epoch_ms_0) / 1000, so every video second maps back to device time.

export type FrameRow = { seq: number; rtcEpochMs: number };

export type Timeline = {
  rows: FrameRow[];
  /** Video second of each row (same index). */
  videoSeconds: number[];
  /** Video second of the last frame. */
  durationSeconds: number;
};

export function parseFramesCsv(csv: string): FrameRow[] {
  const rows: FrameRow[] = [];
  for (const [lineIndex, raw] of csv.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [seq, rtc] = line.split(",");
    if (lineIndex === 0 && Number.isNaN(Number(seq))) continue; // header
    const row = { seq: Number(seq), rtcEpochMs: Number(rtc) };
    if (!Number.isInteger(row.seq) || !Number.isFinite(row.rtcEpochMs) || row.rtcEpochMs <= 0) {
      throw new Error(`frames.csv line ${lineIndex + 1}: invalid row "${line}"`);
    }
    const previous = rows.at(-1);
    // The phone drops frames with a lost or reset RTC before upload; a non-increasing clock here is a broken bundle.
    if (previous && row.rtcEpochMs <= previous.rtcEpochMs) {
      throw new Error(`frames.csv line ${lineIndex + 1}: rtc_epoch_ms is not increasing`);
    }
    rows.push(row);
  }
  if (rows.length === 0) throw new Error("frames.csv has no frames");
  return rows;
}

export type ObservedInterval = { startedAt: Date; endedAt: Date };

export type ObservedSegment = {
  firstFrame: number;
  lastFrame: number;
  startSecond: number;
  endSecond: number;
};

function mergeObservedIntervals(intervals: readonly ObservedInterval[]): ObservedInterval[] {
  const merged: ObservedInterval[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && previous.endedAt.getTime() === interval.startedAt.getTime()) previous.endedAt = interval.endedAt;
    else merged.push({ ...interval });
  }
  return merged;
}

export function observedSegments(timeline: Timeline, observed?: readonly ObservedInterval[]): ObservedSegment[] {
  const intervals = observed && mergeObservedIntervals(observed);
  const segments: ObservedSegment[] = [];
  let rangeIndex = 0;
  let previousRange = -1;
  for (const [index, row] of timeline.rows.entries()) {
    const ms = row.rtcEpochMs;
    while (intervals && rangeIndex < intervals.length && ms >= intervals[rangeIndex].endedAt.getTime()) rangeIndex++;
    if (intervals && (rangeIndex === intervals.length || ms < intervals[rangeIndex].startedAt.getTime())) continue;

    const second = timeline.videoSeconds[index];
    const last = segments.at(-1);
    if (last && previousRange === rangeIndex && ms - timeline.rows[last.lastFrame].rtcEpochMs <= 2000) {
      last.lastFrame = index;
      last.endSecond = second;
    } else {
      segments.push({ firstFrame: index, lastFrame: index, startSecond: second, endSecond: second });
    }
    previousRange = rangeIndex;
  }
  return segments.filter((segment) => segment.endSecond > segment.startSecond);
}

export function buildTimeline(rows: FrameRow[]): Timeline {
  const first = rows[0].rtcEpochMs;
  const videoSeconds = rows.map((row) => (row.rtcEpochMs - first) / 1000);
  return { rows, videoSeconds, durationSeconds: videoSeconds.at(-1)! };
}

/** Index of the row whose video second is closest to `second` (binary search). */
export function nearestFrame(timeline: Timeline, second: number) {
  const { videoSeconds } = timeline;
  let lo = 0;
  let hi = videoSeconds.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (videoSeconds[mid] < second) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(videoSeconds[lo - 1] - second) <= Math.abs(videoSeconds[lo] - second)) lo--;
  return lo;
}

/**
 * Maps a decoded frame's pts back to its frames.csv row. A pts that matches no row means the video and
 * frames.csv disagree, so the device time of anything seen in it would be wrong: fail instead of guessing.
 */
export function frameAt(timeline: Timeline, ptsSecond: number, toleranceSeconds = 0.05) {
  const index = nearestFrame(timeline, ptsSecond);
  const drift = Math.abs(timeline.videoSeconds[index] - ptsSecond);
  if (drift > toleranceSeconds) {
    throw new Error(`video frame at ${ptsSecond.toFixed(3)} s matches no frames.csv row (nearest is ${drift.toFixed(3)} s away)`);
  }
  return { index, videoSecond: timeline.videoSeconds[index], deviceTime: new Date(timeline.rows[index].rtcEpochMs) };
}
