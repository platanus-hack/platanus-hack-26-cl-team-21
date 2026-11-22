import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseEvents, parseFrameTimes, parseSensorReadings, uuidV5 } from "./session-files";

describe("session files", () => {
  test("keeps only frames with a usable timestamp", () => {
    assert.deepEqual(parseFrameTimes("seq,rtc_epoch_ms,uptime_ms,bytes\n1,1000,5,10\n2,,6,10\n3,0,7,10\n"), [1000]);
  });

  test("skips empty values, battery -1 and rows without a clock", () => {
    const readings = parseSensorReadings("rtc_epoch,uptime_ms,temp_c,rh_pct,co2_ppm,sound_active_pct,batt_mv\n100,1,22.5,,,12,-1\n0,2,1,1,1,1,1\n101,3,23,50,640,0,7400\n");
    assert.deepEqual(readings.get("temperature_c")?.map((r) => r.value), [22.5, 23]);
    assert.equal(readings.get("humidity_pct")?.length, 1);
    assert.deepEqual(readings.get("co2_ppm")?.map((r) => r.value), [640]);
    assert.deepEqual(readings.get("sound_active_pct")?.map((r) => r.value), [12, 0]);
    assert.deepEqual(readings.get("battery_mv")?.map((r) => r.value), [7400]);
  });

  test("maps events, uses the real switch time for privacy and pairs the intervals", () => {
    const { events, privacy } = parseEvents(
      "rtc_epoch,uptime_ms,type,value\n100,5,BOOT,\n200,6,PRIVACY_ON,150\n210,7,PRIVACY_OFF,180\n220,8,LOW_BATT,3400\n230,9,UNKNOWN,1\n240,10,PRIVACY_ON,240\n",
      "dev-1",
      300_000,
    );
    assert.deepEqual(events.map((e) => e.kind), ["boot", "privacy_switch_on", "privacy_switch_off", "low_battery", "privacy_switch_on"]);
    assert.equal(events[1].occurredAt.getTime(), 150_000);
    assert.deepEqual(events[3].payload, { type: "LOW_BATT", value: "3400" });
    assert.deepEqual(privacy, [{ start: 150_000, end: 180_000 }, { start: 240_000, end: 300_000 }]);
  });

  test("builds stable RFC 4122 v5 ids", () => {
    assert.equal(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"), "2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });
});
