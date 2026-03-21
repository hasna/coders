/**
 * xAI (Grok) provider adapter
 *
 * xAI's API is OpenAI-compatible, so we extend the OpenAI adapter.
 *
 * API: POST https://api.x.ai/v1/chat/completions
 * Auth: Bearer token (XAI_API_KEY)
 *
 * Supports: grok-3, grok-3-mini, grok-2
 */
import { OpenAIAdapter } from "./openai.js";

const GROK_MODELS = new Set([
  "grok-3",
  "grok-3-mini",
  "grok-2",
  "grok-2-mini",
  "grok-2-1212",
]);

export class XAIAdapter extends OpenAIAdapter {
  override readonly name = "xai";

  constructor(baseUrl?: string) {
    super(
      baseUrl
        ?? process.env.XAI_BASE_URL
        ?? "https://api.x.ai",
    );
  }

  override buildHeaders(apiKey: string, _isOAuth: boolean): Record<string, string> {
    const key = apiKey || process.env.XAI_API_KEY || "";
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    };
  }

  override resolveModel(model: string): string {
    // Map convenience aliases to Grok models
    const aliases: Record<string, string> = {
      sonnet: "grok-3",
      opus: "grok-3",
      haiku: "grok-3-mini",
    };
    return aliases[model] ?? model;
  }

  override supportsModel(model: string): boolean {
    if (GROK_MODELS.has(model)) return true;
    // Accept any model string starting with "grok"
    return model.startsWith("grok");
  }
}
