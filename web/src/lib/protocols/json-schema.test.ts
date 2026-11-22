import assert from "node:assert/strict";
import { describe, test } from "node:test";
import definitionSchema from "../../../../data/schemas/protocol-definition.schema.json";
import { type JsonSchema, validate } from "./json-schema";

const SCHEMA = definitionSchema as JsonSchema;

describe("validate", () => {
  test("follows local $ref and reports paths", () => {
    const schema = { $defs: { key: { type: "string", pattern: "^[a-z]+$" } }, type: "array", items: { $ref: "#/$defs/key" } };
    assert.deepEqual(validate(schema, ["ok", "No"]), [{ path: "[1]", message: "no cumple el formato ^[a-z]+$" }]);
  });

  test("checks required, additionalProperties, uniqueItems and lengths", () => {
    const schema = {
      type: "object",
      required: ["a"],
      additionalProperties: false,
      properties: { a: { type: "array", uniqueItems: true, minItems: 1 }, b: { type: "string", minLength: 1 } },
    };
    assert.deepEqual(validate(schema, { a: [{ x: 1 }, { x: 1 }], b: "", c: 1 }), [
      { path: "a", message: "tiene elementos repetidos" },
      { path: "b", message: "no puede estar vacío" },
      { path: "c", message: "no es un campo permitido" },
    ]);
    assert.deepEqual(validate(schema, {}), [{ path: "a", message: "es obligatorio" }]);
  });

  test("applies if/then and not", () => {
    const schema = {
      allOf: [
        { if: { properties: { type: { const: "enum" } } }, then: { required: ["values"] } },
        { if: { properties: { type: { const: "text" } } }, then: { not: { required: ["values"] } } },
      ],
    };
    assert.deepEqual(validate(schema, { type: "enum" }), [{ path: "values", message: "es obligatorio" }]);
    assert.deepEqual(validate(schema, { type: "text", values: [] }), [{ path: "(raíz)", message: "no debe incluir values" }]);
    assert.deepEqual(validate(schema, { type: "text" }), []);
  });

  test("fails loudly on keywords it doesn't implement", () => {
    assert.throws(() => validate({ oneOf: [] }, 1), /unsupported keyword "oneOf"/);
    assert.throws(() => validate({ $ref: "other.json#/x" }, 1), /only local \$ref/);
  });
});

describe("protocol-definition.schema.json", () => {
  const valid = {
    event_types: ["eating_episode"],
    observation_prompt: "Identify each eating episode.",
    variables: [{ name: "episode_kind", type: "enum", allowed_values: ["meal"], required: true, applies_to: ["eating_episode"] }],
    out_of_scope: ["calories"],
    sensors: { temperature_c: { period_s: 60 } },
    camera: { fps: 2 },
    pipeline: { merge_gap_s: 30 },
  };

  test("only uses keywords this validator implements, and accepts a complete definition", () => {
    assert.deepEqual(validate(SCHEMA, valid), []);
  });

  test("rejects the seeded eating-v1 definition, which predates the contract", () => {
    const seeded = { sensors: {}, camera: {}, event_types: ["eating_episode"], out_of_scope: ["calories"] };
    assert.deepEqual(validate(SCHEMA, seeded), [
      { path: "observation_prompt", message: "es obligatorio" },
      { path: "variables", message: "es obligatorio" },
    ]);
  });

  test("enforces the per-type rules of allowed_values", () => {
    const variable = (extra: object) => ({ ...valid, variables: [{ ...valid.variables[0], ...extra }] });
    const noValues = { name: "episode_kind", type: "enum", required: true, applies_to: ["eating_episode"] };
    assert.deepEqual(validate(SCHEMA, { ...valid, variables: [noValues] }), [{ path: "variables[0].allowed_values", message: "es obligatorio" }]);
    assert.deepEqual(validate(SCHEMA, variable({ type: "boolean" })), [{ path: "variables[0]", message: "no debe incluir allowed_values" }]);
  });
});
