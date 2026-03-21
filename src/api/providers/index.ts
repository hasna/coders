/**
 * Provider adapters — public API
 *
 * Auto-detects the correct provider from environment variables.
 */
import type { ProviderAdapter, ProviderName } from "./interface.js";
import { AnthropicAdapter } from "./anthropic.js";
import { BedrockAdapter } from "./bedrock.js";
import { VertexAdapter } from "./vertex.js";
import { OpenAIAdapter } from "./openai.js";
import { OllamaAdapter } from "./ollama.js";
import { XAIAdapter } from "./xai.js";
import { TogetherAdapter } from "./together.js";
import { GeminiAdapter } from "./gemini.js";

export type { ProviderAdapter, ProviderName } from "./interface.js";
export { AnthropicAdapter } from "./anthropic.js";
export { BedrockAdapter } from "./bedrock.js";
export { VertexAdapter } from "./vertex.js";
export { OpenAIAdapter } from "./openai.js";
export { OllamaAdapter } from "./ollama.js";
export { XAIAdapter } from "./xai.js";
export { TogetherAdapter } from "./together.js";
export { GeminiAdapter } from "./gemini.js";

/**
 * Detect the API provider from environment variables and return the adapter.
 */
export function detectProvider(): ProviderAdapter {
  // Check for Ollama first (explicit opt-in)
  if (process.env.CODERS_PROVIDER === "ollama" || process.env.OLLAMA_BASE_URL) {
    return new OllamaAdapter();
  }

  // Check for xAI (Grok)
  if (process.env.CODERS_PROVIDER === "xai" || process.env.XAI_API_KEY) {
    return new XAIAdapter();
  }

  // Check for Together.ai
  if (process.env.CODERS_PROVIDER === "together" || process.env.TOGETHER_API_KEY) {
    return new TogetherAdapter();
  }

  // Check for Google Gemini
  if (
    process.env.CODERS_PROVIDER === "gemini" ||
    (process.env.GOOGLE_API_KEY && !process.env.ANTHROPIC_API_KEY) ||
    process.env.GEMINI_API_KEY
  ) {
    return new GeminiAdapter();
  }

  // Check for OpenAI-compatible (explicit opt-in)
  if (process.env.CODERS_PROVIDER === "openai" || process.env.OPENAI_BASE_URL) {
    return new OpenAIAdapter();
  }

  // Check for Bedrock (AWS env vars)
  if (
    process.env.ANTHROPIC_BEDROCK_BASE_URL ||
    process.env.CODERS_PROVIDER === "bedrock" ||
    (process.env.AWS_ACCESS_KEY_ID && process.env.CODERS_PROVIDER !== "anthropic")
  ) {
    return new BedrockAdapter();
  }

  // Check for Vertex (GCP env vars)
  if (
    process.env.ANTHROPIC_VERTEX_PROJECT_ID ||
    process.env.CODERS_PROVIDER === "vertex" ||
    process.env.CLOUD_ML_REGION
  ) {
    return new VertexAdapter();
  }

  // Check for Foundry
  if (process.env.ANTHROPIC_FOUNDRY_BASE_URL || process.env.CODERS_PROVIDER === "foundry") {
    return new AnthropicAdapter(process.env.ANTHROPIC_FOUNDRY_BASE_URL);
  }

  // Default: Anthropic first-party
  return new AnthropicAdapter();
}

/**
 * Get a provider adapter by name.
 */
export function getProvider(name: ProviderName): ProviderAdapter {
  switch (name) {
    case "anthropic": return new AnthropicAdapter();
    case "bedrock": return new BedrockAdapter();
    case "vertex": return new VertexAdapter();
    case "openai": return new OpenAIAdapter();
    case "ollama": return new OllamaAdapter();
    case "xai": return new XAIAdapter();
    case "together": return new TogetherAdapter();
    case "gemini": return new GeminiAdapter();
    case "foundry": return new AnthropicAdapter(process.env.ANTHROPIC_FOUNDRY_BASE_URL);
    default: return new AnthropicAdapter();
  }
}

/**
 * List all available provider names.
 */
export function getAvailableProviders(): ProviderName[] {
  return ["anthropic", "bedrock", "vertex", "foundry", "openai", "ollama", "xai", "together", "gemini"];
}
