import Anthropic from "@anthropic-ai/sdk";

// The pipeline only needs "frames + instructions in, JSON matching a schema out". Tests replace this
// interface with a fake, so no test ever calls the API.

export type FrameImage = { caption: string; jpegBase64: string };

export type JsonRequest = {
  model: string;
  system: string;
  frames: FrameImage[];
  instruction: string;
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
};

export type Usage = { inputTokens: number; outputTokens: number };

export type JsonResponse = { output: unknown; servedModel: string; usage: Usage };

export interface JsonModel {
  generate(request: JsonRequest): Promise<JsonResponse>;
}

// Models with a server-side refusal fallback; on a policy decline the API re-runs the request on another
// model in the same call. The model that actually answered is returned as `servedModel` and recorded.
const SERVER_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1"]);

export class AnthropicJsonModel implements JsonModel {
  constructor(private client = new Anthropic()) {}

  async generate(request: JsonRequest): Promise<JsonResponse> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = request.frames.flatMap((frame) => [
      { type: "text" as const, text: frame.caption },
      { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: frame.jpegBase64 } },
    ]);
    content.push({ type: "text", text: request.instruction });
    const fallback = SERVER_FALLBACK_MODELS.has(request.model);
    const response = await this.client.beta.messages.create({
      model: request.model,
      max_tokens: 16000,
      system: request.system,
      messages: [{ role: "user", content }],
      output_config: { effort: request.effort, format: { type: "json_schema", schema: request.schema } },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (response.stop_reason === "refusal") {
      throw new Error(`${response.model} declined the request (${response.stop_details?.category ?? "no category"})`);
    }
    if (response.stop_reason === "max_tokens") throw new Error(`${response.model} hit max_tokens; output is incomplete`);
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return {
      output: JSON.parse(text),
      servedModel: response.model,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }
}
