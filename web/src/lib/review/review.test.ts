import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";
import {
  auditLog,
  db,
  eq,
  eventTypes,
  mediaAssets,
  observationEvidence,
  observations,
  pipelineRuns,
  protocolVersions,
  sql,
  studies,
} from "@observatorio/db";
import { getObservationEvidence } from "@/lib/evidence/queries";
import { closeDb, createDevice, createStudyWithParticipant } from "@/test/fixtures";
import { reviewObservationAction } from "./actions";
import { ReviewError, reviewObservation } from "./mutations";

after(closeDb);

async function createObservation() {
  const { studyId, participantId } = await createStudyWithParticipant();
  const [study] = await db.select({ code: studies.code }).from(studies).where(eq(studies.id, studyId));
  // The fixture's version is published, so its event types are immutable: use a draft version of our own.
  const [protocol] = await db.insert(protocolVersions).values({ studyId, versionLabel: "draft-1", definition: {}, status: "draft", definitionSha256: "1".repeat(64) }).returning({ id: protocolVersions.id });
  const device = await createDevice();
  const [eventType] = await db.insert(eventTypes).values({ protocolVersionId: protocol.id, key: "eating_episode", label: "Eating episode" }).returning();
  await db.update(protocolVersions).set({ status: "published", publishedAt: new Date() }).where(eq(protocolVersions.id, protocol.id)); // pipeline runs need a published version
  const startedAt = new Date("2026-11-21T17:05:12Z");
  const [media] = await db
    .insert(mediaAssets)
    .values({
      id: randomUUID(), participantId, deviceId: device.id, firmwareVersion: "0.1.0", kind: "video", recordedFrom: startedAt,
      recordedTo: new Date(startedAt.getTime() + 600_000), sha256: randomUUID().replaceAll("-", "").repeat(2), sizeBytes: 10,
      storageKey: `uploads/test/${randomUUID()}/video.mp4`, baseRetainUntil: new Date(Date.now() + 86_400_000),
    })
    .returning();
  const newRun = async () =>
    (await db.insert(pipelineRuns).values({ protocolVersionId: protocol.id, trigger: "upload", modelProvider: "anthropic", modelName: "m", modelVersion: "v1", params: {}, pipelineVersion: "0.1.0", status: "succeeded", startedAt }).returning())[0];
  const run = await newRun();
  const [observation] = await db
    .insert(observations)
    .values({ participantId, pipelineRunId: run.id, eventTypeId: eventType.id, startedAt, endedAt: new Date(startedAt.getTime() + 416_000), attributes: { episode_kind: "meal" }, confidence: 0.8, quality: {} })
    .returning();
  await db.insert(observationEvidence).values({ observationId: observation.id, mediaAssetId: media.id, startSecond: 124, endSecond: 540 });
  return { studyId, studyCode: study.code, participantId, observationId: observation.id, media, newRun, run };
}

const currentStatus = async (id: string) =>
  (await db.execute<{ human_review_status: string }>(sql`select human_review_status from v_current_observations where id = ${id}`)).rows[0]?.human_review_status ?? null;

describe("observation evidence", () => {
  test("returns the observation with its cut, source hash and provenance", async () => {
    const { studyId, observationId, media } = await createObservation();

    const evidence = await getObservationEvidence(studyId, observationId);

    assert.ok(evidence);
    assert.equal(evidence.eventTypeKey, "eating_episode");
    assert.deepEqual(evidence.attributes, { episode_kind: "meal" });
    assert.equal(evidence.superseded, false);
    assert.equal(evidence.protocolVersion, "draft-1");
    assert.equal(evidence.modelVersion, "v1");
    assert.deepEqual(evidence.cuts.map((c) => [c.startSecond, c.endSecond, c.sha256, c.inStorage]), [[124, 540, media.sha256, true]]);
    assert.deepEqual(evidence.reviews, []);
  });

  test("does not find another study's observation or a malformed id", async () => {
    const mine = await createObservation();
    const other = await createObservation();
    assert.equal(await getObservationEvidence(other.studyId, mine.observationId), null);
    assert.equal(await getObservationEvidence(mine.studyId, "not-a-uuid"), null);
  });
});

describe("reviewObservation", () => {
  test("appends reviews, the latest one wins, and a rejected observation leaves the current view", async () => {
    const { studyId, studyCode, observationId } = await createObservation();
    assert.equal(await currentStatus(observationId), "pending");

    await reviewObservation({ studyCode, observationId, decision: "confirmed", note: "se ve la comida" });
    assert.equal(await currentStatus(observationId), "confirmed");

    await reviewObservation({ studyCode, observationId, decision: "rejected", note: null });
    assert.equal(await currentStatus(observationId), null); // rejected rows are hidden by v_current_observations

    await reviewObservation({ studyCode, observationId, decision: "confirmed", note: "me equivoqué" }); // a mind change is another row
    assert.equal(await currentStatus(observationId), "confirmed");

    const evidence = await getObservationEvidence(studyId, observationId);
    assert.deepEqual(evidence!.reviews.map((r) => [r.decision, r.note]), [["confirmed", "me equivoqué"], ["rejected", null], ["confirmed", "se ve la comida"]]);
    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, observationId));
    assert.equal(audit.filter((a) => a.action === "review_observation").length, 3);
  });

  test("refuses an observation of another study", async () => {
    const mine = await createObservation();
    const other = await createObservation();
    await assert.rejects(reviewObservation({ studyCode: other.studyCode, observationId: mine.observationId, decision: "confirmed", note: null }), ReviewError);
  });

  test("refuses a superseded observation", async () => {
    const { studyCode, observationId, newRun } = await createObservation();
    const later = await newRun();
    await db.update(observations).set({ supersededByRunId: later.id }).where(eq(observations.id, observationId));
    await assert.rejects(reviewObservation({ studyCode, observationId, decision: "confirmed", note: null }), /reemplazada/);
  });
});

describe("reviewObservationAction validation", () => {
  const form = (entries: Record<string, string>) => Object.entries(entries).reduce((f, [k, v]) => (f.set(k, v), f), new FormData());
  const idle = { status: "idle" } as const;

  test("rejects a missing decision, an unknown one, a bad id and a long note before touching the database", async () => {
    const id = randomUUID();
    for (const data of [form({}), form({ decision: "corrected" }), form({ decision: "confirmed", note: "x".repeat(501) })]) {
      assert.equal((await reviewObservationAction("any", id, idle, data)).status, "error");
    }
    assert.equal((await reviewObservationAction("any", "nope", idle, form({ decision: "confirmed" }))).status, "error");
  });
});
