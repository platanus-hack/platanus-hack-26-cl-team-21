"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/enrollment/action-state";
import { NOTE_MAX_LENGTH, REVIEW_DECISIONS, type ReviewDecision, ReviewError, reviewObservation } from "./mutations";

// Anyone who can reach the portal can POST this, so the input is re-validated here (there is no researcher auth yet).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function reviewObservationAction(studyCode: string, observationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const decision = formData.get("decision");
  const rawNote = formData.get("note");
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  const values = { note };
  if (!UUID.test(observationId)) return { status: "error", message: "La observación no es válida.", values };
  if (typeof decision !== "string" || !REVIEW_DECISIONS.includes(decision as ReviewDecision)) return { status: "error", message: "Elige si confirmas o rechazas la observación.", values };
  if (note.length > NOTE_MAX_LENGTH) return { status: "error", message: `La nota puede tener hasta ${NOTE_MAX_LENGTH} caracteres.`, values };

  try {
    await reviewObservation({ studyCode, observationId, decision: decision as ReviewDecision, note: note || null });
    refresh();
    return { status: "done", message: decision === "confirmed" ? "Observación confirmada." : "Observación rechazada: ya no aparece en listas ni exportaciones." };
  } catch (error) {
    if (error instanceof ReviewError) return { status: "error", message: error.message, values };
    console.error(error);
    return { status: "error", message: "No se pudo guardar la revisión. Inténtalo de nuevo.", values };
  }
}
