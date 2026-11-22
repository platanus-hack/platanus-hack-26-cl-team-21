import type { CoverageStatus } from "@/lib/labels";
import { buildDay, type TimelineObservation } from "@/lib/queries/timeline";

// An illustrative participant day for the landing page, not participant data. It goes through the
// same buildDay() as the real timeline, so the landing shows exactly what the portal draws.

export const EXAMPLE_TIME_ZONE = "America/Santiago";

/** Local time on 2026-11-21 in Santiago (UTC−3 in November); "24:00" is the next midnight. */
const at = (hhmm: string) => (hhmm === "24:00" ? Date.parse("2026-11-22T00:00:00-03:00") : Date.parse(`2026-11-21T${hhmm}:00-03:00`));

const COVERAGE: [CoverageStatus, string, string][] = [
  ["device_off", "06:00", "08:00"],
  ["observed", "08:00", "12:30"],
  ["privacy_switch", "12:30", "13:00"],
  ["observed", "13:00", "16:00"],
  ["excluded_by_participant", "16:00", "17:00"],
  ["observed", "17:00", "21:00"],
  ["low_battery", "21:00", "22:00"],
  ["device_off", "22:00", "24:00"],
];

const episode = (
  id: string,
  eventKey: "eating_episode" | "drinking_episode",
  from: string,
  to: string,
  attributes: Record<string, unknown>,
  confidence: number,
): TimelineObservation => ({
  id,
  eventKey,
  eventLabel: eventKey === "eating_episode" ? "Alimentación" : "Bebida",
  startMs: at(from),
  endMs: at(to),
  attributes,
  confidence,
  reviewStatus: "pending",
  protocolVersion: "eating-v1",
  modelVersion: "claude-opus-5-5",
  pipelineVersion: "0.1.0",
  evidenceCount: 1,
  sensorContext: [
    { sensorType: "temperature_c", unit: "°C", n: 70, mean: 23.4, min: 23.1, max: 23.8 },
    { sensorType: "humidity_pct", unit: "%", n: 70, mean: 47, min: 46, max: 48 },
  ],
});

const OBSERVATIONS = [
  episode("ex-1", "eating_episode", "08:20", "08:40", { episode_kind: "snack", visible_items: ["pan", "café"], context: "kitchen" }, 0.82),
  episode("ex-2", "eating_episode", "13:10", "13:45", { episode_kind: "meal", visible_items: ["sándwich", "agua"], context: "seated_table" }, 0.91),
  episode("ex-3", "drinking_episode", "15:00", "15:09", { episode_kind: "drink", visible_items: ["botella de agua"], context: "desk" }, 0.74),
  episode("ex-4", "eating_episode", "19:30", "20:10", { episode_kind: "meal", visible_items: ["ensalada"], context: "seated_table" }, 0.88),
];

export const EXAMPLE_DAY = buildDay(
  { day: "2026-11-21", startMs: at("00:00"), endMs: at("24:00") },
  { fromMs: at("06:00"), toMs: at("24:00"), ongoing: false },
  COVERAGE.map(([status, from, to]) => ({ status, startMs: at(from), endMs: at(to) })),
  OBSERVATIONS,
);

/** The episode shown as a card next to the bar. */
export const EXAMPLE_OBSERVATION = EXAMPLE_DAY.observations.find((o) => o.id === "ex-2")!;
