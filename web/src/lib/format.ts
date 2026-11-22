// Number, duration and date formatting shared by every portal page (Spanish, es-CL).
// Participant data is shown in the participant's own time zone, never the viewer's.

// Display zone for instants that don't belong to a participant (e.g. protocol publication).
export const DISPLAY_TIME_ZONE = "America/Santiago";

/**
 * "45 s" below one minute, otherwise rounded to the minute: "4 min", "1 h 5 min", "38 h". Used for
 * both episode durations and coverage time, so the same span reads the same on every page.
 */
export function formatDuration(seconds: number) {
  if (Math.round(seconds) < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function formatNumber(value: number, decimals: number) {
  return value.toLocaleString("es-CL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const shareFormat = new Intl.NumberFormat("es-CL", { style: "percent", maximumFractionDigits: 0 });

/** Share of time (coverage). Never used for model confidence. */
export function formatShare(part: number, total: number) {
  return total > 0 ? shareFormat.format(part / total) : "—";
}

/** Model confidence is a raw 0–1 model score, not a calibrated probability: no "%". */
export function formatConfidence(confidence: number | null) {
  return confidence === null ? "—" : formatNumber(confidence, 2);
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

// --- Dates and times ---

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, options: Intl.DateTimeFormatOptions) {
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("es-CL", options);
    formatters.set(key, f);
  }
  return f;
}

/** Calendar date of an instant ("21 nov 2026") in `timeZone`. */
export function formatDate(instant: Date | number, timeZone = DISPLAY_TIME_ZONE) {
  return formatter(`date:${timeZone}`, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(instant);
}

/** Clock time of an instant ("14:05") in `timeZone`. */
export function formatTime(ms: number, timeZone: string) {
  return formatter(`time:${timeZone}`, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

/** Time of an interval end; the end of the local day reads 24:00 instead of 00:00. */
export function formatEnd(ms: number, dayEndMs: number, timeZone: string) {
  return ms === dayEndMs ? "24:00" : formatTime(ms, timeZone);
}

export function formatRange(startMs: number, endMs: number, timeZone: string, dayEndMs?: number) {
  const end = dayEndMs !== undefined ? formatEnd(endMs, dayEndMs, timeZone) : formatTime(endMs, timeZone);
  return `${formatTime(startMs, timeZone)}–${end}`;
}

const shortDay = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const shortDayYear = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const longDay = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });

/**
 * A participant-local calendar day given as YYYY-MM-DD ("vie, 21 nov" or "Viernes, 21 de
 * noviembre de 2026"). Formatted at UTC noon, so no time zone can shift it. Pass `withYear` when
 * the days on screen span more than one year (see `spansYears`).
 */
export function formatLocalDay(day: string, style: "short" | "long" = "short", withYear = false) {
  const date = new Date(`${day}T12:00:00Z`);
  if (style === "short") return (withYear ? shortDayYear : shortDay).format(date);
  const text = longDay.format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const QUARTER_MS = 900_000;

/**
 * Axis ticks for one local day: its start, every local clock hour divisible by `stepHours`, and
 * its end as 24:00. Ticks follow the wall clock, so on a 23 h or 25 h DST day they still read
 * 03:00, 06:00… and the last one is always the end of the day.
 */
export function dayTicks(startMs: number, endMs: number, timeZone: string, stepHours = 3) {
  const pct = (ms: number) => ((ms - startMs) / (endMs - startMs)) * 100;
  const ticks = [{ ms: startMs, pct: 0, label: formatTime(startMs, timeZone) }];
  const seen = new Set([ticks[0].label]);
  // Step in quarter hours: local whole hours fall on :00, :30 or :45 UTC depending on the zone's offset.
  for (let ms = Math.ceil((startMs + 1) / QUARTER_MS) * QUARTER_MS; ms < endMs; ms += QUARTER_MS) {
    const label = formatTime(ms, timeZone);
    const hour = Number(label.slice(0, 2));
    if (label.endsWith(":00") && hour % stepHours === 0 && !seen.has(label)) {
      seen.add(label);
      ticks.push({ ms, pct: pct(ms), label });
    }
  }
  ticks.push({ ms: endMs, pct: 100, label: "24:00" });
  return ticks;
}

/** Whether YYYY-MM-DD days fall in more than one calendar year, so short dates need the year. */
export function spansYears(days: string[]) {
  return new Set(days.map((day) => day.slice(0, 4))).size > 1;
}
