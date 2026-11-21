import { createHash } from "node:crypto";

// Everything the model is told comes from the protocol version and its event types in the DB, so a new
// protocol (or a new event type) changes the prompts and output schemas without touching this code.

export type EventTypeDef = { id: string; key: string; label: string; attributesSchema: Record<string, unknown> };

export type ProtocolContext = {
  protocolVersionId: string;
  versionLabel: string;
  definition: Record<string, unknown>;
  eventTypes: EventTypeDef[];
};

export const NO_EVENT = "none";
export const VISIBILITY = ["clear", "partial", "poor"] as const;

// Keywords structured outputs rejects. They are dropped from the schema sent to the model and still
// enforced afterwards, when the output is validated against the original schema.
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema", "$id", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "default",
]);

/** A copy of `schema` that structured outputs accepts: every object closed, unsupported keywords removed. */
export function toStrictSchema(schema: unknown): Record<string, unknown> {
  if (Array.isArray(schema)) return schema.map(toStrictSchema) as unknown as Record<string, unknown>;
  if (!schema || typeof schema !== "object") return schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, toStrictSchema(sub)]));
    } else if (key === "enum" || key === "const" || key === "required") {
      out[key] = value;
    } else {
      out[key] = toStrictSchema(value);
    }
  }
  const isObject = out.type === "object" || "properties" in out || Object.keys(out).length === 0;
  if (isObject) {
    out.type = "object";
    out.properties ??= {};
    out.additionalProperties = false;
  }
  return out;
}

function describe(eventType: EventTypeDef) {
  const description = typeof eventType.attributesSchema.description === "string" ? ` ${eventType.attributesSchema.description}` : "";
  return `- \`${eventType.key}\`: ${eventType.label}.${description}`;
}

function outOfScope(ctx: ProtocolContext) {
  const items = Array.isArray(ctx.definition.out_of_scope) ? ctx.definition.out_of_scope.map(String) : [];
  return items.length ? `\nOut of scope for this protocol (never estimate or mention): ${items.join(", ")}.` : "";
}

const SHARED_RULES = `You annotate still frames from a chest-worn camera for a scientific study. The frames are authentic footage in time order; each is preceded by a line with its index, its offset in the video and its device time.
Rules:
- Judge only what is visible in the frames. Do not infer emotions, stress, intentions or anything not shown.
- If the view is blocked, dark or blurry, say so through the fields provided instead of guessing.`;

export function detectionSystemPrompt(ctx: ProtocolContext) {
  return `${SHARED_RULES}

This is the first, high-recall screening pass of protocol "${ctx.versionLabel}". A second, careful pass re-examines every frame you flag, so when an event might be happening, flag it.
Event types:
${ctx.eventTypes.map(describe).join("\n")}${outOfScope(ctx)}

For every frame, give the event type that is plausibly happening at that moment, or "${NO_EVENT}". Label every frame index exactly once.`;
}

export function detectionSchema(ctx: ProtocolContext) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["frames"],
    properties: {
      frames: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "event_type"],
          properties: {
            index: { type: "integer" },
            event_type: { enum: [...ctx.eventTypes.map((type) => type.key), NO_EVENT] },
          },
        },
      },
    },
  };
}

export function extractionSystemPrompt(ctx: ProtocolContext) {
  return `${SHARED_RULES}

This is the detailed extraction pass of protocol "${ctx.versionLabel}". The frames cover one candidate window, with some context before and after.
Event types:
${ctx.eventTypes.map(describe).join("\n")}${outOfScope(ctx)}

Report every episode of these event types that is visibly happening in the frames, or an empty list if none is.
- start_frame / end_frame: indices of the first and last frame where the episode is visibly happening.
- attributes: only what the frames show, following the schema of the event type.
- confidence: your own certainty from 0 to 1 that the episode happened as reported (it is stored as a model score, not a probability).
- visibility: how well the frames show the episode.`;
}

export function extractionSchema(ctx: ProtocolContext) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["episodes"],
    properties: {
      episodes: {
        type: "array",
        items: {
          anyOf: ctx.eventTypes.map((type) => ({
            type: "object",
            additionalProperties: false,
            required: ["event_type", "start_frame", "end_frame", "confidence", "visibility", "attributes"],
            properties: {
              event_type: { const: type.key },
              start_frame: { type: "integer" },
              end_frame: { type: "integer" },
              confidence: { type: "number" },
              visibility: { enum: [...VISIBILITY] },
              attributes: toStrictSchema(type.attributesSchema),
            },
          })),
        },
      },
    },
  };
}

/** Hash of everything sent to the model that is not frame data: the prompts and both output schemas. */
export function promptSha256(ctx: ProtocolContext) {
  const material = JSON.stringify({
    detection: [detectionSystemPrompt(ctx), detectionSchema(ctx)],
    extraction: [extractionSystemPrompt(ctx), extractionSchema(ctx)],
  });
  return createHash("sha256").update(material).digest("hex");
}

export type PipelineConfig = {
  detectionModel: string;
  extractionModel: string;
  detectionIntervalS: number;
  detectionBatchSize: number;
  detectionImageWidth: number;
  mergeGapS: number;
  windowPaddingS: number;
  extractionIntervalS: number;
  extractionMaxFrames: number;
  extractionImageWidth: number;
  evidencePaddingS: number;
};

export const DEFAULT_CONFIG: PipelineConfig = {
  detectionModel: "claude-haiku-5-5",
  extractionModel: "claude-opus-5-5",
  detectionIntervalS: 5,
  detectionBatchSize: 20,
  detectionImageWidth: 512,
  mergeGapS: 30,
  windowPaddingS: 10,
  extractionIntervalS: 1,
  extractionMaxFrames: 24,
  extractionImageWidth: 640,
  evidencePaddingS: 2,
};

const CONFIG_KEYS: Record<string, keyof PipelineConfig> = {
  detection_interval_s: "detectionIntervalS",
  detection_batch_size: "detectionBatchSize",
  detection_image_width: "detectionImageWidth",
  merge_gap_s: "mergeGapS",
  window_padding_s: "windowPaddingS",
  extraction_interval_s: "extractionIntervalS",
  extraction_max_frames: "extractionMaxFrames",
  extraction_image_width: "extractionImageWidth",
  evidence_padding_s: "evidencePaddingS",
};

/**
 * Defaults, then the protocol's optional `definition.pipeline` (snake_case numbers), then model env
 * overrides. The resolved config is stored on the run, so every result says how it was produced.
 */
export function resolveConfig(ctx: ProtocolContext, env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  const config = { ...DEFAULT_CONFIG };
  const overrides = ctx.definition.pipeline;
  if (overrides && typeof overrides === "object") {
    for (const [key, value] of Object.entries(overrides)) {
      const field = CONFIG_KEYS[key];
      if (field && typeof value === "number" && value > 0) (config[field] as number) = value;
    }
  }
  if (env.DETECTION_MODEL) config.detectionModel = env.DETECTION_MODEL;
  if (env.EXTRACTION_MODEL) config.extractionModel = env.EXTRACTION_MODEL;
  return config;
}
