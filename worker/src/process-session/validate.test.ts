import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectionSchema, detectionSystemPrompt, extractionSchema, extractionSystemPrompt, promptSha256, resolveConfig, toStrictSchema } from "./protocol";
import { CTX } from "./test-helpers";
import { readDetection, readExtraction } from "./validate";

const episode = (overrides: Record<string, unknown> = {}) => ({
  event_type: "eating_episode",
  start_frame: 1,
  end_frame: 3,
  confidence: 0.7,
  visibility: "partial",
  attributes: { episode_kind: "meal", visible_items: ["rice"], context: "seated_table" },
  ...overrides,
});

describe("prompts and schemas come from the protocol", () => {
  it("lists the protocol's event types and out-of-scope items", () => {
    for (const prompt of [detectionSystemPrompt(CTX), extractionSystemPrompt(CTX)]) {
      assert.match(prompt, /eating-v1/);
      assert.match(prompt, /`eating_episode`: Eating episode/);
      assert.match(prompt, /`drinking_episode`: Drinking episode/);
      assert.match(prompt, /calories, portion_weight, nutrients/);
    }
    assert.deepEqual(detectionSchema(CTX).properties.frames.items.properties.event_type.enum, ["drinking_episode", "eating_episode", "none"]);
    const variants = extractionSchema(CTX).properties.episodes.items.anyOf;
    assert.deepEqual(
      variants.map((variant) => variant.properties.event_type),
      [{ const: "drinking_episode" }, { const: "eating_episode" }],
    );
  });

  it("changes the prompt hash when the protocol changes", () => {
    assert.equal(promptSha256(CTX), promptSha256({ ...CTX }));
    assert.notEqual(promptSha256(CTX), promptSha256({ ...CTX, eventTypes: CTX.eventTypes.slice(0, 1) }));
  });

  it("makes attribute schemas acceptable to structured outputs", () => {
    const strict = toStrictSchema({
      type: "object",
      required: ["n"],
      properties: {
        n: { type: "integer", minimum: 0 },
        tags: { type: "array", items: { type: "string", maxLength: 9 }, minItems: 1 },
        nested: { properties: {} },
      },
    });
    assert.deepEqual(strict, {
      type: "object",
      required: ["n"],
      additionalProperties: false,
      properties: {
        n: { type: "integer" },
        tags: { type: "array", items: { type: "string" } },
        nested: { type: "object", properties: {}, additionalProperties: false },
      },
    });
    assert.deepEqual(toStrictSchema({}), { type: "object", properties: {}, additionalProperties: false });
  });

  it("reads pipeline overrides from the protocol definition and models from the env", () => {
    const definition = { pipeline: { detection_interval_s: 10, unknown: 3, merge_gap_s: -1 } };
    const config = resolveConfig({ ...CTX, definition }, { EXTRACTION_MODEL: "claude-sonnet-5-5" });
    assert.equal(config.detectionIntervalS, 10);
    assert.equal(config.mergeGapS, 30);
    assert.equal(config.detectionModel, "claude-haiku-5-5");
    assert.equal(config.extractionModel, "claude-sonnet-5-5");
  });
});

describe("readDetection", () => {
  it("flags frames with an event type and treats unlabeled frames as candidates", () => {
    const output = {
      frames: [
        { index: 0, event_type: "none" },
        { index: 1, event_type: "eating_episode" },
        { index: 1, event_type: "none" },
        { index: 7, event_type: "eating_episode" },
        { index: 3, event_type: "made_up" },
      ],
    };
    const read = readDetection(output, CTX, 4);
    assert.deepEqual(read.candidates, [false, true, true, true]);
    assert.equal(read.unlabeled, 2);
  });
});

describe("readExtraction", () => {
  it("accepts valid episodes", () => {
    const read = readExtraction({ episodes: [episode()] }, CTX, 5);
    assert.deepEqual(read.rejected, []);
    assert.deepEqual(read.episodes, [
      {
        eventTypeKey: "eating_episode",
        startFrame: 1,
        endFrame: 3,
        confidence: 0.7,
        visibility: "partial",
        attributes: { episode_kind: "meal", visible_items: ["rice"], context: "seated_table" },
      },
    ]);
  });

  const invalid: [string, Record<string, unknown>, RegExp][] = [
    ["an unknown event type", { event_type: "sleeping" }, /unknown event_type/],
    ["a frame out of range", { end_frame: 5 }, /outside/],
    ["a reversed range", { start_frame: 3, end_frame: 1 }, /reversed/],
    ["a fractional frame", { start_frame: 1.5 }, /not integers/],
    ["a confidence above 1", { confidence: 1.2 }, /confidence/],
    ["a bad visibility", { visibility: "great" }, /visibility/],
    ["an attribute outside its enum", { attributes: { episode_kind: "feast", visible_items: [], context: "desk" } }, /attributes/],
    ["a missing attribute", { attributes: { episode_kind: "meal", visible_items: [] } }, /attributes/],
  ];
  for (const [name, overrides, reason] of invalid) {
    it(`rejects ${name} and keeps the valid episodes`, () => {
      const read = readExtraction({ episodes: [episode(overrides), episode()] }, CTX, 5);
      assert.equal(read.episodes.length, 1);
      assert.equal(read.rejected.length, 1);
      assert.match(read.rejected[0].reason, reason);
    });
  }

  it("rejects output without an episodes array", () => {
    assert.equal(readExtraction({ nope: 1 }, CTX, 5).rejected.length, 1);
  });
});
