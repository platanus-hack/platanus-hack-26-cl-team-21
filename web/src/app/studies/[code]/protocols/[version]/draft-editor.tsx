"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { DISPLAY_TIME_ZONE, formatTime } from "@/lib/format";
import { publishDraftAction, saveDraftAction } from "@/lib/protocols/actions";
import {
  type ActionState,
  type DraftEventType,
  IDLE,
  LIMITS,
  type ProtocolVariable,
  TYPES_WITH_ALLOWED_VALUES,
  VARIABLE_TYPE_LABELS,
  VARIABLE_TYPES,
  type VariableType,
} from "@/lib/protocols/model";
import { ActionFeedback } from "../action-feedback";
import { submitWithoutReset } from "../submit-without-reset";
import { cardClass, focusRing, hintClass, inputClass, labelClass, primaryButton, secondaryButton, sectionTitle } from "../styles";

export type DraftEditorInitial = {
  versionLabel: string;
  changeNote: string;
  observationPrompt: string;
  outOfScope: string[];
  eventTypes: DraftEventType[];
  variables: ProtocolVariable[];
};

// Rows carry a client-only uid so React keys and the "applies to" links survive renaming a key.
type EventRow = { uid: string; key: string; label: string };
type VariableRow = {
  uid: string;
  name: string;
  type: VariableType;
  description: string;
  valuesText: string; // one allowed value per line
  required: boolean;
  appliesTo: string[]; // event row uids
};
type Fields = { versionLabel: string; changeNote: string; observationPrompt: string; outOfScopeText: string };

const KEY_INPUT_PATTERN = "[a-z][a-z0-9_]*";
const KEY_HINT = "snake_case: minúsculas, números y _, empieza con letra";

function toRows(initial: DraftEditorInitial) {
  const eventRows: EventRow[] = initial.eventTypes.map((eventType, i) => ({ uid: `e${i}`, ...eventType }));
  const uidByKey = new Map(eventRows.map((row) => [row.key, row.uid]));
  const variableRows: VariableRow[] = initial.variables.map((variable, i) => ({
    uid: `v${i}`,
    name: variable.name,
    type: variable.type,
    description: variable.description ?? "",
    valuesText: (variable.allowed_values ?? []).join("\n"),
    required: variable.required,
    appliesTo: variable.applies_to.flatMap((key) => uidByKey.get(key) ?? []),
  }));
  return { eventRows, variableRows };
}

const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/** What the server receives in the hidden "structure" field (and what "unsaved changes" compares). */
function serializeStructure(eventRows: EventRow[], variableRows: VariableRow[]) {
  const keyByUid = new Map(eventRows.map((row) => [row.uid, row.key.trim()]));
  return JSON.stringify({
    eventTypes: eventRows.map((row) => ({ key: row.key.trim(), label: row.label.trim() })),
    variables: variableRows.map((row) => ({
      name: row.name.trim(),
      type: row.type,
      description: row.description.trim(),
      allowed_values: TYPES_WITH_ALLOWED_VALUES.includes(row.type) ? lines(row.valuesText) : [],
      required: row.required,
      applies_to: row.appliesTo.flatMap((uid) => keyByUid.get(uid) ?? []),
    })),
  });
}

// Out of scope is deduplicated like the server does, so a repeated line doesn't look unsaved forever.
const snapshot = (fields: Fields, structure: string) =>
  JSON.stringify([fields.versionLabel.trim(), fields.changeNote.trim(), fields.observationPrompt.trim(), [...new Set(lines(fields.outOfScopeText))], structure]);

function initialFields(initial: DraftEditorInitial): Fields {
  return {
    versionLabel: initial.versionLabel,
    changeNote: initial.changeNote,
    observationPrompt: initial.observationPrompt,
    outOfScopeText: initial.outOfScope.join("\n"),
  };
}

// One action for both submit buttons: the button's name/value says which.
function submitDraft(prev: ActionState, formData: FormData) {
  return formData.get("intent") === "publish" ? publishDraftAction(prev, formData) : saveDraftAction(prev, formData);
}

export function DraftEditor({
  studyCode,
  versionId,
  initial,
  revision,
}: {
  studyCode: string;
  versionId: string;
  initial: DraftEditorInitial;
  /** Identifies the saved state this form was loaded from (draftRevision); the server rejects stale forms. */
  revision: string;
}) {
  const [state, formAction, pending] = useActionState(submitDraft, IDLE);
  const [fields, setFields] = useState(() => initialFields(initial));
  const [rows, setRows] = useState(() => toRows(initial));
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const nextUid = useRef(0);
  const focusUid = useRef<string | null>(null);

  const { eventRows, variableRows } = rows;
  const structure = serializeStructure(eventRows, variableRows);
  // The saved state is the server's: after a save the page re-renders with new `initial`.
  const initialRows = toRows(initial);
  const dirty = snapshot(fields, structure) !== snapshot(initialFields(initial), serializeStructure(initialRows.eventRows, initialRows.variableRows));

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const newUid = (prefix: string) => {
    nextUid.current += 1;
    const uid = `${prefix}new${nextUid.current}`;
    focusUid.current = uid;
    return uid;
  };
  // Moves focus to the first field of a row that was just added.
  const focusIfNew = (uid: string) => (element: HTMLInputElement | null) => {
    if (element && focusUid.current === uid) {
      focusUid.current = null;
      element.focus();
    }
  };
  const setField = (name: keyof Fields) => (value: string) => setFields((current) => ({ ...current, [name]: value }));

  const updateEvent = (uid: string, patch: Partial<EventRow>) =>
    setRows((current) => ({ ...current, eventRows: current.eventRows.map((row) => (row.uid === uid ? { ...row, ...patch } : row)) }));
  const addEvent = () => {
    const uid = newUid("e");
    setRows((current) => ({ ...current, eventRows: [...current.eventRows, { uid, key: "", label: "" }] }));
  };
  const removeEvent = (uid: string) =>
    setRows((current) => ({
      eventRows: current.eventRows.filter((row) => row.uid !== uid),
      variableRows: current.variableRows.map((row) => ({ ...row, appliesTo: row.appliesTo.filter((eventUid) => eventUid !== uid) })),
    }));

  const updateVariable = (uid: string, patch: Partial<VariableRow>) =>
    setRows((current) => ({ ...current, variableRows: current.variableRows.map((row) => (row.uid === uid ? { ...row, ...patch } : row)) }));
  const addVariable = () => {
    const uid = newUid("v");
    setRows((current) => ({
      ...current,
      variableRows: [
        ...current.variableRows,
        // New variables apply to every event type by default; untick what doesn't apply.
        { uid, name: "", type: "enum", description: "", valuesText: "", required: true, appliesTo: current.eventRows.map((row) => row.uid) },
      ],
    }));
  };
  const removeVariable = (uid: string) => setRows((current) => ({ ...current, variableRows: current.variableRows.filter((row) => row.uid !== uid) }));

  const outOfScope = lines(fields.outOfScopeText).map((item) => item.toLowerCase());
  const overlapping = variableRows
    .map((row) => row.name.trim())
    .filter((name) => name && outOfScope.some((item) => name.toLowerCase().includes(item) || item.includes(name.toLowerCase())));

  return (
    // scroll-mb keeps a focused control clear of the sticky save bar when tabbing.
    <form
      onSubmit={submitWithoutReset(formAction)}
      className="flex flex-col gap-6 [&_:is(input,textarea,select,button,summary)]:scroll-mb-36"
    >
      <input type="hidden" name="study_code" value={studyCode} />
      <input type="hidden" name="version_id" value={versionId} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="structure" value={structure} />

      <section className={cardClass}>
        <h2 className={sectionTitle}>
          Identificación
        </h2>
        <div className="flex flex-wrap gap-3">
          <label className={labelClass}>
            Etiqueta de la versión
            <input
              name="version_label"
              required
              value={fields.versionLabel}
              onChange={(event) => setField("versionLabel")(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={LIMITS.versionLabel}
              pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"
              title="Letras, números, punto, guion o guion bajo, sin espacios"
              className={`${inputClass} font-mono`}
            />
          </label>
          <label className={`${labelClass} min-w-64 flex-1`}>
            Nota de cambios (qué cambia respecto de la versión anterior)
            <textarea
              autoComplete="off"
              name="change_note"
              rows={2}
              value={fields.changeNote}
              onChange={(event) => setField("changeNote")(event.target.value)}
              maxLength={LIMITS.changeNote}
              className={inputClass}
            />
          </label>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitle}>
          Instrucciones de observación
        </h2>
        <label className={labelClass}>
          <span>
            Texto libre para el modelo de extracción: qué buscar en los clips seleccionados y cómo completar las variables.
            Obligatorio para publicar.
          </span>
          <textarea
            autoComplete="off"
            name="observation_prompt"
            rows={8}
            value={fields.observationPrompt}
            onChange={(event) => setField("observationPrompt")(event.target.value)}
            maxLength={LIMITS.prompt}
            placeholder="Ej.: Identifica cada episodio en que el participante ingiere comida o bebida…"
            className={`${inputClass} font-normal`}
          />
        </label>
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitle}>
          Tipos de evento
        </h2>
        <p className={hintClass}>
          Lo que el modelo detecta. La clave es estable entre versiones (los análisis longitudinales agrupan por clave); el nombre es
          el que ven investigadores y anotadores.
        </p>
        {eventRows.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin tipos de evento. Agrega al menos uno para publicar.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {eventRows.map((row, i) => (
              <li key={row.uid} className="flex flex-wrap items-end gap-3">
                <label className={labelClass}>
                  Clave
                  <input
                    ref={focusIfNew(row.uid)}
                    required
                    value={row.key}
                    onChange={(event) => updateEvent(row.uid, { key: event.target.value })}
                    pattern={KEY_INPUT_PATTERN}
                    maxLength={LIMITS.key}
                    title={KEY_HINT}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="eating_episode"
                    className={`${inputClass} font-mono`}
                  />
                </label>
                <label className={`${labelClass} min-w-48 flex-1`}>
                  Nombre visible
                  <input
                    required
                    value={row.label}
                    onChange={(event) => updateEvent(row.uid, { label: event.target.value })}
                    maxLength={LIMITS.eventLabel}
                    autoComplete="off"
                    placeholder="Episodio de alimentación"
                    className={inputClass}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeEvent(row.uid)}
                  aria-label={`Quitar el tipo de evento ${row.key || i + 1}`}
                  className={secondaryButton}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <button type="button" onClick={addEvent} disabled={eventRows.length >= LIMITS.eventTypes} className={secondaryButton}>
            Agregar tipo de evento
          </button>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitle}>
          Variables
        </h2>
        <p className={hintClass}>
          Cada variable es un atributo estructurado de las observaciones de los tipos de evento marcados. Con ellas se genera el
          esquema JSON de atributos de cada tipo de evento.
        </p>
        {variableRows.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin variables: las observaciones no llevarán atributos.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {variableRows.map((row, i) => (
              <VariableFields
                key={row.uid}
                row={row}
                position={i + 1}
                eventRows={eventRows}
                nameRef={focusIfNew(row.uid)}
                onChange={(patch) => updateVariable(row.uid, patch)}
                onRemove={() => removeVariable(row.uid)}
              />
            ))}
          </ul>
        )}
        <div>
          <button type="button" onClick={addVariable} disabled={variableRows.length >= LIMITS.variables} className={secondaryButton}>
            Agregar variable
          </button>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitle}>
          Fuera de alcance
        </h2>
        <label className={labelClass}>
          Lo que este protocolo no mide, uno por línea. El modelo no debe reportarlo.
          <textarea
            autoComplete="off"
            name="out_of_scope"
            rows={3}
            value={fields.outOfScopeText}
            onChange={(event) => setField("outOfScopeText")(event.target.value)}
            spellCheck={false}
            className={`${inputClass} font-mono`}
          />
        </label>
        {overlapping.length > 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            Revisa: {overlapping.length === 1 ? "la variable" : "las variables"} <span className="font-mono" translate="no">{overlapping.join(", ")}</span>{" "}
            {overlapping.length === 1 ? "coincide" : "coinciden"} con algo declarado fuera de alcance.
          </p>
        )}
      </section>

      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-zinc-200 bg-background py-3 dark:border-zinc-800">
        <ActionFeedback
          state={state}
          success={state.status === "saved" ? `Borrador guardado a las ${formatTime(Date.parse(state.savedAt), DISPLAY_TIME_ZONE)}.` : undefined}
        />
        {confirmingPublish ? (
          <PublishConfirm pending={pending} onCancel={() => setConfirmingPublish(false)} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" name="intent" value="save" disabled={pending} className={primaryButton}>
              {pending ? "Guardando…" : "Guardar borrador"}
            </button>
            <button type="button" onClick={() => setConfirmingPublish(true)} disabled={pending} className={secondaryButton}>
              Publicar…
            </button>
            <p className={hintClass}>
              {dirty ? "Hay cambios sin guardar." : "Sin cambios pendientes."}
            </p>
          </div>
        )}
      </div>
    </form>
  );
}

function VariableFields({
  row,
  position,
  eventRows,
  nameRef,
  onChange,
  onRemove,
}: {
  row: VariableRow;
  position: number;
  eventRows: EventRow[];
  nameRef: (element: HTMLInputElement | null) => void;
  onChange: (patch: Partial<VariableRow>) => void;
  onRemove: () => void;
}) {
  const takesValues = TYPES_WITH_ALLOWED_VALUES.includes(row.type);
  const subject = row.name.trim() || `${position}`;
  return (
    <li className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          Nombre
          <input
            ref={nameRef}
            required
            value={row.name}
            onChange={(event) => onChange({ name: event.target.value })}
            pattern={KEY_INPUT_PATTERN}
            maxLength={LIMITS.key}
            title={KEY_HINT}
            autoComplete="off"
            spellCheck={false}
            placeholder="episode_kind"
            className={`${inputClass} font-mono`}
          />
        </label>
        <label className={labelClass}>
          Tipo
          <select autoComplete="off" value={row.type} onChange={(event) => onChange({ type: event.target.value as VariableType })} className={inputClass}>
            {VARIABLE_TYPES.map((type) => (
              <option key={type} value={type}>
                {VARIABLE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input
            type="checkbox"
            checked={row.required}
            onChange={(event) => onChange({ required: event.target.checked })}
            className={`accent-zinc-900 dark:accent-zinc-100 ${focusRing}`}
          />
          Obligatoria en cada observación
        </label>
        <button type="button" onClick={onRemove} aria-label={`Quitar la variable ${subject}`} className={`${secondaryButton} ml-auto`}>
          Quitar
        </button>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className={`${labelClass} min-w-64 flex-1`}>
          Descripción (opcional, para el modelo y los investigadores)
          <textarea
            autoComplete="off"
            rows={2}
            value={row.description}
            onChange={(event) => onChange({ description: event.target.value })}
            maxLength={LIMITS.description}
            className={inputClass}
          />
        </label>
        {takesValues && (
          <label className={`${labelClass} min-w-48`}>
            {row.type === "enum" ? "Valores permitidos, uno por línea (obligatorio para publicar)" : "Valores permitidos, uno por línea (vacío = texto libre)"}
            <textarea
              autoComplete="off"
              rows={3}
              value={row.valuesText}
              onChange={(event) => onChange({ valuesText: event.target.value })}
              spellCheck={false}
              className={`${inputClass} font-mono`}
            />
          </label>
        )}
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Aplica a</legend>
        {eventRows.length === 0 ? (
          <p className={hintClass}>Agrega primero un tipo de evento.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {eventRows.map((eventRow, i) => (
              <label key={eventRow.uid} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={row.appliesTo.includes(eventRow.uid)}
                  onChange={(event) =>
                    onChange({
                      appliesTo: event.target.checked ? [...row.appliesTo, eventRow.uid] : row.appliesTo.filter((uid) => uid !== eventRow.uid),
                    })
                  }
                  className={`accent-zinc-900 dark:accent-zinc-100 ${focusRing}`}
                />
                <span className="font-mono" translate="no">
                  {eventRow.key || `tipo ${i + 1}`}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </li>
  );
}

function PublishConfirm({ pending, onCancel }: { pending: boolean; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div role="group" aria-label="Confirmar publicación" className="flex flex-col gap-2 rounded-md bg-amber-50 px-3 py-3 dark:bg-amber-950/50">
      <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
        ¿Publicar esta versión?
      </p>
      <p className="text-sm text-amber-900 dark:text-amber-200">
        Se guardan los cambios del formulario, se valida la definición contra el contrato y se calcula su sha256. Una versión publicada
        no se puede editar ni eliminar: solo copiar como un nuevo borrador o retirar. Si la validación falla, no se guarda nada.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="submit" name="intent" value="publish" disabled={pending} className={primaryButton}>
          {pending ? "Publicando…" : "Guardar y publicar"}
        </button>
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={pending} className={secondaryButton}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
