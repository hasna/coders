/**
 * Anthropic Messages API client
 *
 * Features:
 *   - POST /v1/messages with beta headers
 *   - Streaming via SSE
 *   - Non-streaming (full response)
 *   - Abort signal support
 *   - Timeout management
 *   - Retry with exponential backoff
 *   - Token counting endpoint
 *   - Brotli/gzip decompression (automatic via fetch)
 */
import { resolveApiKey, getApiProvider, type ApiProvider, type ResolvedApiKey } from "../auth/api-key.js";
import { resolveModelId, getContextWindow, hasExtendedContext } from "./models.js";
import {
  parseSSEStream,
  accumulateStream,
  type StreamEvent,
  type AccumulatedMessage,
  type ContentBlock,
  estimateCost,
} from "./streaming.js";

// ── Types ──────────────────────────────────────────────────────────

export interface MessageRequest {
  model: string;
  messages: Message[];
  systemPrompt?: string | SystemBlock[];
  tools?: ToolDefinition[];
  /** Server-side tools (e.g. web_search_20250305) — appended to tools array */
  serverTools?: Array<Record<string, unknown>>;
  toolChoice?: ToolChoice;
  maxTokens?: number;
  thinkingConfig?: ThinkingConfig;
  stream?: boolean;
  signal?: AbortSignal;
  maxRetries?: number;
  querySource?: string;
  metadata?: Record<string, unknown>;
}

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "none" }
  | { type: "tool"; name: string };

export type ThinkingConfig =
  | { type: "enabled"; budget_tokens?: number }
  | { type: "adaptive" }
  | { type: "disabled" };

export interface MessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: ContentBlock[];
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface TokenCountResponse {
  input_tokens: number;
}

// ── API Client ─────────────────────────────────────────────────────

const BETA_HEADERS = [
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
];

const DEFAULT_MAX_TOKENS = 16_384;
const DEFAULT_TIMEOUT_MS = 120_000;

export class ApiClient {
  private baseUrl: string;
  private provider: ApiProvider;
  private apiKey: ResolvedApiKey | null = null;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCostUsd = 0;
  private totalApiDurationMs = 0;
  private requestCount = 0;

  constructor(options?: { baseUrl?: string; provider?: ApiProvider }) {
    this.provider = options?.provider ?? getApiProvider();
    this.baseUrl = options?.baseUrl ?? this.getDefaultBaseUrl();
  }

  private getDefaultBaseUrl(): string {
    switch (this.provider) {
      case "bedrock":
        return process.env.ANTHROPIC_BEDROCK_BASE_URL ?? "https://bedrock-runtime.us-east-1.amazonaws.com";
      case "vertex":
        return process.env.ANTHROPIC_VERTEX_BASE_URL ?? "https://us-east5-aiplatform.googleapis.com";
      case "foundry":
        return process.env.ANTHROPIC_FOUNDRY_BASE_URL ?? "https://api.anthropic.com";
      default:
        return process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
    }
  }

  private getApiKey(): ResolvedApiKey {
    if (!this.apiKey) {
      this.apiKey = resolveApiKey();
      if (!this.apiKey) {
        throw new Error("No API key found. Set ANTHROPIC_API_KEY or run 'coders auth login'.");
      }
    }
    return this.apiKey;
  }

  private buildHeaders(): Record<string, string> {
    const key = this.getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": BETA_HEADERS.join(","),
      "User-Agent": `coders/${process.env.CODERS_VERSION ?? "0.0.1"}`,
    };

    if (key.isOAuth) {
      headers["Authorization"] = `Bearer ${key.apiKey}`;
    } else {
      headers["x-api-key"] = key.apiKey;
    }

    return headers;
  }

  private buildRequestBody(request: MessageRequest): Record<string, unknown> {
    const modelId = resolveModelId(request.model, this.provider);
    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;

    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: maxTokens,
      messages: request.messages,
      stream: request.stream ?? false,
    };

    if (request.systemPrompt) {
      body.system = typeof request.systemPrompt === "string"
        ? request.systemPrompt
        : request.systemPrompt;
    }

    const allTools: unknown[] = [...(request.tools ?? []), ...(request.serverTools ?? [])];
    if (allTools.length > 0) {
      body.tools = allTools;
    }

    if (request.toolChoice) {
      body.tool_choice = request.toolChoice;
    }

    if (request.thinkingConfig && request.thinkingConfig.type !== "disabled") {
      body.thinking = request.thinkingConfig;
    }

    if (request.metadata) {
      body.metadata = request.metadata;
    }

    return body;
  }

  // ── Non-streaming request ──────────────────────────────────────

  async createMessage(request: MessageRequest): Promise<MessageResponse> {
    const body = this.buildRequestBody({ ...request, stream: false });
    const headers = this.buildHeaders();
    const url = `${this.baseUrl}/v1/messages`;

    const startTime = performance.now();
    let retries = 0;
    const maxRetries = request.maxRetries ?? 3;

    while (true) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: request.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          if (response.status === 429 || response.status >= 500) {
            if (retries < maxRetries) {
              retries++;
              const delay = Math.min(1000 * Math.pow(2, retries), 30_000);
              await sleep(delay);
              continue;
            }
          }
          throw new ApiError(response.status, errorBody, url);
        }

        const result = (await response.json()) as MessageResponse;
        const durationMs = performance.now() - startTime;

        this.trackUsage(result.usage, durationMs);
        return result;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if ((error as Error).name === "AbortError") throw error;
        if (retries < maxRetries) {
          retries++;
          const delay = Math.min(1000 * Math.pow(2, retries), 30_000);
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }
  }

  // ── Streaming request ──────────────────────────────────────────

  async *streamMessage(
    request: MessageRequest,
  ): AsyncGenerator<{ type: "event"; event: StreamEvent; accumulated: Partial<AccumulatedMessage> }> {
    const body = this.buildRequestBody({ ...request, stream: true });
    const headers = { ...this.buildHeaders(), Accept: "text/event-stream" };
    const url = `${this.baseUrl}/v1/messages`;

    const startTime = performance.now();
    let retries = 0;
    const maxRetries = request.maxRetries ?? 2;

    while (true) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: request.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          if ((response.status === 429 || response.status >= 500) && retries < maxRetries) {
            retries++;
            await sleep(Math.min(1000 * Math.pow(2, retries), 30_000));
            continue;
          }
          throw new ApiError(response.status, errorBody, url);
        }

        if (!response.body) {
          throw new Error("No response body for streaming request");
        }

        const sseEvents = parseSSEStream(response.body, request.signal);
        const accumulated = accumulateStream(sseEvents);

        let lastAccumulated: Partial<AccumulatedMessage> = {};

        for await (const item of accumulated) {
          lastAccumulated = item.accumulated;
          yield item;
        }

        // Track final usage
        if (lastAccumulated.usage) {
          this.trackUsage(
            {
              input_tokens: lastAccumulated.usage.inputTokens,
              output_tokens: lastAccumulated.usage.outputTokens,
            },
            performance.now() - startTime,
          );
        }
        return;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if ((error as Error).name === "AbortError") throw error;
        if (retries < maxRetries) {
          retries++;
          await sleep(Math.min(1000 * Math.pow(2, retries), 30_000));
          continue;
        }
        throw error;
      }
    }
  }

  // ── Token counting ─────────────────────────────────────────────

  async countTokens(request: Omit<MessageRequest, "stream">): Promise<TokenCountResponse> {
    const body = this.buildRequestBody({ ...request, stream: false });
    delete body.stream;
    const headers = {
      ...this.buildHeaders(),
      "anthropic-beta": "token-counting-2024-11-01",
    };
    const url = `${this.baseUrl}/v1/messages/count_tokens`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ApiError(response.status, errorBody, url);
    }

    return (await response.json()) as TokenCountResponse;
  }

  // ── Usage tracking ─────────────────────────────────────────────

  private trackUsage(
    usage: { input_tokens: number; output_tokens: number },
    durationMs: number,
    model?: string,
  ): void {
    this.totalInputTokens += usage.input_tokens;
    this.totalOutputTokens += usage.output_tokens;
    this.totalApiDurationMs += durationMs;
    this.requestCount++;
    const cost = estimateCost({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }, model ?? "sonnet");
    this.totalCostUsd += cost.totalCostUsd;
  }

  getUsageStats(): {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    totalApiDurationMs: number;
    requestCount: number;
  } {
    return {
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCostUsd: this.totalCostUsd,
      totalApiDurationMs: this.totalApiDurationMs,
      requestCount: this.requestCount,
    };
  }
}

// ── API Error ──────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  body: string;
  url: string;

  constructor(status: number, body: string, url: string) {
    let message: string;
    try {
      const parsed = JSON.parse(body);
      message = parsed.error?.message ?? parsed.message ?? body;
    } catch {
      message = body;
    }
    const hints: Record<number, string> = {
      401: " — Check your API key: run `coders auth status` or set ANTHROPIC_API_KEY",
      403: " — Your API key doesn't have access to this model or feature",
      429: " — Rate limited. Wait a moment and try again",
      529: " — Anthropic API is overloaded. Try again in a few seconds",
    };
    super(`API error ${status}: ${message}${hints[status] ?? ""}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Singleton ──────────────────────────────────────────────────────

let _defaultClient: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (!_defaultClient) {
    _defaultClient = new ApiClient();
  }
  return _defaultClient;
}

export function resetApiClient(): void {
  _defaultClient = null;
}
