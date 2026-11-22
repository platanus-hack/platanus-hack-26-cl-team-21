import { DISPLAY_TIME_ZONE, formatDate, formatTime } from "@/lib/format";

/** "18 nov 2026, 09:00" in Santiago time (publication instants don't belong to a participant). */
export function formatInstant(instant: Date) {
  return `${formatDate(instant)}, ${formatTime(instant.getTime(), DISPLAY_TIME_ZONE)}`;
}

/** Next free label after `label`: "eating-v1" → "eating-v2"; otherwise "<label>-v2", "-v3", … */
export function suggestNextLabel(label: string, taken: string[]) {
  const used = new Set(taken);
  const match = /^(.*?)(\d+)$/.exec(label);
  const stem = match ? match[1] : `${label}-v`;
  let n = match ? Number(match[2]) + 1 : 2;
  while (used.has(`${stem}${n}`)) n++;
  return `${stem}${n}`;
}

export const protocolsHref = (studyCode: string) => `/studies/${encodeURIComponent(studyCode)}/protocols`;
export const versionHref = (studyCode: string, label: string) => `${protocolsHref(studyCode)}/${encodeURIComponent(label)}`;
