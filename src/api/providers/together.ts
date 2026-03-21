/**
 * Together.ai provider adapter
 *
 * Together's API is OpenAI-compatible, so we extend the OpenAI adapter.
 *
 * API: POST https://api.together.xyz/v1/chat/completions
 * Auth: Bearer token (TOGETHER_API_KEY)
 *
 * Supports hundreds of open-source models (Llama, Mistral, Qwen, etc.)
 */
import { OpenAIAdapter } from "./openai.js";

export class TogetherAdapter extends OpenAIAdapter {
  override readonly name = "together";

  constructor(baseUrl?: string) {
    super(
      baseUrl
        ?? process.env.TOGETHER_BASE_URL
        ?? "https://api.together.xyz",
    );
  }

  override buildHeaders(apiKey: string, _isOAuth: boolean): Record<string, string> {
    const key = apiKey || process.env.TOGETHER_API_KEY || "";
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    };
  }

  override resolveModel(model: string): string {
    // Map convenience aliases to popular Together models
    const aliases: Record<string, string> = {
      sonnet: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
      opus: "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo",
      haiku: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    };
    return aliases[model] ?? model;
  }

  override supportsModel(_model: string): boolean {
    return true; // Together hosts hundreds of models — accept any string
  }
}
