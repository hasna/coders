/**
 * Core agent loop — THE heart of the coding agent
 *
 * Flow (matching Claude Code's main loop structure):
 *   1. Receive user message
 *   2. Build messages array (system prompt + conversation history)
 *   3. Call Anthropic API (streaming)
 *   4. Process response: text output + tool_use blocks
 *   5. For each tool_use: check permissions -> validate -> execute -> collect result
 *   6. If tool results exist, loop back to step 3 with tool results appended
 *   7. When stop_reason is "end_turn" or no more tool_use, the turn is complete
 *   8. Update metrics, emit events
 *
 * The loop handles:
 *   - Streaming text to the UI as it arrives
 *   - Interleaved thinking blocks
 *   - Multiple tool uses per turn
 *   - Concurrent tool execution (for concurrency-safe tools)
 *   - Permission prompting
 *   - Abort/cancel at any point
 */
import {
  ApiClient,
  getApiClient,
  type MessageRequest,
  type Message,
  type ToolDefinition,
  type ThinkingConfig,
  type ContentBlock,
  type ToolUseBlock,
} from "../api/index.js";
import type { PermissionResult, ToolPermissionContext } from "../config/permissions.js";
import { errorToString } from "./errors.js";

// ── Types ──────────────────────────────────────────────────────────

export interface AgentLoopOptions {
  /** The API client to use */
  client?: ApiClient;
  /** System prompt (string or content blocks) */
  systemPrompt: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  /** Available tools */
  tools: ToolHandler[];
  /** Model to use */
  model: string;
  /** Thinking configuration */
  thinkingConfig: ThinkingConfig;
  /** Max tokens per response */
  maxTokens?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /** Permission context */
  permissionContext: ToolPermissionContext;
  /** Callback for checking tool permissions */
  onPermissionCheck?: (toolName: string, input: Record<string, unknown>) => Promise<PermissionResult>;
  /** Callback when text content streams in */
  onTextDelta?: (text: string) => void;
  /** Callback when thinking content streams in */
  onThinkingDelta?: (thinking: string) => void;
  /** Callback when a tool use starts */
  onToolUseStart?: (toolName: string, toolUseId: string, input: Record<string, unknown>) => void;
  /** Callback when a tool use completes */
  onToolUseEnd?: (toolName: string, toolUseId: string, result: ToolResult) => void;
  /** Callback when a tool use is rejected by permissions */
  onToolUseRejected?: (toolName: string, toolUseId: string, reason: string) => void;
  /** Callback when a turn completes */
  onTurnComplete?: (turnIndex: number, message: Message) => void;
  /** Callback for progress events */
  onProgress?: (event: ProgressEvent) => void;
  /** Query source identifier (for telemetry) */
  querySource?: string;
  /** Agent ID (for sub-agents) */
  agentId?: string;
  /** Max turns before forcing stop (safety limit) */
  maxTurns?: number;
}

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  call: (input: Record<string, unknown>, context: ToolCallContext) => Promise<ToolResult>;
  checkPermissions?: (input: Record<string, unknown>) => Promise<PermissionResult>;
  validateInput?: (input: Record<string, unknown>) => Promise<ValidationResult>;
}

export interface ToolCallContext {
  abortSignal?: AbortSignal;
  agentId?: string;
  toolUseId: string;
}

export interface ToolResult {
  data?: unknown;
  error?: string;
  isError?: boolean;
}

export interface ValidationResult {
  result: boolean;
  message?: string;
  errorCode?: number;
}

export type ProgressEvent =
  | { type: "turn_start"; turnIndex: number }
  | { type: "streaming"; turnIndex: number }
  | { type: "tool_execution"; toolName: string; toolUseId: string }
  | { type: "turn_end"; turnIndex: number; stopReason: string | null }
  | { type: "loop_end"; totalTurns: number };

export interface AgentLoopResult {
  messages: Message[];
  totalTurns: number;
  aborted: boolean;
  usage: {
    totalInputTokens: number;
    totalOutputTokens: number;
  };
}

// ── Agent Loop ─────────────────────────────────────────────────────

const DEFAULT_MAX_TURNS = 100;

export async function runAgentLoop(
  initialMessages: Message[],
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const client = options.client ?? getApiClient();
  const messages: Message[] = [...initialMessages];
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let turnIndex = 0;
  let aborted = false;

  // Build tool definitions for the API
  const toolDefs = buildToolDefinitions(options.tools);

  // Create a tool lookup map
  const toolMap = new Map(options.tools.map((t) => [t.name, t]));

  while (turnIndex < maxTurns) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }

    options.onProgress?.({ type: "turn_start", turnIndex });

    // ── Call the API (streaming) ───────────────────────────────

    const request: MessageRequest = {
      model: options.model,
      messages,
      systemPrompt: options.systemPrompt,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      thinkingConfig: options.thinkingConfig,
      maxTokens: options.maxTokens,
      stream: true,
      signal: options.signal,
      querySource: options.querySource,
    };

    options.onProgress?.({ type: "streaming", turnIndex });

    const contentBlocks: ContentBlock[] = [];
    let stopReason: string | null = null;

    try {
      for await (const item of client.streamMessage(request)) {
        if (options.signal?.aborted) {
          aborted = true;
          break;
        }

        const { event, accumulated } = item;

        // Stream text deltas to UI
        if (event.type === "content_block_delta" && event.delta) {
          if (event.delta.type === "text_delta") {
            options.onTextDelta?.(event.delta.text);
          } else if (event.delta.type === "thinking_delta") {
            options.onThinkingDelta?.(event.delta.thinking);
          }
        }

        // Track accumulated state
        if (event.type === "message_stop" || event.type === "message_delta") {
          if (accumulated.content) {
            contentBlocks.length = 0;
            contentBlocks.push(...accumulated.content);
          }
          stopReason = accumulated.stopReason ?? null;
          if (accumulated.usage) {
            totalInputTokens += accumulated.usage.inputTokens;
            totalOutputTokens += accumulated.usage.outputTokens;
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        aborted = true;
        break;
      }
      throw error;
    }

    if (aborted) break;

    // ── Build assistant message from content blocks ────────────

    const assistantMessage: Message = {
      role: "assistant",
      content: contentBlocks,
    };
    messages.push(assistantMessage);

    // ── Extract tool_use blocks ───────────────────────────────

    const toolUseBlocks = contentBlocks.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    // If no tool uses, the turn is complete
    if (toolUseBlocks.length === 0 || stopReason === "end_turn") {
      options.onTurnComplete?.(turnIndex, assistantMessage);
      options.onProgress?.({ type: "turn_end", turnIndex, stopReason });
      turnIndex++;
      break;
    }

    // ── Execute tools ─────────────────────────────────────────

    const toolResults = await executeTools(
      toolUseBlocks,
      toolMap,
      options,
    );

    // Append tool results as a user message
    const toolResultMessage: Message = {
      role: "user",
      content: toolResults.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.toolUseId,
        content: r.error ?? (typeof r.data === "string" ? r.data : JSON.stringify(r.data)),
        is_error: r.isError,
      })),
    };
    messages.push(toolResultMessage);

    options.onTurnComplete?.(turnIndex, assistantMessage);
    options.onProgress?.({ type: "turn_end", turnIndex, stopReason });
    turnIndex++;
  }

  options.onProgress?.({ type: "loop_end", totalTurns: turnIndex });

  return {
    messages,
    totalTurns: turnIndex,
    aborted,
    usage: { totalInputTokens, totalOutputTokens },
  };
}

// ── Tool Execution ─────────────────────────────────────────────────

interface ToolExecutionResult {
  toolUseId: string;
  toolName: string;
  data?: unknown;
  error?: string;
  isError?: boolean;
}

async function executeTools(
  toolUseBlocks: ToolUseBlock[],
  toolMap: Map<string, ToolHandler>,
  options: AgentLoopOptions,
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];

  // Separate concurrent-safe and non-concurrent tools
  const concurrentTools: Array<{ block: ToolUseBlock; handler: ToolHandler }> = [];
  const sequentialTools: Array<{ block: ToolUseBlock; handler: ToolHandler }> = [];

  for (const block of toolUseBlocks) {
    const handler = toolMap.get(block.name);
    if (!handler) {
      results.push({
        toolUseId: block.id,
        toolName: block.name,
        error: `Unknown tool: ${block.name}`,
        isError: true,
      });
      continue;
    }

    if (handler.isConcurrencySafe) {
      concurrentTools.push({ block, handler });
    } else {
      sequentialTools.push({ block, handler });
    }
  }

  // Execute concurrent tools in parallel
  if (concurrentTools.length > 0) {
    const concurrentResults = await Promise.all(
      concurrentTools.map(({ block, handler }) =>
        executeSingleTool(block, handler, options),
      ),
    );
    results.push(...concurrentResults);
  }

  // Execute sequential tools one at a time
  for (const { block, handler } of sequentialTools) {
    if (options.signal?.aborted) break;
    const result = await executeSingleTool(block, handler, options);
    results.push(result);
  }

  return results;
}

async function executeSingleTool(
  block: ToolUseBlock,
  handler: ToolHandler,
  options: AgentLoopOptions,
): Promise<ToolExecutionResult> {
  const { id: toolUseId, name: toolName, input } = block;

  options.onProgress?.({ type: "tool_execution", toolName, toolUseId });

  // Guard: reject tool_use blocks whose input JSON was not fully received.
  // The streaming accumulator flags these with _inputParseFailed = true, and
  // the input will be {}. Executing with empty input causes tools like
  // Write/Edit/Read to receive {file_path: undefined} and fail silently.
  const parseFailed = (block as ToolUseBlock & { _inputParseFailed?: boolean })._inputParseFailed;
  if (parseFailed) {
    const rawJson = (block as ToolUseBlock & { _rawInputJson?: string })._rawInputJson;
    const error = `Tool input not fully received — JSON parsing failed for ${toolName}. `
      + `Partial input (${rawJson?.length ?? 0} chars) could not be parsed. `
      + `This is a streaming issue; retrying the request should resolve it.`;
    options.onToolUseRejected?.(toolName, toolUseId, error);
    return { toolUseId, toolName, error, isError: true };
  }

  // Guard: even without the explicit flag, reject obviously empty input for
  // tools that are known to require parameters (heuristic: the tool has a
  // non-trivial inputSchema with required properties).
  if (
    input &&
    Object.keys(input).length === 0 &&
    handler.inputSchema &&
    Array.isArray((handler.inputSchema as { required?: string[] }).required) &&
    ((handler.inputSchema as { required?: string[] }).required ?? []).length > 0
  ) {
    const error = `Tool input not fully received — ${toolName} requires parameters `
      + `(${((handler.inputSchema as { required?: string[] }).required ?? []).join(", ")}) `
      + `but received empty input {}. Skipping execution to prevent undefined behavior.`;
    options.onToolUseRejected?.(toolName, toolUseId, error);
    return { toolUseId, toolName, error, isError: true };
  }

  options.onToolUseStart?.(toolName, toolUseId, input);

  try {
    // 1. Permission check
    if (options.onPermissionCheck) {
      const permResult = await options.onPermissionCheck(toolName, input);
      if (permResult.behavior === "deny") {
        const reason = permResult.message ?? "Permission denied";
        options.onToolUseRejected?.(toolName, toolUseId, reason);
        return { toolUseId, toolName, error: reason, isError: true };
      }
      // "ask" behavior would be handled by the UI layer
      // "allow" and "passthrough" proceed
    }

    // 2. Validate input
    if (handler.validateInput) {
      const validation = await handler.validateInput(input);
      if (!validation.result) {
        const error = validation.message ?? "Invalid input";
        return { toolUseId, toolName, error, isError: true };
      }
    }

    // 3. Execute
    const result = await handler.call(input, {
      abortSignal: options.signal,
      agentId: options.agentId,
      toolUseId,
    });

    options.onToolUseEnd?.(toolName, toolUseId, result);

    if (result.isError || result.error) {
      return { toolUseId, toolName, error: result.error, isError: true };
    }

    return { toolUseId, toolName, data: result.data };
  } catch (error) {
    const errorMsg = errorToString(error);
    options.onToolUseEnd?.(toolName, toolUseId, { error: errorMsg, isError: true });
    return { toolUseId, toolName, error: errorMsg, isError: true };
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function buildToolDefinitions(tools: ToolHandler[]): ToolDefinition[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

// ── Single message helper (non-loop, for one-shot queries) ─────────

export async function sendSingleMessage(
  prompt: string,
  options: {
    model?: string;
    systemPrompt?: string;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const client = getApiClient();
  const response = await client.createMessage({
    model: options.model ?? "sonnet46",
    messages: [{ role: "user", content: prompt }],
    systemPrompt: options.systemPrompt,
    signal: options.signal,
  });

  const textBlocks = response.content.filter(
    (b): b is { type: "text"; text: string } => b.type === "text",
  );
  return textBlocks.map((b) => b.text).join("");
}
