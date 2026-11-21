import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// ffmpeg-static ships a binary per platform (also on Render's Node runtime), so no system ffmpeg is needed.
export const FFMPEG_PATH = process.env.FFMPEG_PATH || ffmpegStatic;

export type ExtractedFrame = { ptsSecond: number; path: string };

export function runFfmpeg(args: string[]): Promise<string> {
  if (!FFMPEG_PATH) throw new Error("ffmpeg binary not found: install ffmpeg-static or set FFMPEG_PATH");
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH!, ["-hide_banner", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-2000)}`))));
  });
}

/**
 * Decodes still frames (JPEG) from the video, at most one every `everySeconds` of video time, inside
 * [fromSecond, toSecond]. Returns each frame's real pts, read from ffmpeg's showinfo log, so a variable
 * frame rate video with gaps keeps the true timestamps (nothing is resampled or synthesized).
 */
export async function extractFrames(
  videoPath: string,
  outDir: string,
  opts: { everySeconds: number; fromSecond?: number; toSecond?: number; width?: number },
): Promise<ExtractedFrame[]> {
  const from = opts.fromSecond ?? 0;
  const to = opts.toSecond ?? Number.MAX_SAFE_INTEGER;
  // 1 ms slack so frames exactly `everySeconds` apart are not skipped by float rounding.
  const step = Math.max(opts.everySeconds - 0.001, 0);
  const select = `select='between(t,${from},${to})*(isnan(prev_selected_t)+gte(t-prev_selected_t,${step}))'`;
  const filters = [select, ...(opts.width ? [`scale='min(${opts.width},iw)':-2`] : []), "showinfo"];
  const stderr = await runFfmpeg([
    "-i", videoPath,
    "-vf", filters.join(","),
    "-fps_mode", "passthrough",
    "-q:v", "4",
    path.join(outDir, "%06d.jpg"),
  ]);
  const pts = [...stderr.matchAll(/Parsed_showinfo.*?pts_time:\s*(-?[\d.]+)/g)].map((match) => Number(match[1]));
  const files = (await readdir(outDir)).filter((name) => name.endsWith(".jpg")).sort();
  if (files.length !== pts.length) throw new Error(`ffmpeg wrote ${files.length} frames but logged ${pts.length} timestamps`);
  return files.map((name, i) => ({ ptsSecond: pts[i], path: path.join(outDir, name) }));
}
