/**
 * Tool interface — the standard shape every tool must implement
 *
 * Matches Claude Code's tool object shape exactly, but typed cleanly.
 * Every built-in tool and MCP tool conforms to this interface.
 */
import type { z } from "zod";
import type { PermissionResult } from "../config/permissions.js";

// ── Tool Context (passed to call()) ────────────────────────────────

export interface ToolContext {
  /** Abort signal for cancellation */
  abortController: AbortController;
  /** Agent ID (for sub-agents) */
  agentId?: string;
  /** Get the current app state */
  getAppState: () => AppState;
  /** Update app state */
  setAppState: (updater: (state: AppState) => AppState) => void;
  /** Add notification to UI */
  addNotification?: (notification: Notification) => void;
  /** The current tool options */
  options: ToolOptions;
}

export interface AppState {
  toolPermissionContext: import("../config/permissions.js").ToolPermissionContext;
  expandedView?: string;
  verbose: boolean;
  effortValue?: string;
  [key: string]: unknown;
}

export interface ToolOptions {
  mainLoopModel: string;
  thinkingConfig: import("../api/client.js").ThinkingConfig;
  isNonInteractiveSession: boolean;
  appendSystemPrompt?: string;
  tools: Tool[];
  agentDefinitions: { activeAgents: unknown[] };
  [key: string]: unknown;
}

export interface Notification {
  key: string;
  text: string;
  priority: "immediate" | "low";
  color?: string;
  timeoutMs?: number;
}

// ── Validation Result ──────────────────────────────────────────────

export interface ValidationResult {
  result: boolean;
  message?: string;
  errorCode?: number;
}

// ── Tool Result ────────────────────────────────────────────────────

export interface ToolCallResult<T = unknown> {
  data: T;
}

// ── Tool Result Block (API format) ─────────────────────────────────

export interface ToolResultBlockParam {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// ── The Tool Interface ─────────────────────────────────────────────

export interface Tool<TInput = Record<string, unknown>, TOutput = unknown> {
  /** Unique tool name (e.g., "Bash", "Read", "Edit") */
  name: string;

  /** Keywords for ToolSearch deferred matching */
  searchHint: string;

  /** Max characters in tool result before truncation */
  maxResultSizeChars: number;

  /** Whether this tool can be deferred (loaded on demand via ToolSearch) */
  shouldDefer: boolean;

  /** Whether this tool requires strict input validation */
  strict?: boolean;

  /** Dynamic description (may depend on input) */
  description(input?: TInput): Promise<string> | string;

  /** System prompt content for this tool */
  prompt(input?: TInput): Promise<string> | string;

  /** Zod input schema (lazy-initialized) */
  readonly inputSchema: z.ZodType<TInput>;

  /** Zod output schema (lazy-initialized) */
  readonly outputSchema: z.ZodType<TOutput>;

  /** Display name for UI */
  userFacingName(input?: TInput): string;

  /** Whether this tool is currently available */
  isEnabled(): boolean;

  /** Whether this tool is safe for parallel execution */
  isConcurrencySafe(): boolean;

  /** Whether this tool has no side effects */
  isReadOnly(): boolean;

  /** Extract input text for auto-mode classifier */
  toAutoClassifierInput(input: TInput): string;

  /** Whether this tool requires user interaction (e.g., AskUserQuestion) */
  requiresUserInteraction?(): boolean;

  /** Get file path from input (for file-based tools) */
  getPath?(input: TInput): string;

  /** Get activity description for UI spinner */
  getActivityDescription?(input: TInput): string;

  /** Get tool use summary for display */
  getToolUseSummary?(input: TInput): string | null;

  /** Check if this tool use is destructive (for confirmation) */
  isDestructive?(input: TInput): boolean;

  // ── Permission & Validation ──────────────────────────────────

  /** Check permissions for this tool use */
  checkPermissions(
    input: TInput,
    context: ToolContext,
  ): Promise<PermissionResult>;

  /** Validate input before execution */
  validateInput(
    input: TInput,
    context?: Partial<ToolContext>,
  ): Promise<ValidationResult>;

  // ── Execution ────────────────────────────────────────────────

  /** Execute the tool */
  call(
    input: TInput,
    context: ToolContext,
    ...extra: unknown[]
  ): Promise<ToolCallResult<TOutput>>;

  /** Convert tool result to API-compatible format */
  mapToolResultToToolResultBlockParam(
    result: TOutput,
    toolUseId: string,
  ): ToolResultBlockParam;

  // ── UI Rendering (React/Ink components) ──────────────────────
  // These return React nodes for terminal rendering.
  // They are optional — tools without render methods get default display.

  /** Render the tool use message (input display) */
  renderToolUseMessage?(
    input: TInput,
    context: { verbose: boolean; theme?: string },
  ): unknown;

  /** Render progress while tool is executing */
  renderToolUseProgressMessage?(
    input: TInput,
    context: { verbose: boolean },
  ): unknown;

  /** Render the tool result */
  renderToolResultMessage?(
    result: TOutput,
    input: TInput,
    context: { verbose: boolean; theme?: string },
  ): unknown;

  /** Render when tool use was rejected by permissions */
  renderToolUseRejectedMessage?(
    input: TInput,
    context: { verbose: boolean },
  ): unknown;

  /** Render when tool use errored */
  renderToolUseErrorMessage?(
    error: unknown,
    context: { verbose: boolean },
  ): unknown;
}
