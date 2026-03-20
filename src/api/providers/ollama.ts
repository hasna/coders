/**
 * Ollama local model provider adapter (NEW — improvement over Claude Code)
 *
 * Supports running local models via Ollama's OpenAI-compatible API.
 *
 * API: POST http://localhost:11434/v1/chat/completions
 * Auth: None required (local)
 *
 * Inherits from OpenAI adapter since Ollama uses the same API format.
 */
import { OpenAIAdapter } from "./openai.js";

export class OllamaAdapter extends OpenAIAdapter {
  override readonly name = "ollama";

  constructor(baseUrl?: string) {
    super(
      baseUrl
        ?? process.env.OLLAMA_BASE_URL
        ?? process.env.OLLAMA_HOST
        ?? "http://localhost:11434",
    );
  }

  override buildHeaders(_apiKey: string, _isOAuth: boolean): Record<string, string> {
    // Ollama doesn't require authentication
    return {
      "Content-Type": "application/json",
    };
  }

  override resolveModel(model: string): string {
    // Ollama uses its own model names
    const aliases: Record<string, string> = {
      sonnet: "llama3.1:70b",
      opus: "llama3.1:405b",
      haiku: "llama3.1:8b",
    };
    return aliases[model] ?? model;
  }

  override supportsModel(_model: string): boolean {
    return true; // Ollama accepts any locally installed model
  }
}
