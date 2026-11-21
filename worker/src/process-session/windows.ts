// Turns the detection pass's per-frame labels into candidate windows for the extraction pass.

export type FrameLabel = { videoSecond: number; candidate: boolean };
export type Window = { startSecond: number; endSecond: number };

/**
 * Consecutive candidate frames closer than `maxGapSeconds` form one run; each run is padded by
 * `paddingSeconds` on both sides (context before and after), clipped to the video, and runs whose padded
 * ranges touch are merged so no footage is analyzed twice.
 */
export function mergeCandidateWindows(
  labels: FrameLabel[],
  opts: { maxGapSeconds: number; paddingSeconds: number; durationSeconds: number },
): Window[] {
  const seconds = labels
    .filter((label) => label.candidate)
    .map((label) => label.videoSecond)
    .sort((a, b) => a - b);
  const runs: Window[] = [];
  for (const second of seconds) {
    const last = runs.at(-1);
    if (last && second - last.endSecond <= opts.maxGapSeconds) last.endSecond = second;
    else runs.push({ startSecond: second, endSecond: second });
  }
  const windows: Window[] = [];
  for (const run of runs) {
    const padded = {
      startSecond: Math.max(0, run.startSecond - opts.paddingSeconds),
      endSecond: Math.min(opts.durationSeconds, run.endSecond + opts.paddingSeconds),
    };
    const last = windows.at(-1);
    if (last && padded.startSecond <= last.endSecond) last.endSecond = Math.max(last.endSecond, padded.endSecond);
    else windows.push(padded);
  }
  return windows;
}

/** Sampling step that keeps a window within `maxFrames` frames, never denser than `minStepSeconds`. */
export function samplingStep(window: Window, minStepSeconds: number, maxFrames: number) {
  const span = window.endSecond - window.startSecond;
  return Math.max(minStepSeconds, span / Math.max(maxFrames - 1, 1));
}
