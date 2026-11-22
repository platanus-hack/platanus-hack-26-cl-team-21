import { auditLog, db, eq, observationReviews, sql, studies } from "@observatorio/db";

// Human review of an observation: an append-only row, the latest one wins (see v_current_observations). The Server
// Action in ./actions.ts validates the form and calls this. There is no researcher auth yet: the review is attributed
// to the study's creator (the same placeholder as exports and participant changes).

export const REVIEW_DECISIONS = ["confirmed", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const NOTE_MAX_LENGTH = 500;

/** A refusal the researcher can act on; its message is shown in the UI as is (Spanish). */
export class ReviewError extends Error {}

export async function reviewObservation(input: { studyCode: string; observationId: string; decision: ReviewDecision; note: string | null }) {
  return db.transaction(async (tx) => {
    const [study] = await tx.select({ id: studies.id, createdBy: studies.createdBy }).from(studies).where(eq(studies.code, input.studyCode));
    if (!study) throw new ReviewError("El estudio no existe.");

    // Locked so a concurrent re-run that supersedes it can't slip in between this check and the insert.
    const { rows } = await tx.execute<{ superseded: boolean }>(sql`
      select o.superseded_by_run_id is not null as superseded
      from observations o join participants p on p.id = o.participant_id
      where o.id = ${input.observationId} and p.study_id = ${study.id}
      for no key update of o`);
    if (rows.length === 0) throw new ReviewError("La observación no existe en este estudio.");
    if (rows[0].superseded) throw new ReviewError("Esta observación fue reemplazada por una ejecución más reciente: revisa la actual.");

    await tx.insert(observationReviews).values({
      observationId: input.observationId,
      reviewerId: study.createdBy,
      decision: input.decision,
      note: input.note,
    });
    await tx.insert(auditLog).values({
      actorType: "researcher",
      actorId: study.createdBy,
      action: "review_observation",
      entity: "observation",
      entityId: input.observationId,
      metadata: { decision: input.decision, actor_basis: "placeholder_no_auth" },
    });
  });
}
