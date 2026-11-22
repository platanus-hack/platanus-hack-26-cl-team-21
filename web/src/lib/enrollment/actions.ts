"use server";

import { refresh } from "next/cache";
import type { ActionState } from "./action-state";
import { PSEUDONYM_PATTERN } from "./codes";
import {
  changeParticipantProtocol,
  createParticipant,
  EnrollmentError,
  regenerateEnrollmentCode,
  revokeParticipantToken,
  withdrawParticipant,
} from "./mutations";
import { isTimeZone } from "./time-zones";

// Server Actions for the participant pages. Anyone who can reach the portal can POST these, so
// every input is re-validated here and the mutations re-read the rows they change. There is no
// researcher auth yet (see mutations.ts).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARM_MAX_LENGTH = 40;

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function failure(error: unknown, values?: Record<string, string>): ActionState {
  if (error instanceof EnrollmentError) return { status: "error", message: error.message, values };
  console.error(error);
  return { status: "error", message: "No se pudo guardar el cambio. Inténtalo de nuevo.", values };
}

export async function createParticipantAction(studyCode: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = {
    pseudonym: text(formData, "pseudonym").toUpperCase(),
    arm: text(formData, "arm"),
    timezone: text(formData, "timezone"),
    protocolVersionId: text(formData, "protocolVersionId"),
  };
  const invalid = (message: string): ActionState => ({ status: "error", message, values });
  if (!PSEUDONYM_PATTERN.test(values.pseudonym)) return invalid("El seudónimo debe tener la forma P-004 (letras, guion y número). Nunca uses nombres ni otros datos personales.");
  if (values.arm.length > ARM_MAX_LENGTH) return invalid(`El grupo puede tener hasta ${ARM_MAX_LENGTH} caracteres.`);
  if (!isTimeZone(values.timezone)) return invalid("Elige una zona horaria de la lista.");
  if (!UUID.test(values.protocolVersionId)) return invalid("Elige una versión de protocolo publicada.");

  try {
    const created = await createParticipant({ studyCode, ...values, arm: values.arm || null });
    refresh();
    return { status: "done", message: `Participante ${created.pseudonym} creado.`, pseudonym: created.pseudonym, enrollmentCode: created.enrollmentCode };
  } catch (error) {
    return failure(error, values);
  }
}

export async function regenerateCodeAction(studyCode: string, pseudonym: string): Promise<ActionState> {
  try {
    const result = await regenerateEnrollmentCode(studyCode, pseudonym);
    refresh();
    return { status: "done", message: "Código regenerado. El código anterior ya no sirve.", pseudonym: result.pseudonym, enrollmentCode: result.enrollmentCode };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeTokenAction(studyCode: string, pseudonym: string): Promise<ActionState> {
  try {
    await revokeParticipantToken(studyCode, pseudonym);
    refresh();
    return { status: "done", message: "Token revocado. La app de este participante ya no puede subir datos." };
  } catch (error) {
    return failure(error);
  }
}

export async function changeProtocolAction(studyCode: string, pseudonym: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const protocolVersionId = text(formData, "protocolVersionId");
  if (!UUID.test(protocolVersionId)) return { status: "error", message: "Elige una versión de protocolo publicada." };
  try {
    const { label } = await changeParticipantProtocol(studyCode, pseudonym, protocolVersionId);
    refresh();
    return { status: "done", message: `Protocolo cambiado a ${label} desde ahora.` };
  } catch (error) {
    return failure(error);
  }
}

export async function withdrawAction(studyCode: string, pseudonym: string): Promise<ActionState> {
  try {
    await withdrawParticipant(studyCode, pseudonym);
    refresh();
    return { status: "done", message: "Participante retirado." };
  } catch (error) {
    return failure(error);
  }
}
