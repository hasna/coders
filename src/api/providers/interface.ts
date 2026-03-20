/**
 * Provider adapter interface — common abstraction for all LLM providers
 *
 * Each provider (Anthropic, Bedrock, Vertex, OpenAI, Ollama) implements
 * this interface to normalize API differences.
 */

export interface ProviderAdapter {
  /** Provider name identifier */
  readonly name: string;

  /** Base URL for API requests */
  readonly baseUrl: string;

  /** Build HTTP headers for a request */
  buildHeaders(apiKey: string, isOAuth: boolean): Record<string, string>;

  /** Transform a model alias/ID for this provider */
  resolveModel(model: string): string;

  /** Build the request body (provider-specific transformations) */
  buildRequestBody(body: Record<string, unknown>): Record<string, unknown>;

  /** Parse a streaming event (if provider uses non-standard SSE format) */
  parseStreamEvent?(raw: Record<string, unknown>): Record<string, unknown>;

  /** Additional beta headers for this provider */
  getBetaHeaders(): string[];

  /** Check if a model is supported by this provider */
  supportsModel(model: string): boolean;

  /** Get the messages endpoint path */
  getMessagesEndpoint(): string;

  /** Get the token counting endpoint path (if supported) */
  getTokenCountEndpoint?(): string;
}

export type ProviderName = "anthropic" | "bedrock" | "vertex" | "foundry" | "openai" | "ollama";
