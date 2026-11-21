import { auditLog, db, eq, participantProtocols, participants, protocolVersions, sql, studies } from "@observatorio/db";
import { codePrefix, newEnrollmentCode } from "./codes";
import { isOpen } from "./state";

// Participant and enrollment mutations. Each one runs in a single transaction, locks the
// participant row it changes and writes one audit_log row. The Server Actions in ./actions.ts
// validate the form input and call these.
//
// There is no researcher auth yet: every change is attributed to the study's creator (the seed
// researcher), see studyActor().

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A refusal the researcher can act on; its message is shown in the UI as is (Spanish). */
export class EnrollmentError extends Error {}

async function findStudy(tx: Tx, studyCode: string) {
  const [study] = await tx.select({ id: studies.id, code: studies.code, createdBy: studies.createdBy }).from(studies).where(eq(studies.code, studyCode));
  if (!study) throw new EnrollmentError("El estudio no existe.");
  return study;
}

/** Placeholder until the portal has auth: the researcher who created the study. */
function studyActor(study: { createdBy: string }) {
  return study.createdBy;
}

async function lockParticipant(tx: Tx, studyCode: string, pseudonym: string) {
  const study = await findStudy(tx, studyCode);
  const [participant] = await tx
    .select({
      id: participants.id,
      pseudonym: participants.pseudonym,
      status: participants.status,
      enrollmentCode: participants.enrollmentCode,
      enrollmentCodeUsedAt: participants.enrollmentCodeUsedAt,
      hasToken: sql<boolean>`${participants.tokenSha256} is not null`,
    })
    .from(participants)
    .where(sql`${eq(participants.studyId, study.id)} and ${eq(participants.pseudonym, pseudonym)}`)
    .for("update");
  if (!participant) throw new EnrollmentError(`El participante ${pseudonym} no existe en este estudio.`);
  return { study, participant };
}

async function findPublishedVersion(tx: Tx, studyId: string, versionId: string) {
  const [version] = await tx
    .select({ id: protocolVersions.id, label: protocolVersions.versionLabel })
    .from(protocolVersions)
    .where(sql`${eq(protocolVersions.id, versionId)} and ${eq(protocolVersions.studyId, studyId)} and ${protocolVersions.status} = 'published'`);
  if (!version) throw new EnrollmentError("La versión de protocolo elegida no está publicada en este estudio.");
  return version;
}

/** Codes already handed out in the study, oldest first, to keep new codes in the same format. */
async function studyCodePrefix(tx: Tx, study: { id: string; code: string }) {
  const rows = await tx
    .select({ code: participants.enrollmentCode })
    .from(participants)
    .where(sql`${eq(participants.studyId, study.id)} and ${participants.enrollmentCode} is not null`)
    .orderBy(participants.enrolledAt);
  return codePrefix(study.code, rows.flatMap((row) => (row.code ? [row.code] : [])));
}

/**
 * Ends the participant's protocol assignment at now(): the current row gets valid_to = now(), and
 * rows that would only start later (never in effect) are removed. Returns the label of the
 * assignment that was current, if any.
 */
async function endAssignmentsNow(tx: Tx, participantId: string) {
  const [current] = await tx
    .update(participantProtocols)
    .set({ validTo: sql`now()` })
    .where(
      sql`${eq(participantProtocols.participantId, participantId)} and ${participantProtocols.validFrom} < now()
        and (${participantProtocols.validTo} is null or ${participantProtocols.validTo} > now())`,
    )
    .returning({ versionId: participantProtocols.protocolVersionId });
  const removed = await tx
    .delete(participantProtocols)
    .where(sql`${eq(participantProtocols.participantId, participantId)} and ${participantProtocols.validFrom} >= now()`)
    .returning({ id: participantProtocols.id });
  let label: string | null = null;
  if (current) {
    const [version] = await tx.select({ label: protocolVersions.versionLabel }).from(protocolVersions).where(eq(protocolVersions.id, current.versionId));
    label = version?.label ?? null;
  }
  return { previousLabel: label, removedFutureAssignments: removed.length };
}

async function audit(tx: Tx, actorId: string, action: string, participantId: string, metadata: Record<string, unknown>) {
  // Same marker as the export audit rows: the actor is a placeholder until the portal has auth.
  await tx.insert(auditLog).values({ actorType: "researcher", actorId, action, entity: "participant", entityId: participantId, metadata: { ...metadata, actor_basis: "placeholder_no_auth" } });
}

/** Postgres unique-violation constraint name, if `error` (or a cause) is one. */
function uniqueViolation(error: unknown): string | null {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (code === "23505") return typeof constraint === "string" ? constraint : "";
  }
  return null;
}

function mapUniqueViolation(error: unknown, pseudonym: string): never {
  const constraint = uniqueViolation(error);
  if (constraint?.includes("pseudonym")) throw new EnrollmentError(`El seudónimo ${pseudonym} ya existe en este estudio.`);
  if (constraint?.includes("enrollmentCode")) throw new EnrollmentError("El código generado ya existía. Inténtalo de nuevo.");
  throw error;
}

export type NewParticipant = { studyCode: string; pseudonym: string; arm: string | null; timezone: string; protocolVersionId: string };

/** Creates the participant with a fresh single-use code and assigns the protocol from now. */
export async function createParticipant(input: NewParticipant) {
  try {
    return await db.transaction(async (tx) => {
      const study = await findStudy(tx, input.studyCode);
      const version = await findPublishedVersion(tx, study.id, input.protocolVersionId);
      const enrollmentCode = newEnrollmentCode(await studyCodePrefix(tx, study), input.pseudonym);
      const [participant] = await tx
        .insert(participants)
        .values({ studyId: study.id, pseudonym: input.pseudonym, arm: input.arm, timezone: input.timezone, status: "enrolled", enrollmentCode })
        .returning({ id: participants.id });
      await tx.insert(participantProtocols).values({ participantId: participant.id, protocolVersionId: version.id, validFrom: sql`now()` });
      await audit(tx, studyActor(study), "create_participant", participant.id, {
        study_code: study.code,
        pseudonym: input.pseudonym,
        arm: input.arm,
        timezone: input.timezone,
        protocol_version: version.label,
      });
      return { pseudonym: input.pseudonym, enrollmentCode };
    });
  } catch (error) {
    mapUniqueViolation(error, input.pseudonym);
  }
}

/** Replaces a code the app has not redeemed yet; the previous one stops working. */
export async function regenerateEnrollmentCode(studyCode: string, pseudonym: string) {
  try {
    return await db.transaction(async (tx) => {
      const { study, participant } = await lockParticipant(tx, studyCode, pseudonym);
      if (!isOpen(participant.status)) throw new EnrollmentError("El participante no está activo: no se le puede entregar un código.");
      if (participant.enrollmentCodeUsedAt) throw new EnrollmentError("La app ya canjeó el código de este participante: no se puede regenerar.");
      const enrollmentCode = newEnrollmentCode(await studyCodePrefix(tx, study), participant.pseudonym);
      await tx
        .update(participants)
        .set({ enrollmentCode })
        .where(sql`${eq(participants.id, participant.id)} and ${participants.enrollmentCodeUsedAt} is null`);
      // The codes themselves are credentials until redeemed: they are not copied into the audit log.
      await audit(tx, studyActor(study), "regenerate_enrollment_code", participant.id, {
        study_code: study.code,
        pseudonym: participant.pseudonym,
        replaced_code: participant.enrollmentCode !== null,
      });
      return { pseudonym: participant.pseudonym, enrollmentCode };
    });
  } catch (error) {
    mapUniqueViolation(error, pseudonym);
  }
}

/** Clears the app token hash: the app's next call gets 401 and it has to enroll again. */
export async function revokeParticipantToken(studyCode: string, pseudonym: string) {
  return db.transaction(async (tx) => {
    const { study, participant } = await lockParticipant(tx, studyCode, pseudonym);
    if (!participant.hasToken) throw new EnrollmentError("El participante no tiene un token activo.");
    await tx.update(participants).set({ tokenSha256: null }).where(eq(participants.id, participant.id));
    await audit(tx, studyActor(study), "revoke_participant_token", participant.id, { study_code: study.code, pseudonym: participant.pseudonym });
  });
}

/** Closes the current assignment at now() and opens one for `protocolVersionId` from now(). */
export async function changeParticipantProtocol(studyCode: string, pseudonym: string, protocolVersionId: string) {
  return db.transaction(async (tx) => {
    const { study, participant } = await lockParticipant(tx, studyCode, pseudonym);
    if (!isOpen(participant.status)) throw new EnrollmentError("El participante no está activo: no se le puede cambiar el protocolo.");
    const version = await findPublishedVersion(tx, study.id, protocolVersionId);
    const [current] = await tx
      .select({ versionId: participantProtocols.protocolVersionId })
      .from(participantProtocols)
      .where(
        sql`${eq(participantProtocols.participantId, participant.id)} and ${participantProtocols.validFrom} <= now()
          and (${participantProtocols.validTo} is null or ${participantProtocols.validTo} > now())`,
      );
    if (current?.versionId === version.id) throw new EnrollmentError(`El participante ya está asignado a ${version.label}.`);
    const { previousLabel, removedFutureAssignments } = await endAssignmentsNow(tx, participant.id);
    await tx.insert(participantProtocols).values({ participantId: participant.id, protocolVersionId: version.id, validFrom: sql`now()` });
    await audit(tx, studyActor(study), "change_participant_protocol", participant.id, {
      study_code: study.code,
      pseudonym: participant.pseudonym,
      from_protocol_version: previousLabel,
      to_protocol_version: version.label,
      removed_future_assignments: removedFutureAssignments,
    });
    return { label: version.label };
  });
}

/**
 * Withdraws the participant from now: status 'withdrawn', withdrawn_at, the app token revoked, an
 * unredeemed code invalidated (a redeemed one stays, as the record of the redemption) and the
 * protocol assignment ended. Collected data stays; the study period ends at withdrawn_at.
 */
export async function withdrawParticipant(studyCode: string, pseudonym: string) {
  return db.transaction(async (tx) => {
    const { study, participant } = await lockParticipant(tx, studyCode, pseudonym);
    if (participant.status === "withdrawn") throw new EnrollmentError("El participante ya está retirado.");
    const invalidateCode = participant.enrollmentCode !== null && participant.enrollmentCodeUsedAt === null;
    await tx
      .update(participants)
      .set({
        status: "withdrawn",
        withdrawnAt: sql`now()`,
        tokenSha256: null,
        ...(invalidateCode ? { enrollmentCode: null } : {}),
      })
      .where(eq(participants.id, participant.id));
    const { previousLabel, removedFutureAssignments } = await endAssignmentsNow(tx, participant.id);
    await audit(tx, studyActor(study), "withdraw_participant", participant.id, {
      study_code: study.code,
      pseudonym: participant.pseudonym,
      previous_status: participant.status,
      token_revoked: participant.hasToken,
      code_invalidated: invalidateCode,
      ended_protocol_version: previousLabel,
      removed_future_assignments: removedFutureAssignments,
    });
  });
}
