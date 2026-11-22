// IANA time zones a participant can live in. "Day" in longitudinal tables is the participant's
// local day, so the zone must be one Postgres knows too; Node's ICU list uses the same IANA names.

export const DEFAULT_TIME_ZONE = "America/Santiago";

export const TIME_ZONES: readonly string[] = (() => {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  zones.add(DEFAULT_TIME_ZONE);
  zones.add("UTC");
  return [...zones].sort();
})();

export function isTimeZone(value: string) {
  return TIME_ZONES.includes(value);
}
