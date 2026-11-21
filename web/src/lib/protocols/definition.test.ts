import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import {
  attributesSchemaFor,
  buildDefinition,
  canonicalJson,
  definitionSha256,
  draftRevision,
  validateDraft,
  validateForPublish,
  variablesFromAttributeSchemas,
} from "./definition";
import type { DraftInput, ProtocolVariable } from "./model";

// eating-v1 as seeded (db/src/seed.ts): no prompt or variables in the definition, attributes only in
// the event_types schemas, whose `properties` come back from jsonb sorted by key length.
const SEED_DEFINITION = {
  sensors: { temperature_c: { period_s: 60 } },
  camera: { fps: 2, resolution: "VGA" },
  event_types: ["eating_episode", "drinking_episode"],
  out_of_scope: ["calories", "portion_weight", "nutrients"],
};
const SEED_SCHEMA = {
  type: "object",
  required: ["episode_kind", "visible_items", "context"],
  properties: {
    context: { enum: ["seated_table", "desk", "standing", "walking", "kitchen"] },
    episode_kind: { enum: ["meal", "snack", "drink"] },
    visible_items: { type: "array", items: { type: "string" } },
  },
};

const kind: ProtocolVariable = { name: "episode_kind", type: "enum", allowed_values: ["meal", "snack"], required: true, applies_to: ["eating_episode"] };
const utensils: ProtocolVariable = { name: "utensils_visible", type: "boolean", required: false, applies_to: ["eating_episode"] };

function draft(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    versionLabel: "eating-v2",
    changeNote: "",
    observationPrompt: "Identify each eating episode.",
    outOfScope: ["calories"],
    eventTypes: [
      { key: "eating_episode", label: "Eating episode" },
      { key: "drinking_episode", label: "Drinking episode" },
    ],
    variables: [kind, utensils],
    ...overrides,
  };
}

describe("canonicalJson / definitionSha256", () => {
  test("sorts keys at every level and keeps array order", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } }), '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });

  test("the hash doesn't depend on key order (jsonb reorders keys)", () => {
    const a = { variables: [], event_types: ["e"], observation_prompt: "p" };
    const b = { observation_prompt: "p", event_types: ["e"], variables: [] };
    assert.equal(definitionSha256(a), definitionSha256(b));
    assert.equal(definitionSha256(a), createHash("sha256").update('{"event_types":["e"],"observation_prompt":"p","variables":[]}').digest("hex"));
  });

  test("rejects values JSON can't represent", () => {
    assert.throws(() => canonicalJson({ x: Number.NaN }));
  });
});

describe("buildDefinition", () => {
  test("keeps the keys the editor doesn't own and replaces the ones it does", () => {
    const definition = buildDefinition({ ...SEED_DEFINITION, pipeline: { merge_gap_s: 20 } }, draft({ outOfScope: [] }));
    assert.deepEqual(definition.sensors, SEED_DEFINITION.sensors);
    assert.deepEqual(definition.camera, SEED_DEFINITION.camera);
    assert.deepEqual(definition.pipeline, { merge_gap_s: 20 });
    assert.deepEqual(definition.event_types, ["eating_episode", "drinking_episode"]);
    assert.equal("out_of_scope" in definition, false, "an empty out-of-scope list is omitted");
  });
});

describe("attributesSchemaFor", () => {
  test("includes only the variables that apply to the event type", () => {
    assert.deepEqual(attributesSchemaFor("eating_episode", [kind, utensils]), {
      type: "object",
      additionalProperties: false,
      required: ["episode_kind"],
      properties: { episode_kind: { type: "string", enum: ["meal", "snack"] }, utensils_visible: { type: "boolean" } },
    });
    assert.deepEqual(attributesSchemaFor("drinking_episode", [kind, utensils]).properties, {});
  });

  test("a list of strings is free text unless it has allowed values", () => {
    const list: ProtocolVariable = { name: "items", type: "string_list", required: true, applies_to: ["e"], description: "What is visible." };
    assert.deepEqual(attributesSchemaFor("e", [list]).properties, { items: { type: "array", items: { type: "string" }, description: "What is visible." } });
    const closed = { ...list, allowed_values: ["water"] };
    assert.deepEqual(attributesSchemaFor("e", [closed]).properties, {
      items: { type: "array", items: { type: "string", enum: ["water"] }, description: "What is visible." },
    });
  });
});

describe("variablesFromAttributeSchemas", () => {
  test("turns the seeded eating-v1 schemas into variables, in the author's order", () => {
    const variables = variablesFromAttributeSchemas([
      { key: "eating_episode", attributesSchema: SEED_SCHEMA },
      { key: "drinking_episode", attributesSchema: SEED_SCHEMA },
    ]);
    assert.deepEqual(variables, [
      { name: "episode_kind", type: "enum", allowed_values: ["meal", "snack", "drink"], required: true, applies_to: ["eating_episode", "drinking_episode"] },
      { name: "visible_items", type: "string_list", required: true, applies_to: ["eating_episode", "drinking_episode"] },
      {
        name: "context",
        type: "enum",
        allowed_values: ["seated_table", "desk", "standing", "walking", "kitchen"],
        required: true,
        applies_to: ["eating_episode", "drinking_episode"],
      },
    ]);
  });

  test("round-trips the schemas the editor generates", () => {
    const variables = [kind, utensils];
    const schemas = ["eating_episode"].map((key) => ({ key, attributesSchema: attributesSchemaFor(key, variables) }));
    assert.deepEqual(variablesFromAttributeSchemas(schemas), variables);
  });

  test("gives up (null) instead of dropping what it can't express", () => {
    const nested = { type: "object", properties: { where: { type: "object" } } };
    assert.equal(variablesFromAttributeSchemas([{ key: "e", attributesSchema: nested }]), null);
    // Same name, different meaning in two event types: one variable can't hold both.
    const a = { type: "object", properties: { size: { enum: ["s", "m"] } } };
    const b = { type: "object", properties: { size: { type: "number" } } };
    assert.equal(variablesFromAttributeSchemas([{ key: "e1", attributesSchema: a }, { key: "e2", attributesSchema: b }]), null);
  });

  test("gives up on keywords a variable can't carry, instead of loosening the copy", () => {
    const bounded = { type: "object", properties: { count: { type: "number", minimum: 0 } } };
    assert.equal(variablesFromAttributeSchemas([{ key: "e", attributesSchema: bounded }]), null);
    const integer = { type: "object", properties: { count: { type: "integer" } } };
    assert.equal(variablesFromAttributeSchemas([{ key: "e", attributesSchema: integer }]), null);
    const listBound = { type: "object", properties: { items: { type: "array", items: { type: "string", maxLength: 5 } } } };
    assert.equal(variablesFromAttributeSchemas([{ key: "e", attributesSchema: listBound }]), null);
    const topLevel = { type: "object", minProperties: 1, properties: {} };
    assert.equal(variablesFromAttributeSchemas([{ key: "e", attributesSchema: topLevel }]), null);
  });
});

describe("draftRevision", () => {
  const state = {
    versionLabel: "eating-v2",
    changeNote: null,
    definition: { event_types: ["a", "b"], variables: [] },
    eventTypes: [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ],
  };

  test("doesn't depend on key or row order (jsonb and the DB return them in any order)", () => {
    const reordered = { ...state, changeNote: "", definition: { variables: [], event_types: ["a", "b"] }, eventTypes: [...state.eventTypes].reverse() };
    assert.equal(draftRevision(reordered), draftRevision(state));
  });

  test("changes with anything a save writes", () => {
    const base = draftRevision(state);
    assert.notEqual(draftRevision({ ...state, versionLabel: "eating-v3" }), base);
    assert.notEqual(draftRevision({ ...state, changeNote: "note" }), base);
    assert.notEqual(draftRevision({ ...state, definition: { ...state.definition, observation_prompt: "p" } }), base);
    assert.notEqual(draftRevision({ ...state, eventTypes: [{ key: "a", label: "Other" }, state.eventTypes[1]] }), base);
  });
});

describe("validateDraft", () => {
  test("limits the length of each out-of-scope item", () => {
    assert.deepEqual(validateDraft(draft({ outOfScope: ["x".repeat(201)] })), ["Un elemento de «fuera de alcance» supera los 200 caracteres."]);
  });

  test("accepts a coherent draft, even an incomplete one", () => {
    assert.deepEqual(validateDraft(draft({ observationPrompt: "", eventTypes: [], variables: [] })), []);
  });

  test("rejects malformed labels, keys, duplicates and dangling references", () => {
    const errors = validateDraft(
      draft({
        versionLabel: "eating v2",
        eventTypes: [
          { key: "eating_episode", label: "Eating episode" },
          { key: "drinking_episode", label: "" },
          { key: "Sleep", label: "Sleep" },
        ],
        variables: [
          { ...utensils, allowed_values: ["yes"] },
          { ...kind, applies_to: ["sleep_episode"] },
          { ...kind, name: "episode_kind", allowed_values: ["meal", "meal"], applies_to: ["drinking_episode"] },
        ],
      }),
    );
    assert.deepEqual(errors, [
      "La etiqueta «eating v2» no es válida: usa letras, números, punto, guion o guion bajo (máximo 63 caracteres), sin espacios.",
      "Tipo de evento 2: el nombre visible es obligatorio.",
      "Tipo de evento 3: la clave «Sleep» debe estar en snake_case (a-z, 0-9, _; empieza con letra).",
      "Variable 1 (utensils_visible): este tipo no admite valores permitidos.",
      "Variable 2 (episode_kind): aplica a «sleep_episode», que no es un tipo de evento de esta versión.",
      "Variable 3 (episode_kind): el nombre está repetido.",
      "Variable 3 (episode_kind): hay valores permitidos repetidos.",
    ]);
  });
});

describe("validateForPublish", () => {
  const publish = (input: DraftInput) => validateForPublish(input, buildDefinition(SEED_DEFINITION, input));

  test("a complete draft passes the contract", () => {
    assert.deepEqual(publish(draft()), []);
  });

  test("says in the editor's words what is missing", () => {
    assert.deepEqual(publish(draft({ observationPrompt: "", eventTypes: [], variables: [] })), [
      "Agrega al menos un tipo de evento para publicar.",
      "Las instrucciones de observación son obligatorias para publicar.",
    ]);
    const noValues: ProtocolVariable = { name: kind.name, type: kind.type, required: kind.required, applies_to: kind.applies_to };
    assert.deepEqual(publish(draft({ variables: [noValues, { ...utensils, applies_to: [] }] })), [
      "Variable 1 (episode_kind): faltan los valores permitidos.",
      "Variable 2 (utensils_visible): marca al menos un tipo de evento al que aplica.",
    ]);
  });

  test("structural errors are reported before the schema is checked", () => {
    assert.deepEqual(publish(draft({ versionLabel: "" })), ["La etiqueta de la versión es obligatoria."]);
  });
});
