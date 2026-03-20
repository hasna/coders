/**
 * Anthropic first-party provider adapter (default)
 *
 * API: POST https://api.anthropic.com/v1/messages
 * Auth: x-api-key header or Bearer token (OAuth)
 */
import type { ProviderAdapter } from "./interface.js";
import { resolveModelId } from "../models.js";

const BETA_HEADERS = [
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
];

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic";
  readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
  }

  buildHeaders(apiKey: string, isOAuth: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": BETA_HEADERS.join(","),
    };
    if (isOAuth) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    } else {
      headers["x-api-key"] = apiKey;
    }
    return headers;
  }

  resolveModel(model: string): string {
    return resolveModelId(model, "firstParty");
  }

  buildRequestBody(body: Record<string, unknown>): Record<string, unknown> {
    return body; // Anthropic's native format, no transformation needed
  }

  getBetaHeaders(): string[] {
    return BETA_HEADERS;
  }

  supportsModel(model: string): boolean {
    const resolved = this.resolveModel(model);
    return resolved.includes("claude");
  }

  getMessagesEndpoint(): string {
    return "/v1/messages";
  }

  getTokenCountEndpoint(): string {
    return "/v1/messages/count_tokens";
  }
}
