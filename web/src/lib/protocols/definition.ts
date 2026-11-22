import { createHash } from "node:crypto";
import definitionSchema from "../../../../data/schemas/protocol-definition.schema.json";
import { type JsonSchema, type SchemaError, validate } from "./json-schema";
import {
  type DraftInput,
  KEY_PATTERN,
  LIMITS,
  type ProtocolDefinition,
  type ProtocolVariable,
  TYPES_WITH_ALLOWED_VALUES,
  VARIABLE_TYPES,
  VERSION_LABEL_PATTERN,
} from "./model";

// The protocol definition contract (data/schemas/protocol-definition.schema.json) and how the
// editor's draft maps to it. Server-only: imported by the protocol actions and queries.

const SCHEMA = definitionSchema as JsonSchema;

/** The definition keys the editor owns; every other key of the base definition is kept as is. */
const EDITED_KEYS = ["event_types", "observation_prompt", "variables", "out_of_scope"];

export function buildDefinition(base: Record<string, unknown>, draft: DraftInput): ProtocolDefinition {
  const preserved = Object.fromEntries(Object.entries(base).filter(([key]) => !EDITED_KEYS.includes(key)));
  return {
    ...preserved,
    event_types: draft.eventTypes.map((eventType) => eventType.key),
    observation_prompt: draft.observationPrompt,
    variables: draft.variables,
    ...(draft.outOfScope.length > 0 ? { out_of_scope: draft.outOfScope } : {}),
  };
}

// --- Validation ---

/**
 * Checks that block saving a draft: malformed or contradictory data (bad keys, duplicates,
 * references to event types that don't exist). Completeness (prompt, at least one event type,
 * values for enums) is only required to publish; see validateForPublish.
 */
export function validateDraft(draft: DraftInput): string[] {
  const errors: string[] = [];
  const label = draft.versionLabel;
  if (!label) errors.push("La etiqueta de la versión es obligatoria.");
  else if (label.length > LIMITS.versionLabel || !VERSION_LABEL_PATTERN.test(label)) {
    errors.push(
      `La etiqueta «${label}» no es válida: usa letras, números, punto, guion o guion bajo (máximo ${LIMITS.versionLabel} caracteres), sin espacios.`,
    );
  }
  if (draft.changeNote.length > LIMITS.changeNote) errors.push(`La nota de cambios supera los ${LIMITS.changeNote} caracteres.`);
  if (draft.observationPrompt.length > LIMITS.prompt) errors.push(`Las instrucciones superan los ${LIMITS.prompt} caracteres.`);
  if (draft.outOfScope.length > LIMITS.outOfScope) errors.push(`La lista «fuera de alcance» admite como máximo ${LIMITS.outOfScope} elementos.`);
  if (draft.outOfScope.some((item) => item.length > LIMITS.outOfScopeItem)) {
    errors.push(`Un elemento de «fuera de alcance» supera los ${LIMITS.outOfScopeItem} caracteres.`);
  }

  if (draft.eventTypes.length > LIMITS.eventTypes) errors.push(`Se admiten como máximo ${LIMITS.eventTypes} tipos de evento.`);
  const eventKeys = new Set<string>();
  draft.eventTypes.forEach((eventType, i) => {
    const name = `Tipo de evento ${i + 1}`;
    if (!isKey(eventType.key)) errors.push(`${name}: la clave «${eventType.key}» debe estar en snake_case (a-z, 0-9, _; empieza con letra).`);
    else if (eventKeys.has(eventType.key)) errors.push(`${name}: la clave «${eventType.key}» está repetida.`);
    eventKeys.add(eventType.key);
    if (!eventType.label) errors.push(`${name}: el nombre visible es obligatorio.`);
    else if (eventType.label.length > LIMITS.eventLabel) errors.push(`${name}: el nombre supera los ${LIMITS.eventLabel} caracteres.`);
  });

  if (draft.variables.length > LIMITS.variables) errors.push(`Se admiten como máximo ${LIMITS.variables} variables.`);
  const names = new Set<string>();
  draft.variables.forEach((variable, i) => {
    const name = `Variable ${i + 1}${variable.name ? ` (${variable.name})` : ""}`;
    if (!isKey(variable.name)) errors.push(`${name}: el nombre debe estar en snake_case (a-z, 0-9, _; empieza con letra).`);
    else if (names.has(variable.name)) errors.push(`${name}: el nombre está repetido.`);
    names.add(variable.name);
    if (!VARIABLE_TYPES.includes(variable.type)) errors.push(`${name}: tipo desconocido.`);
    if ((variable.description?.length ?? 0) > LIMITS.description) errors.push(`${name}: la descripción supera los ${LIMITS.description} caracteres.`);
    const values = variable.allowed_values ?? [];
    if (values.length > 0 && !TYPES_WITH_ALLOWED_VALUES.includes(variable.type)) errors.push(`${name}: este tipo no admite valores permitidos.`);
    if (values.length > LIMITS.allowedValues) errors.push(`${name}: admite como máximo ${LIMITS.allowedValues} valores.`);
    if (new Set(values).size !== values.length) errors.push(`${name}: hay valores permitidos repetidos.`);
    if (values.some((value) => value.length > LIMITS.value)) errors.push(`${name}: un valor supera los ${LIMITS.value} caracteres.`);
    for (const key of variable.applies_to) {
      if (!eventKeys.has(key)) errors.push(`${name}: aplica a «${key}», que no es un tipo de evento de esta versión.`);
    }
  });
  return errors;
}

/** Everything validateDraft checks, plus the definition against the JSON Schema contract. */
export function validateForPublish(draft: DraftInput, definition: ProtocolDefinition): string[] {
  const errors = validateDraft(draft);
  if (errors.length > 0) return errors;
  return validate(SCHEMA, definition).map((error) => describeSchemaError(error, definition));
}

// Schema errors point at contract paths ("variables[1].allowed_values"); say them in the editor's words.
function describeSchemaError({ path, message }: SchemaError, definition: ProtocolDefinition) {
  const variable = /^variables\[(\d+)\](?:\.(\w+))?/.exec(path);
  if (variable) {
    const index = Number(variable[1]);
    const name = definition.variables[index]?.name;
    const subject = `Variable ${index + 1}${name ? ` (${name})` : ""}`;
    const field = variable[2];
    if (field === "allowed_values" && message === "es obligatorio") return `${subject}: faltan los valores permitidos.`;
    if (field === "applies_to" && message.startsWith("debe tener al menos")) return `${subject}: marca al menos un tipo de evento al que aplica.`;
    return `${subject}${field ? ` · ${FIELD_LABELS[field] ?? field}` : ""}: ${message}.`;
  }
  if (path === "observation_prompt" && message === "no puede estar vacío") return "Las instrucciones de observación son obligatorias para publicar.";
  if (path === "event_types" && message.startsWith("debe tener al menos")) return "Agrega al menos un tipo de evento para publicar.";
  const root = path.split(/[.[]/)[0];
  return `${FIELD_LABELS[root] ?? path}: ${message}.`;
}

const FIELD_LABELS: Record<string, string> = {
  event_types: "Tipos de evento",
  observation_prompt: "Instrucciones de observación",
  variables: "Variables",
  out_of_scope: "Fuera de alcance",
  sensors: "Sensores",
  camera: "Cámara",
  name: "nombre",
  type: "tipo",
  description: "descripción",
  allowed_values: "valores permitidos",
  required: "obligatoria",
  applies_to: "aplica a",
};

function isKey(value: string) {
  return value.length > 0 && value.length <= LIMITS.key && KEY_PATTERN.test(value);
}

// --- Generated attributes schema (event_types.attributes_schema) ---

function variableSchema(variable: ProtocolVariable): JsonSchema {
  const values = variable.allowed_values ?? [];
  const described = variable.description ? { description: variable.description } : {};
  switch (variable.type) {
    case "enum":
      return { type: "string", enum: values, ...described };
    case "boolean":
      return { type: "boolean", ...described };
    case "number":
      return { type: "number", ...described };
    case "text":
      return { type: "string", ...described };
    case "string_list":
      return { type: "array", items: values.length > 0 ? { type: "string", enum: values } : { type: "string" }, ...described };
  }
}

/** JSON Schema for observations.attributes of one event type, built from the variables that apply to it. */
export function attributesSchemaFor(eventKey: string, variables: ProtocolVariable[]): JsonSchema {
  const applicable = variables.filter((variable) => variable.applies_to.includes(eventKey));
  return {
    type: "object",
    additionalProperties: false,
    required: applicable.filter((variable) => variable.required).map((variable) => variable.name),
    properties: Object.fromEntries(applicable.map((variable) => [variable.name, variableSchema(variable)])),
  };
}

/**
 * Best-effort inverse of attributesSchemaFor, for copying a version whose definition has no
 * variables (e.g. the seeded eating-v1, whose variables only exist as event_types schemas).
 * All or nothing: returns null when any property can't be expressed as a variable, so a copy never
 * silently drops part of its parent.
 */
export function variablesFromAttributeSchemas(eventTypes: { key: string; attributesSchema: unknown }[]): ProtocolVariable[] | null {
  const byName = new Map<string, ProtocolVariable>();
  for (const { key, attributesSchema } of eventTypes) {
    if (!isRecord(attributesSchema) || !onlyKeys(attributesSchema, SCHEMA_KEYS)) return null;
    if (attributesSchema.type !== undefined && attributesSchema.type !== "object") return null;
    const properties = attributesSchema.properties ?? {};
    if (!isRecord(properties)) return null;
    const required = Array.isArray(attributesSchema.required) ? attributesSchema.required : [];
    // jsonb returns object keys sorted by length; the `required` array keeps the author's order.
    const rank = (name: string) => (required.includes(name) ? required.indexOf(name) : required.length);
    const entries = Object.entries(properties).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
    for (const [name, property] of entries) {
      const shape = variableShape(property);
      if (!shape || !isKey(name)) return null;
      const variable: ProtocolVariable = { name, ...shape, required: required.includes(name), applies_to: [key] };
      const existing = byName.get(name);
      if (!existing) {
        byName.set(name, variable);
        continue;
      }
      // One variable, one meaning: the same name must have the same shape in every event type.
      if (canonicalJson({ ...existing, applies_to: [] }) !== canonicalJson({ ...variable, applies_to: [] })) return null;
      existing.applies_to.push(key);
    }
  }
  return [...byName.values()];
}

// Keywords a variable can express. A schema using any other (minimum, format, nested objects...) is
// not convertible: dropping the keyword would silently loosen the copy.
const PROPERTY_KEYS = new Set(["type", "enum", "items", "description"]);
const ITEM_KEYS = new Set(["type", "enum"]);
const SCHEMA_KEYS = new Set(["type", "required", "properties", "additionalProperties"]);
const onlyKeys = (value: Record<string, unknown>, allowed: Set<string>) => Object.keys(value).every((key) => allowed.has(key));

function variableShape(property: unknown): Pick<ProtocolVariable, "type" | "allowed_values" | "description"> | null {
  if (!isRecord(property) || !onlyKeys(property, PROPERTY_KEYS)) return null;
  const description = typeof property.description === "string" ? { description: property.description } : {};
  const strings = (value: unknown) => (Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : null);
  if (property.enum !== undefined) {
    const values = strings(property.enum);
    return values && (property.type === undefined || property.type === "string") ? { type: "enum", allowed_values: values, ...description } : null;
  }
  switch (property.type) {
    case "boolean":
      return { type: "boolean", ...description };
    case "number":
      return { type: "number", ...description };
    case "string":
      return { type: "text", ...description };
    case "array": {
      if (!isRecord(property.items) || !onlyKeys(property.items, ITEM_KEYS) || property.items.type !== "string") return null;
      if (property.items.enum === undefined) return { type: "string_list", ...description };
      const values = strings(property.items.enum);
      return values ? { type: "string_list", allowed_values: values, ...description } : null;
    }
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- Canonical JSON and hash ---

/**
 * Canonical JSON: object keys sorted at every level by UTF-16 code units (the RFC 8785 / JCS order),
 * arrays in order, no whitespace, numbers as JSON.stringify writes them.
 * Postgres jsonb reorders keys, so hashing JSON.stringify of the stored value would not be stable.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
  return JSON.stringify(value);
}

/**
 * Identifies the state a draft page was loaded from (label, note, definition, event types), so save
 * and publish can refuse a form built from an older state. There is no updated_at column to compare.
 */
export function draftRevision(draft: { versionLabel: string; changeNote: string | null; definition: unknown; eventTypes: { key: string; label: string }[] }) {
  const eventTypes = draft.eventTypes.map(({ key, label }) => ({ key, label })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return createHash("sha256")
    .update(canonicalJson({ version_label: draft.versionLabel, change_note: draft.changeNote ?? "", definition: draft.definition, event_types: eventTypes }), "utf8")
    .digest("hex");
}

/** sha256 (hex) of the canonical JSON of a definition: definition_sha256 of a published version. */
export function definitionSha256(definition: unknown) {
  return createHash("sha256").update(canonicalJson(definition), "utf8").digest("hex");
}
