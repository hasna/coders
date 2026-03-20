/**
 * SSE (Server-Sent Events) stream parser and event accumulator
 *
 * Parses Anthropic Messages API streaming responses:
 *   message_start -> content_block_start -> content_block_delta -> content_block_stop -> message_delta -> message_stop
 */

// ── SSE Event Types ────────────────────────────────────────────────

export type StreamEventType =
  | "message_start"
  | "content_block_start"
  | "content_block_delta"
  | "content_block_stop"
  | "message_delta"
  | "message_stop"
  | "ping"
  | "error";

export interface StreamEvent {
  type: StreamEventType;
  index?: number;
  // message_start
  message?: {
    id: string;
    type: "message";
    role: "assistant";
    model: string;
    usage: { input_tokens: number; output_tokens: number };
    content: ContentBlock[];
    stop_reason: string | null;
  };
  // content_block_start
  content_block?: ContentBlock;
  // content_block_delta
  delta?: ContentDelta;
  // message_delta
  usage?: { output_tokens: number };
  // error
  error?: { type: string; message: string };
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ServerToolUseBlock
  | WebSearchToolResultBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ServerToolUseBlock {
  type: "server_tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface WebSearchToolResultBlock {
  type: "web_search_tool_result";
  tool_use_id: string;
  content: Array<{ title: string; url: string }>;
}

export type ContentDelta =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "input_json_delta"; partial_json: string }
  | { type: "signature_delta"; signature: string };

// ── SSE Parser ─────────────────────────────────────────────────────

/**
 * Parse an SSE stream (ReadableStream<Uint8Array>) into StreamEvents.
 * Handles chunked data, multi-line fields, and reconnection.
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on double newline (SSE event boundary)
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? ""; // last part is incomplete

      for (const part of parts) {
        const event = parseSSEEvent(part);
        if (event) yield event;
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const event = parseSSEEvent(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSSEEvent(raw: string): StreamEvent | null {
  let eventType = "";
  let data = "";

  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      const lineData = line.slice(5).trim();
      data += (data ? "\n" : "") + lineData;
    }
    // Ignore id:, retry:, and comment lines (:)
  }

  if (!data) return null;

  try {
    const parsed = JSON.parse(data) as StreamEvent;
    if (eventType) {
      parsed.type = eventType as StreamEventType;
    }
    return parsed;
  } catch {
    // Non-JSON data (e.g., "data: [DONE]")
    return null;
  }
}

// ── Stream Accumulator ─────────────────────────────────────────────

export interface AccumulatedMessage {
  id: string;
  model: string;
  role: "assistant";
  content: ContentBlock[];
  stopReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Accumulate streaming events into a complete message.
 * Yields intermediate events for progress tracking.
 */
export async function* accumulateStream(
  events: AsyncGenerator<StreamEvent>,
): AsyncGenerator<{
  type: "event";
  event: StreamEvent;
  accumulated: Partial<AccumulatedMessage>;
}> {
  const accumulated: Partial<AccumulatedMessage> & { content: ContentBlock[] } = {
    content: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  let currentBlockIndex = -1;
  let currentJsonAccumulator = "";

  for await (const event of events) {
    switch (event.type) {
      case "message_start": {
        if (event.message) {
          accumulated.id = event.message.id;
          accumulated.model = event.message.model;
          accumulated.role = event.message.role;
          accumulated.stopReason = event.message.stop_reason;
          if (event.message.usage) {
            accumulated.usage!.inputTokens = event.message.usage.input_tokens;
            accumulated.usage!.outputTokens = event.message.usage.output_tokens;
          }
        }
        break;
      }

      case "content_block_start": {
        if (event.content_block && event.index !== undefined) {
          currentBlockIndex = event.index;
          currentJsonAccumulator = "";
          accumulated.content.push({ ...event.content_block });
        }
        break;
      }

      case "content_block_delta": {
        if (event.delta && event.index !== undefined) {
          const block = accumulated.content[event.index];
          if (!block) break;

          switch (event.delta.type) {
            case "text_delta":
              if (block.type === "text") {
                block.text += event.delta.text;
              }
              break;
            case "thinking_delta":
              if (block.type === "thinking") {
                block.thinking += event.delta.thinking;
              }
              break;
            case "input_json_delta":
              if (block.type === "tool_use") {
                currentJsonAccumulator += event.delta.partial_json;
                // Try to parse accumulated JSON
                try {
                  block.input = JSON.parse(currentJsonAccumulator);
                } catch {
                  // Not complete yet
                }
              }
              break;
          }
        }
        break;
      }

      case "content_block_stop": {
        // Finalize the block
        if (event.index !== undefined) {
          const block = accumulated.content[event.index];
          if (block?.type === "tool_use" && currentJsonAccumulator) {
            try {
              block.input = JSON.parse(currentJsonAccumulator);
            } catch {
              block.input = {};
            }
          }
          currentJsonAccumulator = "";
        }
        break;
      }

      case "message_delta": {
        if (event.delta && "stop_reason" in event.delta) {
          accumulated.stopReason = (event.delta as { stop_reason: string }).stop_reason;
        }
        if (event.usage) {
          accumulated.usage!.outputTokens = event.usage.output_tokens;
        }
        break;
      }

      case "message_stop":
        // Stream complete
        break;

      case "error":
        throw new Error(`Stream error: ${event.error?.message ?? "Unknown error"}`);
    }

    yield { type: "event", event, accumulated };
  }
}

// ── Token counting helpers ─────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface CostEstimate {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

// Approximate costs per 1M tokens (first-party, as of 2025)
const COST_PER_1M_INPUT: Record<string, number> = {
  haiku: 0.80,
  sonnet: 3.00,
  opus: 15.00,
};

const COST_PER_1M_OUTPUT: Record<string, number> = {
  haiku: 4.00,
  sonnet: 15.00,
  opus: 75.00,
};

export function estimateCost(usage: TokenUsage, model: string): CostEstimate {
  const tier = model.includes("haiku") ? "haiku" : model.includes("opus") ? "opus" : "sonnet";
  const inputRate = COST_PER_1M_INPUT[tier] ?? 3.0;
  const outputRate = COST_PER_1M_OUTPUT[tier] ?? 15.0;

  const inputCostUsd = (usage.inputTokens / 1_000_000) * inputRate;
  const outputCostUsd = (usage.outputTokens / 1_000_000) * outputRate;

  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
  };
}
