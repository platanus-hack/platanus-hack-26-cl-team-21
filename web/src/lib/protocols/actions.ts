"use server";

import { auditLog, captureWindows, db, emaItems, eq, eventTypes, protocolVersions } from "@observatorio/db";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getStudyByCode } from "@/lib/queries/studies";
import {
  attributesSchemaFor,
  buildDefinition,
  definitionSha256,
  draftRevision,
  validateDraft,
  validateForPublish,
  variablesFromAttributeSchemas,
} from "./definition";
import { describeActionError, IMMUTABLE_MESSAGE, ProtocolActionError, STALE_MESSAGE } from "./errors";
import { type ActionState, type DraftInput, type DraftEventType, type ProtocolVariable, TYPES_WITH_ALLOWED_VALUES } from "./model";
import { asRecord, getActingResearcherId, readVariables, stringList } from "./queries";

// Mutations of protocol versions. Every action re-reads the study and the version from the DB
// (the form only says which one), validates its input here, runs in one transaction and writes an
// audit_log row. Published versions are immutable: besides the checks below, the DB triggers in
// db/migrations/0002_db_rules.sql reject any change, and that rejection is shown to the researcher.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const protocolsPath = (studyCode: string) => `/studies/${encodeURIComponent(studyCode)}/protocols`;
const versionPath = (studyCode: string, label: string) => `${protocolsPath(studyCode)}/${encodeURIComponent(label)}`;

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

type Actor = { studyId: string; studyCode: string; researcherId: string };

async function resolveStudy(formData: FormData): Promise<Actor> {
  const study = await getStudyByCode(text(formData, "study_code"));
  if (!study) throw new ProtocolActionError(["El estudio no existe."]);
  const researcherId = await getActingResearcherId(study.id);
  if (!researcherId) throw new ProtocolActionError(["No hay un investigador al que atribuir el cambio."]);
  return { studyId: study.id, studyCode: study.code, researcherId };
}

function versionIdFrom(formData: FormData) {
  const id = text(formData, "version_id");
  if (!UUID.test(id)) throw new ProtocolActionError(["La versión indicada no es válida."]);
  return id;
}

/** Locks the version row for the rest of the transaction; it must belong to the study. */
async function lockVersion(tx: Tx, actor: Actor, versionId: string) {
  const [row] = await tx
    .select({
      id: protocolVersions.id,
      studyId: protocolVersions.studyId,
      versionLabel: protocolVersions.versionLabel,
      changeNote: protocolVersions.changeNote,
      status: protocolVersions.status,
      definition: protocolVersions.definition,
      parentVersionId: protocolVersions.parentVersionId,
    })
    .from(protocolVersions)
    .where(eq(protocolVersions.id, versionId))
    .for("update");
  if (!row || row.studyId !== actor.studyId) throw new ProtocolActionError(["La versión no existe en este estudio."]);
  return row;
}

/**
 * Locks a draft for save/publish and checks the form was loaded from its current state: without
 * this, a stale tab would overwrite a newer save, or publish (immutably) content nobody reviewed.
 */
async function lockDraft(tx: Tx, actor: Actor, formData: FormData) {
  const row = await lockVersion(tx, actor, versionIdFrom(formData));
  if (row.status !== "draft") throw new ProtocolActionError([IMMUTABLE_MESSAGE]);
  const stored = await tx.select({ key: eventTypes.key, label: eventTypes.label }).from(eventTypes).where(eq(eventTypes.protocolVersionId, row.id));
  if (text(formData, "revision") !== draftRevision({ ...row, eventTypes: stored })) throw new ProtocolActionError([STALE_MESSAGE]);
  return row;
}

function audit(tx: Tx, actor: Actor, action: string, versionId: string, metadata: Record<string, unknown>) {
  return tx.insert(auditLog).values({
    actorType: "researcher",
    actorId: actor.researcherId,
    action,
    entity: "protocol_versions",
    entityId: versionId,
    // No auth yet: says the actor is a placeholder, so the trail doesn't claim who really acted.
    metadata: { actor_basis: "placeholder_no_auth", study_id: actor.studyId, study_code: actor.studyCode, ...metadata },
  });
}

// --- Parsing the editor form ---

function parseLines(value: string) {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

/** Reads the editor form. Shape problems are errors; content rules are checked by validateDraft. */
function parseDraftForm(formData: FormData): DraftInput {
  let structure: { eventTypes?: unknown; variables?: unknown };
  try {
    structure = asRecord(JSON.parse(text(formData, "structure")));
  } catch {
    throw new ProtocolActionError(["El formulario llegó incompleto. Recarga la página e intenta de nuevo."]);
  }
  if (!Array.isArray(structure.eventTypes) || !Array.isArray(structure.variables)) {
    throw new ProtocolActionError(["El formulario llegó incompleto. Recarga la página e intenta de nuevo."]);
  }
  const eventTypes: DraftEventType[] = structure.eventTypes.map((raw) => {
    const e = asRecord(raw);
    return { key: String(e.key ?? "").trim(), label: String(e.label ?? "").trim() };
  });
  const variables: ProtocolVariable[] = structure.variables.map((raw) => {
    const v = asRecord(raw);
    const type = String(v.type ?? "") as ProtocolVariable["type"];
    const description = String(v.description ?? "").trim();
    const values = stringList(v.allowed_values).map((value) => value.trim()).filter(Boolean);
    return {
      name: String(v.name ?? "").trim(),
      type,
      ...(description ? { description } : {}),
      // Values typed for a type that doesn't take them are dropped, not stored.
      ...(values.length > 0 && TYPES_WITH_ALLOWED_VALUES.includes(type) ? { allowed_values: values } : {}),
      required: v.required === true,
      applies_to: [...new Set(stringList(v.applies_to))],
    };
  });
  return {
    versionLabel: text(formData, "version_label").trim(),
    changeNote: text(formData, "change_note").trim(),
    observationPrompt: text(formData, "observation_prompt").trim(),
    outOfScope: parseLines(text(formData, "out_of_scope")),
    eventTypes,
    variables,
  };
}

/** Upserts the version's event_types by key (ids stay stable) and deletes the keys that were removed. */
async function syncEventTypes(tx: Tx, versionId: string, draft: DraftInput) {
  const existing = await tx.select({ id: eventTypes.id, key: eventTypes.key }).from(eventTypes).where(eq(eventTypes.protocolVersionId, versionId));
  const wanted = new Set(draft.eventTypes.map((eventType) => eventType.key));
  for (const row of existing) {
    if (!wanted.has(row.key)) await tx.delete(eventTypes).where(eq(eventTypes.id, row.id));
  }
  const byKey = new Map(existing.map((row) => [row.key, row.id]));
  for (const eventType of draft.eventTypes) {
    const values = { label: eventType.label, attributesSchema: attributesSchemaFor(eventType.key, draft.variables) };
    const id = byKey.get(eventType.key);
    if (id) await tx.update(eventTypes).set(values).where(eq(eventTypes.id, id));
    else await tx.insert(eventTypes).values({ protocolVersionId: versionId, key: eventType.key, ...values });
  }
}

/** Writes the draft (label, note, definition, event types). The row must come from lockDraft. */
async function writeDraft(tx: Tx, row: Awaited<ReturnType<typeof lockDraft>>, draft: DraftInput) {
  const definition = buildDefinition(asRecord(row.definition), draft);
  await tx
    .update(protocolVersions)
    .set({ versionLabel: draft.versionLabel, changeNote: draft.changeNote || null, definition })
    .where(eq(protocolVersions.id, row.id));
  await syncEventTypes(tx, row.id, draft);
  return definition;
}

// --- Actions ---

/** Creates a draft from scratch or as a copy of a published/retired version, then opens it. */
export async function createDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let target: string;
  const versionLabel = text(formData, "version_label").trim();
  try {
    const actor = await resolveStudy(formData);
    const baseId = text(formData, "base_version_id");
    const draft: DraftInput = { versionLabel, changeNote: "", observationPrompt: "", outOfScope: [], eventTypes: [], variables: [] };
    const labelErrors = validateDraft(draft);
    if (labelErrors.length > 0) throw new ProtocolActionError(labelErrors);

    await db.transaction(async (tx) => {
      let base: Record<string, unknown> = {};
      let parentLabel: string | null = null;
      let inherited: { key: string; label: string; attributesSchema: unknown }[] = [];
      if (baseId) {
        if (!UUID.test(baseId)) throw new ProtocolActionError(["La versión base no es válida."]);
        const parent = await lockVersion(tx, actor, baseId);
        if (parent.status === "draft") throw new ProtocolActionError(["Solo se puede copiar una versión publicada o retirada, no un borrador."]);
        base = asRecord(parent.definition);
        parentLabel = parent.versionLabel;
        inherited = await tx
          .select({ key: eventTypes.key, label: eventTypes.label, attributesSchema: eventTypes.attributesSchema })
          .from(eventTypes)
          .where(eq(eventTypes.protocolVersionId, parent.id));
        const order = stringList(base.event_types);
        inherited.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
        // A parent without variables in its definition (the seeded eating-v1) still has them as
        // event_types schemas: bring them over so the copy measures the same things.
        draft.variables = readVariables(base);
        if (draft.variables.length === 0) {
          const imported = variablesFromAttributeSchemas(inherited);
          // Refuse rather than copy schemas that the first save would silently replace.
          if (!imported) {
            throw new ProtocolActionError([
              `No se puede copiar «${parent.versionLabel}»: el esquema de atributos de sus tipos de evento usa reglas que el editor no puede representar como variables. Crea el borrador desde cero.`,
            ]);
          }
          draft.variables = imported;
        }
        draft.eventTypes = inherited.map(({ key, label }) => ({ key, label }));
        draft.observationPrompt = typeof base.observation_prompt === "string" ? base.observation_prompt : "";
        draft.outOfScope = stringList(base.out_of_scope);
      }
      const definition = buildDefinition(base, draft);
      const [created] = await tx
        .insert(protocolVersions)
        .values({ studyId: actor.studyId, versionLabel, parentVersionId: baseId || null, definition, status: "draft" })
        .returning({ id: protocolVersions.id });
      if (draft.eventTypes.length > 0) {
        await tx.insert(eventTypes).values(
          inherited.map((eventType) => ({
            protocolVersionId: created.id,
            key: eventType.key,
            label: eventType.label,
            attributesSchema: attributesSchemaFor(eventType.key, draft.variables),
          })),
        );
      }
      await audit(tx, actor, "protocol_draft_create", created.id, {
        version_label: versionLabel,
        parent_version_id: baseId || null,
        parent_version_label: parentLabel,
        variables_imported_from_event_schemas: baseId !== "" && readVariables(base).length === 0 && draft.variables.length > 0,
      });
    });
    target = versionPath(actor.studyCode, versionLabel);
  } catch (error) {
    return { status: "error", errors: describeActionError(error, { versionLabel }) };
  }
  redirect(target);
}

/** Saves the editor form into the draft. */
export async function saveDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let draft: DraftInput | undefined;
  let renamedTo: string | null = null;
  let studyCode = "";
  try {
    const actor = await resolveStudy(formData);
    studyCode = actor.studyCode;
    draft = parseDraftForm(formData);
    const errors = validateDraft(draft);
    if (errors.length > 0) throw new ProtocolActionError(errors);
    const input = draft;
    await db.transaction(async (tx) => {
      const row = await lockDraft(tx, actor, formData);
      const definition = await writeDraft(tx, row, input);
      await audit(tx, actor, "protocol_draft_update", row.id, {
        version_label: input.versionLabel,
        ...(row.versionLabel !== input.versionLabel ? { previous_version_label: row.versionLabel } : {}),
        event_types: definition.event_types,
        variables: definition.variables.map((variable) => variable.name),
        draft_definition_sha256: definitionSha256(definition),
      });
      if (row.versionLabel !== input.versionLabel) renamedTo = input.versionLabel;
    });
  } catch (error) {
    return { status: "error", errors: describeActionError(error, { versionLabel: draft?.versionLabel }) };
  }
  // The URL carries the label: follow a rename, otherwise re-render the page in place.
  if (renamedTo) redirect(versionPath(studyCode, renamedTo));
  refresh();
  return { status: "saved", savedAt: new Date().toISOString() };
}

/**
 * Saves the form, validates the draft against the definition contract and publishes it, all in one
 * transaction: if anything fails, nothing is saved or published.
 */
export async function publishDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let draft: DraftInput | undefined;
  let target: string;
  try {
    const actor = await resolveStudy(formData);
    draft = parseDraftForm(formData);
    const input = draft;
    await db.transaction(async (tx) => {
      const row = await lockDraft(tx, actor, formData);
      const errors = validateForPublish(input, buildDefinition(asRecord(row.definition), input));
      if (errors.length > 0) throw new ProtocolActionError(errors);
      const definition = await writeDraft(tx, row, input);
      const sha256 = definitionSha256(definition);
      const publishedAt = new Date();
      await tx
        .update(protocolVersions)
        .set({ status: "published", definitionSha256: sha256, publishedAt, publishedBy: actor.researcherId })
        .where(eq(protocolVersions.id, row.id));
      await audit(tx, actor, "protocol_publish", row.id, {
        version_label: input.versionLabel,
        parent_version_id: row.parentVersionId,
        definition_sha256: sha256,
        event_types: definition.event_types,
        variables: definition.variables.map((variable) => variable.name),
        published_at: publishedAt.toISOString(),
      });
    });
    target = versionPath(actor.studyCode, input.versionLabel);
  } catch (error) {
    return { status: "error", errors: describeActionError(error, { versionLabel: draft?.versionLabel }) };
  }
  redirect(target);
}

/** Marks a published version as retired: it stays immutable and keeps its assignments. */
export async function retireVersionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await resolveStudy(formData);
    const versionId = versionIdFrom(formData);
    await db.transaction(async (tx) => {
      const row = await lockVersion(tx, actor, versionId);
      if (row.status !== "published") throw new ProtocolActionError(["Solo se puede retirar una versión publicada."]);
      await tx.update(protocolVersions).set({ status: "retired" }).where(eq(protocolVersions.id, row.id));
      await audit(tx, actor, "protocol_retire", row.id, { version_label: row.versionLabel });
    });
  } catch (error) {
    return { status: "error", errors: describeActionError(error) };
  }
  refresh();
  return { status: "saved", savedAt: new Date().toISOString() };
}

/** Deletes a draft and its children. Published and retired versions can never be deleted. */
export async function deleteDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let target: string;
  try {
    const actor = await resolveStudy(formData);
    const versionId = versionIdFrom(formData);
    await db.transaction(async (tx) => {
      const row = await lockVersion(tx, actor, versionId);
      if (row.status !== "draft") throw new ProtocolActionError(["Solo se pueden eliminar borradores."]);
      await tx.delete(eventTypes).where(eq(eventTypes.protocolVersionId, row.id));
      await tx.delete(emaItems).where(eq(emaItems.protocolVersionId, row.id));
      await tx.delete(captureWindows).where(eq(captureWindows.protocolVersionId, row.id));
      await tx.delete(protocolVersions).where(eq(protocolVersions.id, row.id));
      await audit(tx, actor, "protocol_draft_delete", row.id, { version_label: row.versionLabel });
    });
    target = protocolsPath(actor.studyCode);
  } catch (error) {
    return { status: "error", errors: describeActionError(error) };
  }
  redirect(target);
}
