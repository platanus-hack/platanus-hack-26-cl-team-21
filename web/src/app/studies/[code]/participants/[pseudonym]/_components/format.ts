// Formatting helpers. Times are always shown in the participant's timezone, never the viewer's.

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatTime(ms: number, timeZone: string) {
  let f = timeFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("es-CL", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    timeFormatters.set(timeZone, f);
  }
  return f.format(new Date(ms));
}

/** Time of an interval end; the end of the local day reads 24:00 instead of 00:00. */
export function formatEnd(ms: number, dayEndMs: number, timeZone: string) {
  return ms === dayEndMs ? "24:00" : formatTime(ms, timeZone);
}

export function formatRange(startMs: number, endMs: number, timeZone: string, dayEndMs?: number) {
  const end = dayEndMs !== undefined ? formatEnd(endMs, dayEndMs, timeZone) : formatTime(endMs, timeZone);
  return `${formatTime(startMs, timeZone)}–${end}`;
}

const dayFormatter = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** `day` is a local calendar date (YYYY-MM-DD); formatted at UTC noon so no zone can shift it. */
export function formatDay(day: string) {
  const text = dayFormatter.format(new Date(`${day}T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDate(ms: number, timeZone: string) {
  return new Intl.DateTimeFormat("es-CL", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
}

export function formatDuration(ms: number) {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes === 0) return ms > 0 ? `${Math.round(ms / 1000)} s` : "0 min";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function formatNumber(value: number, decimals: number) {
  return value.toLocaleString("es-CL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatPercent(part: number, whole: number) {
  return whole > 0 ? `${formatNumber((part / whole) * 100, 0)} %` : "—";
}
