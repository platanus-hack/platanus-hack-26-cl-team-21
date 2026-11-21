// ISO 8601 with the participant's UTC offset at that instant (e.g. 2026-11-19T13:22:00-03:00).
// Milliseconds are written only when the instant has them.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "longOffset",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isoWithOffset(epochMs: number, timeZone: string): string {
  const ms = Math.round(epochMs);
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(ms))) parts[part.type] = part.value;
  // longOffset is "GMT-03:00", or plain "GMT" for UTC itself.
  const offset = parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName.replace("GMT", "");
  const millis = ((ms % 1000) + 1000) % 1000;
  const fraction = millis ? `.${String(millis).padStart(3, "0")}` : "";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${fraction}${offset}`;
}
