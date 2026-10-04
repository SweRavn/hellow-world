import Anthropic from "@anthropic-ai/sdk";
import {
  SPEC_VERSION,
  buildSystemPrompt,
  buildUserMessage,
  validateSpec,
  type GenerateRequest,
  type WidgetSpec,
} from "@graft/core";

export interface ClaudeGeneratorOptions {
  client?: Pick<Anthropic, "beta">;
  model?: string;
  /** Thinking depth / cost. "low" is snappier; "medium" (default) is a good balance for widget generation. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** How many times to send validation errors back to the model for repair. */
  maxRepairs?: number;
}

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

/** Pulls the JSON object out of the model's text reply (tolerates stray prose or fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SyntaxError("no JSON object in reply");
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Creates a function that turns a Graft generate request into a validated widget spec using Claude.
 * The model's output is validated with the same validator the SDKs use; on failure the errors are fed
 * back to the model (append-only conversation) for up to `maxRepairs` repair rounds.
 */
export function createClaudeGenerator(opts: ClaudeGeneratorOptions = {}) {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? "claude-opus-5-5";
  const maxRepairs = opts.maxRepairs ?? 2;
  const system = buildSystemPrompt();

  return async function generate(req: GenerateRequest): Promise<{ spec: WidgetSpec; attempts: number }> {
    if (req.specVersion !== SPEC_VERSION) {
      throw new GenerationError(`unsupported specVersion ${req.specVersion}; server speaks ${SPEC_VERSION}`, 400);
    }
    const user = buildUserMessage(req);
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: "user",
        content: [
          // The manifest is identical across requests from the same app version: cache it.
          { type: "text", text: user.manifest, cache_control: { type: "ephemeral" } },
          { type: "text", text: user.request },
        ],
      },
    ];

    let lastErrors: string[] = [];
    for (let attempt = 1; attempt <= maxRepairs + 1; attempt++) {
      const response = await client.beta.messages
        .stream({
          model,
          max_tokens: 32000,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages,
          thinking: { type: "adaptive" },
          output_config: { effort: opts.effort ?? "medium" },
          // On a safety-classifier decline, let the API re-run the request on a fallback model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        })
        .finalMessage();

      if (response.stop_reason === "refusal") {
        throw new GenerationError("The request was declined", 422);
      }
      if (response.stop_reason === "max_tokens") {
        throw new GenerationError("The widget was too large to generate", 422);
      }

      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      let candidate: unknown;
      try {
        candidate = extractJson(text);
        const r = validateSpec(candidate, req.manifest);
        if (r.ok) {
          if (!r.spec.prompt) r.spec.prompt = req.prompt;
          return { spec: r.spec, attempts: attempt };
        }
        lastErrors = r.errors;
      } catch (e) {
        lastErrors = [`reply was not valid JSON: ${(e as Error).message}`];
      }

      // Append-only repair turn: keep the full assistant reply (including thinking blocks) and add feedback.
      messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
      messages.push({
        role: "user",
        content: `The widget spec failed validation:\n${lastErrors.map((e) => `- ${e}`).join("\n")}\nReply with the corrected, complete JSON spec only.`,
      });
    }
    throw new GenerationError("Could not generate a valid widget", 422, lastErrors);
  };
}
