import assert from "node:assert/strict";
import { test } from "node:test";
import { attributeValue, formatAttributes } from "./labels";

test("attributeValue maps known enum values and joins arrays", () => {
  assert.equal(attributeValue("context", "seated_table"), "sentado a la mesa");
  assert.equal(attributeValue("visible_items", ["sandwich", "water"]), "sandwich, water");
  assert.equal(attributeValue("visible_items", []), "—");
});

test("attributeValue reads nested objects as key: value pairs, not JSON", () => {
  assert.equal(attributeValue("utensils", { fork: true, count: 2 }), "fork: true; count: 2");
  assert.equal(attributeValue("extra", { context: "desk" }), "Contexto: escritorio");
  assert.equal(attributeValue("extra", {}), "—");
  assert.equal(attributeValue("extra", null), "—");
});

test("formatAttributes puts known attributes first in protocol order", () => {
  const keys = formatAttributes({ zeta: 1, context: "desk", episode_kind: "meal" }).map((a) => a.key);
  assert.deepEqual(keys, ["episode_kind", "context", "zeta"]);
});
