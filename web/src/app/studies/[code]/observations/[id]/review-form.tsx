"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { IDLE } from "@/lib/enrollment/action-state";
import { reviewObservationAction } from "@/lib/review/actions";
import { FIELD, FIELD_LABEL } from "@/lib/ui";

/** Confirm or reject an observation after watching its evidence. Each submit appends a review: the latest one wins. */
export function ReviewForm({ studyCode, observationId }: { studyCode: string; observationId: string }) {
  const [state, formAction] = useActionState(reviewObservationAction.bind(null, studyCode, observationId), IDLE);
  const note = state.status === "error" ? (state.values?.note ?? "") : "";
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink-muted">¿Qué muestra la evidencia?</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="decision" value="confirmed" required /> La observación es correcta
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="decision" value="rejected" required /> La observación es incorrecta: rechazarla
        </label>
        <p className="text-xs text-ink-muted">Una observación rechazada deja de aparecer en listas y exportaciones. Puedes cambiar la decisión después: queda el historial.</p>
      </fieldset>
      <label className={FIELD_LABEL}>
        Nota (opcional)
        <textarea name="note" rows={3} maxLength={500} defaultValue={note} className={`${FIELD} py-2`} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton idle="Guardar revisión" busy="Guardando…" />
        <p role="status" className={`text-sm ${state.status === "error" ? "text-error" : "text-ink-muted"}`}>
          {state.status === "idle" ? null : state.message}
        </p>
      </div>
    </form>
  );
}
