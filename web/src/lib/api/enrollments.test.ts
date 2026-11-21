import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { db, deviceAssignments, eq, participants } from "@observatorio/db";
import { closeDb, createDevice, createStudyWithParticipant, jsonRequest, PROTOCOL_LABEL } from "@/test/fixtures";
import { enroll as handleEnrollment } from "./enrollments";
import { hashParticipantToken } from "./participant-token";

const ENROLLMENTS_URL = "http://localhost/api/v1/enrollments";
const enroll = (body: unknown) => handleEnrollment(jsonRequest(ENROLLMENTS_URL, body));

after(closeDb);

describe("POST /api/v1/enrollments", () => {
  test("redeems an unused code and stores only the token hash", async () => {
    const { studyId, participantId, enrollmentCode } = await createStudyWithParticipant();

    const response = await enroll({ code: enrollmentCode });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["participant_id", "participant_token", "protocol_version", "study_id"]);
    assert.equal(body.participant_id, participantId);
    assert.equal(body.study_id, studyId);
    assert.equal(body.protocol_version, PROTOCOL_LABEL);
    assert.match(body.participant_token, /^[A-Za-z0-9_-]{43}$/);
    const [stored] = await db.select().from(participants).where(eq(participants.id, participantId));
    assert.equal(stored.tokenSha256, hashParticipantToken(body.participant_token));
    assert.ok(stored.enrollmentCodeUsedAt);
  });

  test("returns 404 for an unknown code", async () => {
    const response = await enroll({ code: "NOPE-000" });

    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "enrollment_code_not_found");
  });

  test("returns 409 for a used code", async () => {
    const { enrollmentCode } = await createStudyWithParticipant({ redeemed: true });

    const response = await enroll({ code: enrollmentCode });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: { code: "enrollment_code_used", message: "Enrollment code was already used" } });
  });

  test("redeems a code only once under concurrent requests", async () => {
    const { enrollmentCode } = await createStudyWithParticipant();

    const statuses = (await Promise.all(Array.from({ length: 5 }, () => enroll({ code: enrollmentCode })))).map((r) => r.status);

    assert.deepEqual(statuses.sort(), [201, 409, 409, 409, 409]);
  });

  test("rejects a missing code or a non-JSON body", async () => {
    for (const request of [jsonRequest(ENROLLMENTS_URL, {}), jsonRequest(ENROLLMENTS_URL, []), new Request(ENROLLMENTS_URL, { method: "POST", body: "nope" })]) {
      const response = await handleEnrollment(request);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "invalid_request");
    }
  });

  test("returns 400 for an unknown device and leaves the code unused", async () => {
    const { participantId, enrollmentCode } = await createStudyWithParticipant();

    const response = await enroll({ code: enrollmentCode, device_id: "no-such-device" });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_request");
    const [stored] = await db.select().from(participants).where(eq(participants.id, participantId));
    assert.equal(stored.enrollmentCodeUsedAt, null);
    assert.equal(stored.tokenSha256, null);
  });

  test("moves the device to the enrolling participant", async () => {
    const device = await createDevice();
    const previous = await createStudyWithParticipant();
    await db.insert(deviceAssignments).values({ deviceId: device.id, participantId: previous.participantId, validFrom: new Date(Date.now() - 60_000) });
    const { participantId, enrollmentCode } = await createStudyWithParticipant();

    const response = await enroll({ code: enrollmentCode, device_id: device.serial });

    assert.equal(response.status, 201);
    const assignments = await db.select().from(deviceAssignments).where(eq(deviceAssignments.deviceId, device.id));
    const open = assignments.filter((assignment) => assignment.validTo === null);
    assert.equal(assignments.length, 2);
    assert.deepEqual(open.map((assignment) => assignment.participantId), [participantId]);
  });

  test("serializes concurrent enrollments for the same device", async () => {
    const device = await createDevice();
    const enrollments = await Promise.all(Array.from({ length: 6 }, () => createStudyWithParticipant()));

    const responses = await Promise.all(
      enrollments.map(({ enrollmentCode }) => enroll({ code: enrollmentCode, device_id: device.serial })),
    );

    assert.deepEqual(responses.map(({ status }) => status), enrollments.map(() => 201));
    const assignments = await db.select().from(deviceAssignments).where(eq(deviceAssignments.deviceId, device.id));
    assert.equal(assignments.length, enrollments.length);
    assert.equal(assignments.filter(({ validTo }) => validTo === null).length, 1);
  });
});
