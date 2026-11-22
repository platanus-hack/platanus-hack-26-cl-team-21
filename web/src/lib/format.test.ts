import assert from "node:assert/strict";
import { test } from "node:test";
import { dayTicks, formatLocalDay, spansYears } from "./format";

const labels = (startIso: string, endIso: string) => dayTicks(Date.parse(startIso), Date.parse(endIso), "America/New_York").map((t) => t.label);
const REGULAR = ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00", "24:00"];

test("dayTicks: a regular 24 h day", () => {
  assert.deepEqual(labels("2026-06-10T04:00:00Z", "2026-06-11T04:00:00Z"), REGULAR);
});

test("dayTicks: a 23 h spring-forward day keeps clock-hour ticks and ends at 24:00", () => {
  // New York, 2026-03-08: 02:00 EST jumps to 03:00 EDT.
  const ticks = dayTicks(Date.parse("2026-03-08T05:00:00Z"), Date.parse("2026-03-09T04:00:00Z"), "America/New_York");
  assert.deepEqual(ticks.map((t) => t.label), REGULAR);
  assert.equal(ticks.at(-1)?.pct, 100);
  // 03:00 local is only 2 real hours after midnight, so it sits before the 3/23 mark.
  assert.ok(Math.abs(ticks[1].pct - (2 / 23) * 100) < 1e-9);
});

test("dayTicks: a 25 h fall-back day lists each clock hour once", () => {
  // New York, 2026-11-01: 02:00 EDT falls back to 01:00 EST.
  assert.deepEqual(labels("2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"), REGULAR);
});

test("formatLocalDay adds the year only when asked", () => {
  assert.doesNotMatch(formatLocalDay("2026-11-21"), /2026/);
  assert.match(formatLocalDay("2026-11-21", "short", true), /2026/);
});

test("spansYears", () => {
  assert.equal(spansYears(["2026-11-21", "2026-12-31"]), false);
  assert.equal(spansYears(["2026-12-31", "2027-01-01"]), true);
  assert.equal(spansYears([]), false);
});

test("dayTicks: a half-hour offset zone still gets clock-hour ticks", () => {
  // Kolkata is UTC+05:30 with no DST: local midnight is 18:30 UTC the day before.
  const ticks = dayTicks(Date.parse("2026-06-09T18:30:00Z"), Date.parse("2026-06-10T18:30:00Z"), "Asia/Kolkata");
  assert.deepEqual(ticks.map((t) => t.label), REGULAR);
});
