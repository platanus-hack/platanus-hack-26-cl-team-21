// Reads annotation sheets (ground truth) and prediction files. Times are ISO 8601 with an offset, like everywhere else
// in the project; anything without one is rejected rather than guessed.
import type { Episode } from "./metrics";

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function parseTime(value: unknown, where: string): number {
  if (typeof value !== "string" || !ISO_WITH_OFFSET.test(value.trim()) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${where}: "${value}" is not an ISO 8601 time with an offset (e.g. 2026-11-21T14:05:12-03:00)`);
  }
  return Date.parse(value.trim());
}

function toEpisodes(rows: { start: unknown; end: unknown }[], where: string): Episode[] {
  return rows.map((row, i) => {
    const start = parseTime(row.start, `${where} row ${i + 1} start`);
    const end = parseTime(row.end, `${where} row ${i + 1} end`);
    if (end <= start) throw new Error(`${where} row ${i + 1}: end must be after start`);
    return { start, end };
  });
}

/** `{ "annotator"?: string, "episodes": [{ "start", "end", "kind"?, "note"? }] }`, or a bare array of episodes. */
export function parseEpisodesJson(text: string, where: string): { annotator?: string; episodes: Episode[] } {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.episodes;
  if (!Array.isArray(list)) throw new Error(`${where}: expected an "episodes" array`);
  return { annotator: typeof data?.annotator === "string" ? data.annotator : undefined, episodes: toEpisodes(list, where) };
}

/** An annotation sheet exported as CSV: a header with `start` and `end` (other columns such as `kind` and `note` are ignored). */
export function parseEpisodesCsv(text: string, where: string): Episode[] {
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line.trim());
  const columns = header?.split(",").map((c) => c.trim().toLowerCase()) ?? [];
  const start = columns.indexOf("start");
  const end = columns.indexOf("end");
  if (start < 0 || end < 0) throw new Error(`${where}: the header needs start and end columns`);
  return toEpisodes(lines.map((line) => { const f = line.split(","); return { start: f[start]?.trim(), end: f[end]?.trim() }; }), where);
}

export const parseEpisodes = (text: string, file: string) =>
  file.toLowerCase().endsWith(".csv") ? { episodes: parseEpisodesCsv(text, file) } : parseEpisodesJson(text, file);
