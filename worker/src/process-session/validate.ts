import { Ajv, type ValidateFunction } from "ajv";
import { NO_EVENT, type ProtocolContext, VISIBILITY } from "./protocol";

// Model output is never trusted as is: structured outputs guarantee the shape, but not the ranges, the
// frame indices or the constraints stripped from the schema. Anything invalid is dropped and counted.

export type Episode = {
  eventTypeKey: string;
  startFrame: number;
  endFrame: number;
  confidence: number;
  visibility: (typeof VISIBILITY)[number];
  attributes: Record<string, unknown>;
};

export type Rejected = { reason: string; item: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function attributeValidators(ctx: ProtocolContext) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  return new Map<string, ValidateFunction>(ctx.eventTypes.map((type) => [type.key, ajv.compile(type.attributesSchema)]));
}

/**
 * Per-frame labels from the detection pass. A frame the model left unlabeled counts as a candidate:
 * the pass favors recall, and not looking is not the same as seeing nothing.
 */
export function readDetection(output: unknown, ctx: ProtocolContext, frameCount: number) {
  const keys = new Set(ctx.eventTypes.map((type) => type.key));
  const labels: (string | null)[] = Array(frameCount).fill(undefined);
  const frames = isRecord(output) && Array.isArray(output.frames) ? output.frames : [];
  for (const frame of frames) {
    if (!isRecord(frame) || !Number.isInteger(frame.index) || (frame.index as number) < 0 || (frame.index as number) >= frameCount) continue;
    const label = frame.event_type;
    if (label === NO_EVENT) labels[frame.index as number] ??= null;
    else if (typeof label === "string" && keys.has(label)) labels[frame.index as number] = label;
  }
  const unlabeled = labels.filter((label) => label === undefined).length;
  return { candidates: labels.map((label) => label !== null), labels, unlabeled };
}

export function readExtraction(output: unknown, ctx: ProtocolContext, frameCount: number, validators = attributeValidators(ctx)) {
  const episodes: Episode[] = [];
  const rejected: Rejected[] = [];
  const items = isRecord(output) && Array.isArray(output.episodes) ? output.episodes : null;
  if (!items) return { episodes, rejected: [{ reason: "output has no episodes array", item: output }] };
  for (const item of items) {
    const reason = rejectReason(item, frameCount, validators);
    if (reason) rejected.push({ reason, item });
    else {
      const ok = item as Record<string, unknown>;
      episodes.push({
        eventTypeKey: ok.event_type as string,
        startFrame: ok.start_frame as number,
        endFrame: ok.end_frame as number,
        confidence: ok.confidence as number,
        visibility: ok.visibility as Episode["visibility"],
        attributes: ok.attributes as Record<string, unknown>,
      });
    }
  }
  return { episodes, rejected };
}

function rejectReason(item: unknown, frameCount: number, validators: Map<string, ValidateFunction>) {
  if (!isRecord(item)) return "not an object";
  const validate = typeof item.event_type === "string" ? validators.get(item.event_type) : undefined;
  if (!validate) return `unknown event_type ${JSON.stringify(item.event_type)}`;
  const { start_frame: start, end_frame: end, confidence } = item;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "frame indices are not integers";
  if ((start as number) < 0 || (end as number) >= frameCount || (start as number) > (end as number)) {
    return `frame range ${start}..${end} outside 0..${frameCount - 1} or reversed`;
  }
  if (typeof confidence !== "number" || !(confidence >= 0 && confidence <= 1)) return `confidence ${confidence} outside [0, 1]`;
  if (!VISIBILITY.includes(item.visibility as Episode["visibility"])) return `invalid visibility ${JSON.stringify(item.visibility)}`;
  if (!validate(item.attributes)) return `attributes do not match the event type schema: ${JSON.stringify(validate.errors)}`;
  return null;
}
