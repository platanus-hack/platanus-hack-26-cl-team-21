// Parsers for the session bundle's CSV files (ADR 0002 §1 and §7). Pure. Rows that can't be placed in time
// (empty or zero `rtc_epoch`, the clock was never synced) are skipped rather than guessed.
import { createHash } from "node:crypto";
import type { Interval } from "./coverage";

const rows = (csv: string) =>
  csv
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(","));

const positive = (value: string | undefined) => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

/** `frames.csv` (`seq,rtc_epoch_ms,uptime_ms,bytes`): the frame times in device epoch ms. */
export const parseFrameTimes = (csv: string) => rows(csv).flatMap((f) => positive(f[1]) ?? []);

// sensors.csv column -> sensor_types key and the component mounted on the pendant (ADR 0002 §7).
export const SENSOR_COLUMNS = [
  { column: 2, key: "temperature_c", component: "DHT11" },
  { column: 3, key: "humidity_pct", component: "DHT11" },
  { column: 4, key: "co_raw", component: "MQ-7" },
  { column: 5, key: "flammable_gas_raw", component: "MQ-2" },
  { column: 6, key: "sound_level_raw", component: "KY-037" },
  { column: 7, key: "battery_mv", component: "battery divider" },
] as const;

/** `sensors.csv` (`rtc_epoch,uptime_ms,temp_c,rh_pct,mq7,mq2,sound_p2p,batt_mv`) by sensor type. Empty values and `batt_mv` = -1 (external power) are skipped. */
export function parseSensorReadings(csv: string) {
  const bySensor = new Map<string, { at: Date; value: number }[]>();
  for (const fields of rows(csv)) {
    const seconds = positive(fields[0]);
    if (seconds === null) continue;
    for (const { column, key } of SENSOR_COLUMNS) {
      const raw = fields[column];
      const value = raw === undefined || raw === "" ? NaN : Number(raw);
      if (!Number.isFinite(value) || (key === "battery_mv" && value === -1)) continue;
      const list = bySensor.get(key) ?? [];
      list.push({ at: new Date(seconds * 1000), value });
      bySensor.set(key, list);
    }
  }
  return bySensor;
}

export interface ParsedEvent {
  id: string;
  occurredAt: Date;
  kind: string;
  payload: Record<string, unknown> | null;
}

const EVENT_KINDS: Record<string, { kind: string; payload?: (type: string, value: string) => Record<string, unknown> | null }> = {
  PRIVACY_ON: { kind: "privacy_switch_on" },
  PRIVACY_OFF: { kind: "privacy_switch_off" },
  BUTTON: { kind: "button_press" },
  LOW_BATT: { kind: "low_battery", payload: (type, value) => ({ type, value }) },
  CRIT_BATT: { kind: "low_battery", payload: (type, value) => ({ type, value }) },
  DHT_FAIL: { kind: "sensor_fault", payload: () => ({ sensor: "dht" }) },
  BOOT: { kind: "boot" },
  RTC_SET: { kind: "rtc_set", payload: (_type, value) => ({ old_epoch: value }) },
  RTC_LOST: { kind: "rtc_lost" },
  CAM_BOOT: { kind: "camera_boot", payload: (_type, value) => ({ value }) },
};

// UUIDv5 so re-sending the same event row always gets the same id (device_events.id is the primary key).
const EVENT_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
export function uuidV5(name: string, namespace = EVENT_NAMESPACE) {
  const hash = createHash("sha1").update(Buffer.concat([Buffer.from(namespace.replaceAll("-", ""), "hex"), Buffer.from(name)])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * `events.csv` (`rtc_epoch,uptime_ms,type,value`). `occurred_at` is `value` for PRIVACY_* (the real switch time)
 * and `rtc_epoch` otherwise. Unknown event types are skipped. Also returns the privacy intervals: each ON up to its
 * OFF, an ON with no OFF running to `recordedToMs`, an OFF with no ON ignored.
 */
export function parseEvents(csv: string, deviceSerial: string, recordedToMs: number) {
  const events: ParsedEvent[] = [];
  const switches: { on: boolean; at: number }[] = [];
  for (const [epoch, uptime = "", type, value = ""] of rows(csv)) {
    const mapping = EVENT_KINDS[type];
    if (!mapping) continue;
    const privacy = type === "PRIVACY_ON" || type === "PRIVACY_OFF";
    const seconds = (privacy ? positive(value) : null) ?? positive(epoch);
    if (seconds === null) continue;
    if (privacy) switches.push({ on: type === "PRIVACY_ON", at: seconds * 1000 });
    events.push({
      id: uuidV5(`${deviceSerial}|${epoch}|${uptime}|${type}`),
      occurredAt: new Date(seconds * 1000),
      kind: mapping.kind,
      payload: mapping.payload?.(type, value) ?? null,
    });
  }
  const privacy: Interval[] = [];
  let onAt: number | null = null;
  for (const s of switches.sort((a, b) => a.at - b.at)) {
    if (s.on && onAt === null) onAt = s.at;
    else if (!s.on && onAt !== null) {
      privacy.push({ start: onAt, end: s.at });
      onAt = null;
    }
  }
  if (onAt !== null) privacy.push({ start: onAt, end: recordedToMs });
  return { events, privacy };
}
