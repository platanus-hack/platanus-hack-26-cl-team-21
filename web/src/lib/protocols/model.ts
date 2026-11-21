// Types, limits and labels of the protocol editor shared by the server (actions, validation) and
// the client editor. No server-only imports here.

export const VARIABLE_TYPES = ["enum", "boolean", "number", "text", "string_list"] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];

/** Types whose values can be restricted to a list (required for enum, optional for string_list). */
export const TYPES_WITH_ALLOWED_VALUES: readonly VariableType[] = ["enum", "string_list"];

export type ProtocolVariable = {
  name: string;
  type: VariableType;
  description?: string;
  allowed_values?: string[];
  required: boolean;
  applies_to: string[];
};

export type ProtocolDefinition = {
  event_types: string[];
  observation_prompt: string;
  variables: ProtocolVariable[];
  out_of_scope?: string[];
  [key: string]: unknown; // sensors, camera and any key the portal doesn't edit are preserved
};

/** What the editor sends and edits; event type labels go to the event_types table. */
export type DraftEventType = { key: string; label: string };
export type DraftInput = {
  versionLabel: string;
  changeNote: string;
  observationPrompt: string;
  outOfScope: string[];
  eventTypes: DraftEventType[];
  variables: ProtocolVariable[];
};

export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
export const VERSION_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const LIMITS = {
  versionLabel: 63,
  changeNote: 2000,
  prompt: 20000,
  key: 63,
  eventLabel: 100,
  eventTypes: 20,
  variables: 50,
  description: 2000,
  allowedValues: 100,
  value: 100,
  outOfScope: 50,
  outOfScopeItem: 200,
} as const;


// Spanish UI labels for variable types (values stored in the definition stay in English).
export const VARIABLE_TYPE_LABELS: Record<VariableType, string> = {
  enum: "Categoría (una opción)",
  boolean: "Sí / no",
  number: "Número",
  text: "Texto libre",
  string_list: "Lista de textos",
};

/** Result of a protocol Server Action, rendered by the form that called it. */
export type ActionState = { status: "idle" } | { status: "error"; errors: string[] } | { status: "saved"; savedAt: string };
export const IDLE: ActionState = { status: "idle" };
