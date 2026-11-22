import { db, eq, participantProtocols, participants, protocolVersions, sql } from "@observatorio/db";
import { nextPseudonym } from "./codes";
import { type EnrollmentState, enrollmentState } from "./state";

// Read models for the participant list, the new-participant form and the manage page. Callers
// must `await connection()` first. Token hashes and codes never leave this module: pages get an
// EnrollmentState.

// Assignment valid now; the no-overlap rule leaves at most one per participant.
const currentAssignment = sql`${participantProtocols.validFrom} <= now()
  and (${participantProtocols.validTo} is null or ${participantProtocols.validTo} > now())`;

const enrollmentColumns = {
  hasCode: sql<boolean>`${participants.enrollmentCode} is not null`,
  codeUsedAt: participants.enrollmentCodeUsedAt,
  hasToken: sql<boolean>`${participants.tokenSha256} is not null`,
};

export type ParticipantListItem = {
  pseudonym: string;
  arm: string | null;
  status: string;
  timezone: string;
  enrolledAt: Date;
  withdrawnAt: Date | null;
  protocolLabel: string | null;
  enrollment: EnrollmentState;
};

export async function listParticipants(studyId: string): Promise<ParticipantListItem[]> {
  const rows = await db
    .select({
      pseudonym: participants.pseudonym,
      arm: participants.arm,
      status: participants.status,
      timezone: participants.timezone,
      enrolledAt: participants.enrolledAt,
      withdrawnAt: participants.withdrawnAt,
      protocolLabel: protocolVersions.versionLabel,
      ...enrollmentColumns,
    })
    .from(participants)
    .leftJoin(participantProtocols, sql`${eq(participantProtocols.participantId, participants.id)} and ${currentAssignment}`)
    .leftJoin(protocolVersions, eq(protocolVersions.id, participantProtocols.protocolVersionId))
    .where(eq(participants.studyId, studyId))
    .orderBy(participants.pseudonym);
  return rows.map(({ hasCode, codeUsedAt, hasToken, ...row }) => ({ ...row, enrollment: enrollmentState({ hasCode, codeUsedAt, hasToken }) }));
}

export type PublishedVersion = { id: string; label: string; publishedAt: Date | null };

/** Versions a participant can be assigned to: published (not draft, not retired), newest first. */
export async function listPublishedVersions(studyId: string): Promise<PublishedVersion[]> {
  return db
    .select({ id: protocolVersions.id, label: protocolVersions.versionLabel, publishedAt: protocolVersions.publishedAt })
    .from(protocolVersions)
    .where(sql`${eq(protocolVersions.studyId, studyId)} and ${protocolVersions.status} = 'published'`)
    .orderBy(sql`${protocolVersions.publishedAt} desc nulls last`, protocolVersions.versionLabel);
}

export type NewParticipantDefaults = {
  suggestedPseudonym: string;
  arms: string[];
  versions: PublishedVersion[];
};

export async function getNewParticipantDefaults(studyId: string): Promise<NewParticipantDefaults> {
  const [rows, versions] = await Promise.all([
    db.select({ pseudonym: participants.pseudonym, arm: participants.arm }).from(participants).where(eq(participants.studyId, studyId)),
    listPublishedVersions(studyId),
  ]);
  const arms = [...new Set(rows.flatMap((row) => (row.arm ? [row.arm] : [])))].sort();
  return { suggestedPseudonym: nextPseudonym(rows.map((row) => row.pseudonym)), arms, versions };
}

export type ProtocolAssignment = { label: string; validFrom: Date; validTo: Date | null; current: boolean };

export type ManagedParticipant = {
  pseudonym: string;
  arm: string | null;
  status: string;
  timezone: string;
  enrolledAt: Date;
  withdrawnAt: Date | null;
  enrollment: EnrollmentState;
  assignments: ProtocolAssignment[];
  currentVersionId: string | null;
  versions: PublishedVersion[];
};

export async function getManagedParticipant(studyId: string, pseudonym: string): Promise<ManagedParticipant | null> {
  const [participant] = await db
    .select({
      id: participants.id,
      pseudonym: participants.pseudonym,
      arm: participants.arm,
      status: participants.status,
      timezone: participants.timezone,
      enrolledAt: participants.enrolledAt,
      withdrawnAt: participants.withdrawnAt,
      ...enrollmentColumns,
    })
    .from(participants)
    .where(sql`${eq(participants.studyId, studyId)} and ${eq(participants.pseudonym, pseudonym)}`);
  if (!participant) return null;

  const [assignments, versions] = await Promise.all([
    db
      .select({
        versionId: participantProtocols.protocolVersionId,
        label: protocolVersions.versionLabel,
        validFrom: participantProtocols.validFrom,
        validTo: participantProtocols.validTo,
        current: sql<boolean>`${currentAssignment}`,
      })
      .from(participantProtocols)
      .innerJoin(protocolVersions, eq(protocolVersions.id, participantProtocols.protocolVersionId))
      .where(eq(participantProtocols.participantId, participant.id))
      .orderBy(participantProtocols.validFrom),
    listPublishedVersions(studyId),
  ]);

  return {
    pseudonym: participant.pseudonym,
    arm: participant.arm,
    status: participant.status,
    timezone: participant.timezone,
    enrolledAt: participant.enrolledAt,
    withdrawnAt: participant.withdrawnAt,
    enrollment: enrollmentState(participant),
    assignments: assignments.map(({ label, validFrom, validTo, current }) => ({ label, validFrom, validTo, current })),
    currentVersionId: assignments.find((assignment) => assignment.current)?.versionId ?? null,
    versions,
  };
}
