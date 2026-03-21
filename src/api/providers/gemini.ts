/**
 * Google Gemini provider adapter
 *
 * Gemini uses a different API format from OpenAI — we implement ProviderAdapter
 * directly and translate between Anthropic message format and Gemini's format.
 *
 * API: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *      POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent
 * Auth: API key as query parameter (?key=...) or Bearer token
 *
 * Supports: gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash
 */
import type { ProviderAdapter } from "./interface.js";

const GEMINI_MODELS = new Set([
  "gemini-2.5-pro",
  "gemini-2.5-pro-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
]);

export class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini";
  readonly baseUrl: string;
  private model = "gemini-2.5-pro";

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl
      ?? process.env.GEMINI_BASE_URL
      ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  buildHeaders(apiKey: string, _isOAuth: boolean): Record<string, string> {
    const key = apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    };
  }

  resolveModel(model: string): string {
    const aliases: Record<string, string> = {
      sonnet: "gemini-2.5-pro",
      opus: "gemini-2.5-pro",
      haiku: "gemini-2.5-flash",
    };
    const resolved = aliases[model] ?? model;
    this.model = resolved;
    return resolved;
  }

  buildRequestBody(body: Record<string, unknown>): Record<string, unknown> {
    // Resolve model first so this.model is set for getMessagesEndpoint
    if (body.model) {
      this.resolveModel(body.model as string);
    }

    const messages = body.messages as Array<Record<string, unknown>> ?? [];
    const systemPrompt = body.system ?? body.systemPrompt;
    const isStream = body.stream ?? false;

    // Transform Anthropic messages to Gemini "contents" format
    const contents = transformMessagesToGemini(messages);

    const geminiBody: Record<string, unknown> = {
      contents,
    };

    // System instruction (Gemini uses systemInstruction at top level)
    if (systemPrompt) {
      geminiBody.systemInstruction = {
        parts: [{ text: typeof systemPrompt === "string" ? systemPrompt : JSON.stringify(systemPrompt) }],
      };
    }

    // Generation config
    const generationConfig: Record<string, unknown> = {};
    if (body.max_tokens) generationConfig.maxOutputTokens = body.max_tokens;
    if (Object.keys(generationConfig).length > 0) {
      geminiBody.generationConfig = generationConfig;
    }

    // Tool declarations (Gemini format)
    if (body.tools) {
      geminiBody.tools = [{
        functionDeclarations: transformToolsToGemini(body.tools as Array<Record<string, unknown>>),
      }];
    }

    // Store stream preference for endpoint selection
    (geminiBody as Record<string, unknown>).__stream = isStream;

    return geminiBody;
  }

  parseStreamEvent(raw: Record<string, unknown>): Record<string, unknown> {
    // Transform Gemini streaming format to Anthropic-like events
    const candidates = raw.candidates as Array<Record<string, unknown>> | undefined;
    if (!candidates || candidates.length === 0) return raw;

    const candidate = candidates[0];
    const content = candidate.content as Record<string, unknown> | undefined;

    if (content?.parts) {
      const parts = content.parts as Array<Record<string, unknown>>;
      for (const part of parts) {
        if (part.text) {
          return {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: part.text },
          };
        }
        if (part.functionCall) {
          const fc = part.functionCall as Record<string, unknown>;
          return {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "tool_use",
              name: fc.name,
              input: fc.args,
            },
          };
        }
      }
    }

    const finishReason = candidate.finishReason;
    if (finishReason === "STOP" || finishReason === "MAX_TOKENS") {
      return { type: "message_stop" };
    }

    return raw;
  }

  getBetaHeaders(): string[] {
    return [];
  }

  supportsModel(model: string): boolean {
    if (GEMINI_MODELS.has(model)) return true;
    return model.startsWith("gemini");
  }

  getMessagesEndpoint(): string {
    // Gemini embeds the model name in the URL
    return `/models/${this.model}:generateContent`;
  }
}

// ── Format transformers ────────────────────────────────────────────

/**
 * Transform Anthropic-format messages to Gemini "contents" format.
 *
 * Anthropic: [{ role: "user"|"assistant", content: string|ContentBlock[] }]
 * Gemini:    [{ role: "user"|"model", parts: [{ text }|{ functionCall }|{ functionResponse }] }]
 */
function transformMessagesToGemini(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const contents: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    const role = msg.role === "assistant" ? "model" : "user";
    const content = msg.content;

    if (typeof content === "string") {
      contents.push({ role, parts: [{ text: content }] });
      continue;
    }

    if (Array.isArray(content)) {
      const parts: Array<Record<string, unknown>> = [];

      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === "text") {
          parts.push({ text: block.text });
        } else if (block.type === "tool_use") {
          parts.push({
            functionCall: {
              name: block.name,
              args: block.input ?? {},
            },
          });
        } else if (block.type === "tool_result") {
          // Tool results in Gemini are functionResponse parts
          const resultContent = typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
          parts.push({
            functionResponse: {
              name: block.tool_use_id ?? "unknown",
              response: { content: resultContent },
            },
          });
        } else {
          parts.push({ text: JSON.stringify(block) });
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
      continue;
    }

    contents.push({ role, parts: [{ text: String(content) }] });
  }

  return contents;
}

/**
 * Transform Anthropic tool definitions to Gemini function declarations.
 */
function transformToolsToGemini(
  tools: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  }));
}
