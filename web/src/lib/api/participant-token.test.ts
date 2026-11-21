import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { closeDb, createStudyWithParticipant, jsonRequest } from "@/test/fixtures";
import { enroll } from "./enrollments";
import { ApiError } from "./errors";
import { authenticateParticipant } from "./participant-token";

const requestWith = (authorization?: string) =>
  new Request("http://localhost/api/v1/uploads", { headers: authorization === undefined ? {} : { authorization } });

const assertUnauthorized = (promise: Promise<unknown>) =>
  assert.rejects(promise, (error) => error instanceof ApiError && error.status === 401 && error.code === "unauthorized");

after(closeDb);

describe("authenticateParticipant", () => {
  test("accepts the token returned by enrollment", async () => {
    const { studyId, participantId, enrollmentCode } = await createStudyWithParticipant();
    const { participant_token } = await (await enroll(jsonRequest("http://localhost/api/v1/enrollments", { code: enrollmentCode }))).json();

    assert.deepEqual(await authenticateParticipant(requestWith(`Bearer ${participant_token}`)), { participantId, studyId });
  });

  test("rejects a missing, malformed or unknown token", async () => {
    await assertUnauthorized(authenticateParticipant(requestWith()));
    await assertUnauthorized(authenticateParticipant(requestWith("Basic abc")));
    await assertUnauthorized(authenticateParticipant(requestWith("Bearer ")));
    await assertUnauthorized(authenticateParticipant(requestWith("Bearer not-a-real-token")));
  });
});
