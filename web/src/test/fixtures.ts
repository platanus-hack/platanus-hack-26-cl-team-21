import { randomUUID } from "node:crypto";
import { db, devices, participantProtocols, participants, protocolVersions, researchers, studies } from "@observatorio/db";

export const PROTOCOL_LABEL = "test-v1";

// Every call creates its own rows with unique codes, so tests can run against a seeded or reused DB.
export async function createStudyWithParticipant({ redeemed = false } = {}) {
  const suffix = randomUUID();
  const [researcher] = await db.insert(researchers).values({ email: `${suffix}@test.local`, fullName: "Test Researcher" }).returning();
  const [study] = await db.insert(studies).values({ code: `test-${suffix}`, title: "Test study", createdBy: researcher.id }).returning();
  const [protocol] = await db.insert(protocolVersions).values({ studyId: study.id, versionLabel: PROTOCOL_LABEL, definition: {}, status: "published", definitionSha256: "0".repeat(64), publishedAt: new Date() }).returning();
  const enrollmentCode = `TEST-${suffix}`;
  const [participant] = await db
    .insert(participants)
    .values({ studyId: study.id, pseudonym: "P-01", enrollmentCode, enrollmentCodeUsedAt: redeemed ? new Date() : null })
    .returning();
  await db.insert(participantProtocols).values({ participantId: participant.id, protocolVersionId: protocol.id, validFrom: new Date(Date.now() - 60_000) });
  return { studyId: study.id, participantId: participant.id, enrollmentCode };
}

export async function createDevice() {
  const [device] = await db.insert(devices).values({ serial: `dev-${randomUUID()}`, hardwareRevision: "test", formFactor: "pendant" }).returning();
  return device;
}

export const jsonRequest = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

export const closeDb = () => db.$client.end();
