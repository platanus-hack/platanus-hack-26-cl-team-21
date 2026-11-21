// Minimal JSON Schema (2020-12) validator for the keywords our contracts use. It exists so the
// portal validates protocol definitions against data/schemas/protocol-definition.schema.json
// itself, without adding a dependency for one schema. It throws on any keyword it doesn't
// implement, so the schema file can't silently grow past what is checked here: if that happens,
// extend this file or switch to a full validator (e.g. Ajv).

export type JsonSchema = { [keyword: string]: unknown };

export type SchemaError = { path: string; message: string };

const ANNOTATIONS = new Set(["$schema", "$id", "$defs", "$comment", "title", "description", "examples", "default"]);
const IMPLEMENTED = new Set([
  "$ref",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minimum",
  "maximum",
  "allOf",
  "if",
  "then",
  "else",
  "not",
]);

const TYPE_LABELS: Record<string, string> = {
  object: "un objeto",
  array: "una lista",
  string: "un texto",
  number: "un número",
  integer: "un número entero",
  boolean: "verdadero o falso",
  null: "nulo",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasType(value: unknown, type: string) {
  switch (type) {
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      throw new Error(`json-schema: unsupported type "${type}"`);
  }
}

// Structural equality for JSON values (enum, const, uniqueItems).
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && jsonEqual(a[k], b[k]));
  }
  return false;
}

function resolveRef(root: JsonSchema, ref: string): JsonSchema {
  if (!ref.startsWith("#/")) throw new Error(`json-schema: only local $ref is supported, got "${ref}"`);
  let node: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    node = isObject(node) ? node[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined;
  }
  if (!isObject(node)) throw new Error(`json-schema: unresolved $ref "${ref}"`);
  return node;
}

const join = (path: string, key: string | number) => (typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key);

function check(root: JsonSchema, schema: JsonSchema, value: unknown, path: string, errors: SchemaError[]) {
  for (const keyword of Object.keys(schema)) {
    if (!ANNOTATIONS.has(keyword) && !IMPLEMENTED.has(keyword)) throw new Error(`json-schema: unsupported keyword "${keyword}"`);
  }
  const at = path || "(raíz)";
  const fail = (message: string) => errors.push({ path: at, message });

  if (typeof schema.$ref === "string") check(root, resolveRef(root, schema.$ref), value, path, errors);

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((type) => hasType(value, type))) {
      fail(`debe ser ${types.map((type) => TYPE_LABELS[type] ?? type).join(" o ")}`);
      return; // the remaining keywords assume the right type
    }
  }
  if (schema.enum !== undefined && !(schema.enum as unknown[]).some((option) => jsonEqual(option, value))) {
    fail(`debe ser uno de: ${(schema.enum as unknown[]).map((option) => JSON.stringify(option)).join(", ")}`);
  }
  if (schema.const !== undefined && !jsonEqual(schema.const, value)) fail(`debe ser ${JSON.stringify(schema.const)}`);

  if (typeof value === "string") {
    const length = [...value].length;
    if (typeof schema.minLength === "number" && length < schema.minLength) {
      fail(schema.minLength === 1 ? "no puede estar vacío" : `debe tener al menos ${schema.minLength} caracteres`);
    }
    if (typeof schema.maxLength === "number" && length > schema.maxLength) fail(`debe tener como máximo ${schema.maxLength} caracteres`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      fail(`no cumple el formato ${schema.pattern}`);
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) fail(`debe ser mayor o igual a ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) fail(`debe ser menor o igual a ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) fail(`debe tener al menos ${schema.minItems} elemento(s)`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) fail(`debe tener como máximo ${schema.maxItems} elementos`);
    if (schema.uniqueItems === true && value.some((item, i) => value.findIndex((other) => jsonEqual(other, item)) !== i)) {
      fail("tiene elementos repetidos");
    }
    if (isObject(schema.items)) value.forEach((item, i) => check(root, schema.items as JsonSchema, item, join(path, i), errors));
  }

  if (isObject(value)) {
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in value)) errors.push({ path: join(path, key), message: "es obligatorio" });
    }
    const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
    for (const [key, child] of Object.entries(value)) {
      if (key in properties) check(root, properties[key], child, join(path, key), errors);
      else if (schema.additionalProperties === false) errors.push({ path: join(path, key), message: "no es un campo permitido" });
      else if (isObject(schema.additionalProperties)) check(root, schema.additionalProperties, child, join(path, key), errors);
    }
  }

  for (const sub of (schema.allOf as JsonSchema[] | undefined) ?? []) check(root, sub, value, path, errors);
  if (isObject(schema.if)) {
    const matches = validate(root, value, schema.if).length === 0;
    const branch = matches ? schema.then : schema.else;
    if (isObject(branch)) check(root, branch, value, path, errors);
  }
  if (isObject(schema.not) && validate(root, value, schema.not).length === 0) {
    // The only `not` our schemas use is "must not have field X"; say so when that is the case.
    const forbidden = (schema.not as JsonSchema).required as string[] | undefined;
    fail(forbidden?.length === 1 ? `no debe incluir ${forbidden[0]}` : "no cumple una restricción del esquema");
  }
}

/** Validates `value` against `schema` (or a sub-schema of `root`). Returns [] when valid. */
export function validate(root: JsonSchema, value: unknown, schema: JsonSchema = root): SchemaError[] {
  const errors: SchemaError[] = [];
  check(root, schema, value, "", errors);
  return errors;
}
