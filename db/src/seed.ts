import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import {
  type COVERAGE_STATUS,
  consents,
  coverageIntervals,
  deviceAssignments,
  deviceEvents,
  deviceSensors,
  devices,
  eventTypes,
  mediaAssets,
  observationEvidence,
  observationReviews,
  observations,
  participantProtocols,
  participants,
  pipelineRunInputs,
  pipelineRuns,
  protocolVersions,
  researchers,
  sensorSeries,
  studies,
  studyMembers,
  syncBatches,
} from "./schema";
import { ingestSensorReadings, type Reading } from "./sensor-data";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CoverageStatus = (typeof COVERAGE_STATUS)[number];
type Slot = "morning" | "lunch" | "afternoon" | "night";

const STUDY_CODE = "study-eating-001";
const PROTOCOL_LABEL = "eating-v1";
const FIRMWARE_VERSION = "0.1.0";
const LOCAL_OFFSET = "-03:00";
const DAYS = ["2026-11-19", "2026-11-20"];
const SENSOR_PERIOD_S = 60;
const CLIP_PADDING_MS = 60_000;
const STATUSES_WITH_SENSOR_DATA: CoverageStatus[] = ["observed", "low_battery", "low_quality"];

const DAY_SEGMENTS: { from: string; to: string; status?: CoverageStatus; slot?: Slot }[] = [
  { from: "00:00", to: "08:00", status: "device_off" },
  { from: "08:00", to: "10:00" },
  { from: "10:00", to: "10:30", slot: "morning" },
  { from: "10:30", to: "13:00" },
  { from: "13:00", to: "14:00", slot: "lunch" },
  { from: "14:00", to: "16:00" },
  { from: "16:00", to: "16:30", slot: "afternoon" },
  { from: "16:30", to: "21:00" },
  { from: "21:00", to: "21:30", slot: "night" },
  { from: "21:30", to: "24:00", status: "device_off" },
];

const PARTICIPANTS: { pseudonym: string; enrollmentCode: string; deviceSerial: string; notObserved: Partial<Record<Slot, CoverageStatus>>[] }[] = [
  {
    pseudonym: "P-001",
    enrollmentCode: "EAT-001-P01", // unused, so the app can enroll against a seeded backend (as in tools/mock-api)
    deviceSerial: "OLM-DEMO-01",
    notObserved: [{ morning: "excluded_by_participant", night: "low_battery" }, { afternoon: "no_upload" }],
  },
  {
    pseudonym: "P-002",
    enrollmentCode: "EAT-001-P02",
    deviceSerial: "OLM-DEMO-02",
    notObserved: [{ morning: "privacy_switch", night: "low_quality" }, { lunch: "excluded_by_participant" }],
  },
  {
    pseudonym: "P-003",
    enrollmentCode: "EAT-001-P03",
    deviceSerial: "OLM-DEMO-03",
    notObserved: [{ night: "low_battery" }, { lunch: "privacy_switch", morning: "low_quality" }],
  },
];

const EVENT_TYPES = [
  { key: "eating_episode", label: "Eating episode" },
  { key: "drinking_episode", label: "Drinking episode" },
];

const EPISODE_ATTRIBUTES_SCHEMA = {
  type: "object",
  required: ["episode_kind", "visible_items", "context"],
  properties: {
    episode_kind: { enum: ["meal", "snack", "drink"] },
    visible_items: { type: "array", items: { type: "string" } },
    context: { enum: ["seated_table", "desk", "standing", "walking", "kitchen"] },
  },
};

const EPISODES = [
  { key: "breakfast", eventType: "eating_episode", from: "08:30", to: "08:46", confidence: 0.86, attributes: { episode_kind: "meal", visible_items: ["bread", "coffee"], context: "seated_table" } },
  { key: "coffee", eventType: "drinking_episode", from: "11:10", to: "11:14", confidence: 0.72, attributes: { episode_kind: "drink", visible_items: ["coffee"], context: "desk" } },
  { key: "lunch", eventType: "eating_episode", from: "13:15", to: "13:40", confidence: 0.91, attributes: { episode_kind: "meal", visible_items: ["rice", "salad", "water"], context: "seated_table" } },
  { key: "kitchen", eventType: "eating_episode", from: "15:10", to: "15:13", confidence: 0.41, attributes: { episode_kind: "snack", visible_items: ["bread"], context: "kitchen" } },
  { key: "snack", eventType: "eating_episode", from: "17:05", to: "17:09", confidence: 0.64, attributes: { episode_kind: "snack", visible_items: ["apple"], context: "standing" } },
  { key: "water", eventType: "drinking_episode", from: "18:30", to: "18:31", confidence: 0.58, attributes: { episode_kind: "drink", visible_items: ["water"], context: "walking" } },
  { key: "dinner", eventType: "eating_episode", from: "20:00", to: "20:28", confidence: 0.88, attributes: { episode_kind: "meal", visible_items: ["pasta", "water"], context: "seated_table" } },
];

const REVIEWS = [
  { pseudonym: "P-001", day: 0, episode: "breakfast", decision: "confirmed" as const, note: null },
  { pseudonym: "P-001", day: 0, episode: "kitchen", decision: "rejected" as const, note: "Handling bread while cooking, no intake." },
  { pseudonym: "P-002", day: 0, episode: "lunch", decision: "corrected" as const, note: "Episode ends later; dessert visible." },
];

// sensor_types rows come from migration 0003 (the sensors the pendant reports).
const SENSORS = [
  { key: "temperature_c", component: "DHT11" },
  { key: "humidity_pct", component: "DHT11" },
  { key: "co_raw", component: "MQ-7" },
  { key: "flammable_gas_raw", component: "MQ-2" },
  { key: "sound_level_raw", component: "KY-037" },
  { key: "battery_mv", component: "2S-voltage-divider" },
] as const;

function seedId(name: string) {
  const hex = createHash("sha256").update(`observatorio-seed:${name}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function minutesOf(hhmm: string) {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function localTime(day: string, minuteOfDay: number) {
  return new Date(Date.parse(`${day}T00:00:00${LOCAL_OFFSET}`) + minuteOfDay * 60_000);
}

function noise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function round(value: number, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function coverageOfDay(notObserved: Partial<Record<Slot, CoverageStatus>>) {
  return DAY_SEGMENTS.map((segment) => ({
    from: minutesOf(segment.from),
    to: minutesOf(segment.to),
    status: segment.status ?? (segment.slot && notObserved[segment.slot]) ?? "observed",
  }));
}

function episodesOfDay(participantIndex: number, dayIndex: number, coverage: ReturnType<typeof coverageOfDay>) {
  const shift = participantIndex * 7 + dayIndex * 5;
  return EPISODES.map((episode) => ({ ...episode, from: minutesOf(episode.from) + shift, to: minutesOf(episode.to) + shift })).filter(
    (episode) => !coverage.some((segment) => segment.status !== "observed" && segment.from <= episode.to + 1 && episode.from - 1 < segment.to),
  );
}

function sensorValue(sensorKey: (typeof SENSORS)[number]["key"], minuteOfDay: number, seed: number, nearMeal: boolean) {
  const daylight = Math.sin(((minuteOfDay - 540) / 1440) * 2 * Math.PI);
  switch (sensorKey) {
    case "temperature_c":
      return round(21 + 2.5 * daylight + (nearMeal ? 1.5 : 0) + 0.3 * noise(seed), 1);
    case "humidity_pct":
      return round(48 - 6 * daylight + (nearMeal ? 4 : 0) + 1.5 * noise(seed));
    case "co_raw":
      return round(110 + (nearMeal ? 70 : 0) + 12 * noise(seed));
    case "flammable_gas_raw":
      return round(190 + (nearMeal ? 45 : 0) + 15 * noise(seed));
    case "sound_level_raw":
      return round(420 + (nearMeal ? 110 : 0) + 90 * noise(seed));
    case "battery_mv":
      return Math.max(6600, round(8300 - (minuteOfDay - 480) * 1.6));
  }
}

async function seedStudy(tx: Tx) {
  const researcherId = seedId("researcher");
  const studyId = seedId("study");
  await tx
    .insert(researchers)
    .values({ id: researcherId, email: "demo.researcher@example.org", fullName: "Demo Researcher" })
    .onConflictDoNothing();
  await tx
    .insert(studies)
    .values({
      id: studyId,
      code: STUDY_CODE,
      title: "Eating episodes in daily life (demo)",
      description: "Demo study: when participants eat or drink, how often, for how long and in what observable context.",
      status: "active",
      createdBy: researcherId,
    })
    .onConflictDoNothing();
  await tx.insert(studyMembers).values({ studyId, researcherId, role: "owner" }).onConflictDoNothing();
  return { researcherId, studyId };
}

async function seedProtocol(tx: Tx, studyId: string, researcherId: string) {
  const protocolVersionId = seedId("protocol:eating-v1");
  const eventTypeIds = Object.fromEntries(EVENT_TYPES.map((type) => [type.key, seedId(`event-type:${type.key}`)]));
  const [existing] = await tx.select({ id: protocolVersions.id }).from(protocolVersions).where(eq(protocolVersions.id, protocolVersionId));
  if (!existing) {
    const definition = {
      sensors: Object.fromEntries(SENSORS.map((sensor) => [sensor.key, { period_s: SENSOR_PERIOD_S }])),
      camera: { fps: 2, resolution: "VGA" },
      event_types: EVENT_TYPES.map((type) => type.key),
      out_of_scope: ["calories", "portion_weight", "nutrients"],
    };
    await tx.insert(protocolVersions).values({ id: protocolVersionId, studyId, versionLabel: PROTOCOL_LABEL, definition });
    await tx.insert(eventTypes).values(
      EVENT_TYPES.map((type) => ({ id: eventTypeIds[type.key], protocolVersionId, ...type, attributesSchema: EPISODE_ATTRIBUTES_SCHEMA })),
    );
    await tx
      .update(protocolVersions)
      .set({
        status: "published",
        definitionSha256: sha256(JSON.stringify(definition)),
        publishedBy: researcherId,
        publishedAt: new Date(`2026-11-18T09:00:00${LOCAL_OFFSET}`),
        changeNote: "First version of the eating protocol.",
      })
      .where(eq(protocolVersions.id, protocolVersionId));
  }
  return { protocolVersionId, eventTypeIds };
}

async function seedParticipant(
  tx: Tx,
  studyId: string,
  protocolVersionId: string,
  { pseudonym, enrollmentCode, deviceSerial }: (typeof PARTICIPANTS)[number],
) {
  const participantId = seedId(`participant:${pseudonym}`);
  const deviceId = seedId(`device:${deviceSerial}`);
  const studyStart = new Date(`${DAYS[0]}T00:00:00${LOCAL_OFFSET}`);
  await tx
    .insert(participants)
    .values({ id: participantId, studyId, pseudonym, enrollmentCode, status: "active", enrolledAt: new Date(`2026-11-18T10:00:00${LOCAL_OFFSET}`) })
    // Databases seeded before enrollment codes existed get them too; a code is never replaced.
    .onConflictDoUpdate({ target: participants.id, set: { enrollmentCode }, where: isNull(participants.enrollmentCode) });
  await tx
    .insert(consents)
    .values({
      id: seedId(`consent:${pseudonym}`),
      participantId,
      documentVersion: "consent-eating-v1",
      documentSha256: sha256("consent-eating-v1"),
      allowsCamera: true,
      grantedAt: new Date(`2026-11-18T10:00:00${LOCAL_OFFSET}`),
    })
    .onConflictDoNothing();
  await tx
    .insert(participantProtocols)
    .values({ id: seedId(`participant-protocol:${pseudonym}`), participantId, protocolVersionId, validFrom: studyStart })
    .onConflictDoNothing();
  await tx.insert(devices).values({ id: deviceId, serial: deviceSerial, hardwareRevision: "chest-proto-v0", formFactor: "pendant" }).onConflictDoNothing();
  await tx
    .insert(deviceAssignments)
    .values({ id: seedId(`device-assignment:${deviceSerial}`), deviceId, participantId, validFrom: studyStart })
    .onConflictDoNothing();

  const seriesIds = {} as Record<(typeof SENSORS)[number]["key"], number>;
  for (const sensor of SENSORS) {
    const deviceSensorId = seedId(`device-sensor:${deviceSerial}:${sensor.key}`);
    await tx
      .insert(deviceSensors)
      .values({ id: deviceSensorId, deviceId, sensorTypeKey: sensor.key, componentModel: sensor.component, installedAt: studyStart })
      .onConflictDoNothing();
    await tx.insert(sensorSeries).values({ participantId, deviceSensorId, periodS: SENSOR_PERIOD_S }).onConflictDoNothing();
    const [series] = await tx
      .select({ id: sensorSeries.id })
      .from(sensorSeries)
      .where(and(eq(sensorSeries.participantId, participantId), eq(sensorSeries.deviceSensorId, deviceSensorId)));
    seriesIds[sensor.key] = series.id;
  }
  return { participantId, deviceId, seriesIds };
}

// Databases seeded before migration 0003 have a battery_pct series per demo device; the device
// reports battery_mv. Remove those rows (by their fixed seed ids) so old and new seeds converge.
async function dropLegacyBatterySeries(tx: Tx) {
  const ids = sql.join(
    PARTICIPANTS.map(({ deviceSerial }) => sql`${seedId(`device-sensor:${deviceSerial}:battery_pct`)}::uuid`),
    sql`, `,
  );
  const series = sql`select id from sensor_series where device_sensor_id in (${ids})`;
  await tx.execute(sql`delete from sensor_hourly where series_id in (${series})`);
  await tx.execute(sql`delete from sensor_chunks where series_id in (${series})`);
  await tx.execute(sql`delete from sensor_series where device_sensor_id in (${ids})`);
  await tx.execute(sql`delete from device_sensors where id in (${ids})`);
  await tx.execute(sql`delete from sensor_types where key = 'battery_pct' and not exists (select 1 from device_sensors where sensor_type_key = 'battery_pct')`);
}

async function seed() {
  await db.transaction(async (tx) => {
    await dropLegacyBatterySeries(tx);
    const { researcherId, studyId } = await seedStudy(tx);
    const { protocolVersionId, eventTypeIds } = await seedProtocol(tx, studyId, researcherId);

    const runId = seedId("pipeline-run:1");
    await tx
      .insert(pipelineRuns)
      .values({
        id: runId,
        protocolVersionId,
        trigger: "upload",
        modelProvider: "demo-seed",
        modelName: "demo-seed",
        modelVersion: "demo-seed-0",
        pipelineVersion: "0.1.0",
        status: "succeeded",
        startedAt: new Date(`2026-11-21T00:30:00${LOCAL_OFFSET}`),
        finishedAt: new Date(`2026-11-21T00:46:00${LOCAL_OFFSET}`),
      })
      .onConflictDoNothing();

    for (const [participantIndex, participant] of PARTICIPANTS.entries()) {
      const { pseudonym, deviceSerial, notObserved } = participant;
      const { participantId, deviceId, seriesIds } = await seedParticipant(tx, studyId, protocolVersionId, participant);
      const readings = Object.fromEntries(SENSORS.map((sensor) => [sensor.key, [] as Reading[]]));

      for (const [dayIndex, day] of DAYS.entries()) {
        const batchId = seedId(`sync-batch:${pseudonym}:${day}`);
        const coverage = coverageOfDay(notObserved[dayIndex]);
        const episodes = episodesOfDay(participantIndex, dayIndex, coverage);

        await tx
          .insert(syncBatches)
          .values({
            id: batchId,
            deviceId,
            participantId,
            firmwareVersion: FIRMWARE_VERSION,
            appVersion: "0.1.0",
            recordedFrom: localTime(day, minutesOf("08:00")),
            recordedTo: localTime(day, minutesOf("21:30")),
            payloadSha256: sha256(batchId),
            rawStorageKey: `demo/${pseudonym}/${day}/sync.json`,
            receivedAt: localTime(day, 1380),
            deviceSessionId: `${deviceSerial}-${localTime(day, minutesOf("08:00")).getTime() / 1000}`,
            status: "processed",
            completedAt: localTime(day, 1380),
          })
          .onConflictDoNothing();

        for (const segment of coverage) {
          const startedAt = localTime(day, segment.from);
          const endedAt = localTime(day, segment.to);
          const source = ["excluded_by_participant", "no_upload"].includes(segment.status)
            ? "app"
            : ["observed", "low_quality"].includes(segment.status)
              ? "derived"
              : "device";
          await tx
            .insert(coverageIntervals)
            .values({ id: seedId(`coverage:${pseudonym}:${day}:${segment.from}`), participantId, deviceId, startedAt, endedAt, status: segment.status, source, batchId })
            .onConflictDoNothing();

          const events =
            segment.status === "privacy_switch"
              ? [{ kind: "privacy_switch_on" as const, occurredAt: startedAt }, { kind: "privacy_switch_off" as const, occurredAt: endedAt }]
              : segment.status === "low_battery"
                ? [{ kind: "low_battery" as const, occurredAt: startedAt }]
                : [];
          for (const event of events) {
            await tx
              .insert(deviceEvents)
              .values({ id: seedId(`device-event:${pseudonym}:${day}:${segment.from}:${event.kind}`), deviceId, batchId, firmwareVersion: FIRMWARE_VERSION, ...event })
              .onConflictDoNothing();
          }

          if (!STATUSES_WITH_SENSOR_DATA.includes(segment.status)) continue;
          for (let minute = segment.from; minute < segment.to; minute++) {
            const nearMeal = episodes.some((episode) => episode.eventType === "eating_episode" && minute >= episode.from - 15 && minute <= episode.to + 15);
            for (const [sensorIndex, sensor] of SENSORS.entries()) {
              const seed = (participantIndex * 10 + dayIndex) * 100_000 + minute * 10 + sensorIndex;
              readings[sensor.key].push({ at: localTime(day, minute), value: sensorValue(sensor.key, minute, seed, nearMeal) });
            }
          }
        }

        for (const episode of episodes) {
          const startedAt = localTime(day, episode.from);
          const endedAt = localTime(day, episode.to);
          const durationSeconds = (episode.to - episode.from) * 60;
          const mediaAssetId = seedId(`media:${pseudonym}:${day}:${episode.key}`);
          const observationId = seedId(`observation:${pseudonym}:${day}:${episode.key}`);
          const uploadedAt = localTime(day, 1380);
          await tx
            .insert(mediaAssets)
            .values({
              id: mediaAssetId,
              participantId,
              deviceId,
              firmwareVersion: FIRMWARE_VERSION,
              kind: "video",
              recordedFrom: new Date(startedAt.getTime() - CLIP_PADDING_MS),
              recordedTo: new Date(endedAt.getTime() + CLIP_PADDING_MS),
              sha256: sha256(mediaAssetId),
              sizeBytes: (durationSeconds + 120) * 90_000,
              mimeType: "video/mp4",
              storageKey: `demo/${pseudonym}/${day}/${episode.key}.mp4`,
              status: "processed",
              uploadedAt,
              baseRetainUntil: new Date(uploadedAt.getTime() + 7 * 86_400_000),
            })
            .onConflictDoNothing();
          await tx.insert(pipelineRunInputs).values({ runId, mediaAssetId }).onConflictDoNothing();
          await tx
            .insert(observations)
            .values({
              id: observationId,
              participantId,
              pipelineRunId: runId,
              eventTypeId: eventTypeIds[episode.eventType],
              startedAt,
              endedAt,
              attributes: episode.attributes,
              confidence: episode.confidence,
              createdAt: new Date(`2026-11-21T00:46:00${LOCAL_OFFSET}`),
            })
            .onConflictDoNothing();
          await tx
            .insert(observationEvidence)
            .values({ id: seedId(`evidence:${pseudonym}:${day}:${episode.key}`), observationId, mediaAssetId, startSecond: 60, endSecond: 60 + durationSeconds })
            .onConflictDoNothing();
        }
      }

      for (const sensor of SENSORS) await ingestSensorReadings(seriesIds[sensor.key], readings[sensor.key], tx);
    }

    for (const review of REVIEWS) {
      const observationId = seedId(`observation:${review.pseudonym}:${DAYS[review.day]}:${review.episode}`);
      const [observation] = await tx.select().from(observations).where(eq(observations.id, observationId));
      const corrected =
        review.decision === "corrected"
          ? {
              correctedEndedAt: new Date(observation.endedAt.getTime() + 3 * 60_000),
              correctedAttributes: { ...(observation.attributes as object), visible_items: ["rice", "salad", "water", "fruit"] },
            }
          : {};
      await tx
        .insert(observationReviews)
        .values({ id: seedId(`review:${review.pseudonym}:${review.day}:${review.episode}`), observationId, reviewerId: researcherId, decision: review.decision, note: review.note, ...corrected })
        .onConflictDoNothing();
    }
  });
}

await seed();
await db.$client.end();
console.log(`Seeded ${STUDY_CODE} (${PROTOCOL_LABEL}): ${PARTICIPANTS.length} participants, ${DAYS.length} days.`);
