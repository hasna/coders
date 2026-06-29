/**
 * Context window management and auto-compaction
 *
 * Tracks token usage across conversation and auto-compacts when
 * approaching the context window limit.
 *
 * Strategy (matching Claude Code's heuristic_context_compaction):
 *   1. Track estimated tokens per message
 *   2. When approaching limit (80% threshold), trigger compaction
 *   3. Compaction: summarize older messages, preserve recent context
 *   4. Preserve: system prompt, last N user/assistant turns, tool results
 *   5. Summarize: older conversation history into a condensed form
 */
import type { Message } from "../api/client.js";
import { getContextWindow } from "../api/models.js";

// ── Types ──────────────────────────────────────────────────────────

export interface ContextState {
  /** Total estimated tokens in current context */
  estimatedTokens: number;
  /** Context window size for current model */
  contextWindowSize: number;
  /** Utilization ratio (0-1) */
  utilization: number;
  /** Whether auto-compaction is needed */
  needsCompaction: boolean;
  /** Number of compactions performed */
  compactionCount: number;
  /** Tokens saved by compaction */
  tokensSavedByCompaction: number;
}

export interface CompactionResult {
  /** Compacted messages array */
  messages: Message[];
  /** Original token count before compaction */
  originalTokens: number;
  /** Token count after compaction */
  compactedTokens: number;
  /** Number of messages removed */
  messagesRemoved: number;
  /** Summary of removed context */
  summary: string;
}

export interface ContextManagerOptions {
  /** Model name (used to determine context window size) */
  model: string;
  /** Override context window size */
  contextWindowOverride?: number;
  /** Threshold ratio for triggering compaction (default 0.80) */
  compactionThreshold?: number;
  /** Number of recent turns to always preserve (default 10) */
  preserveRecentTurns?: number;
  /** Whether auto-compaction is enabled */
  autoCompactEnabled?: boolean;
  /** Callback when compaction occurs */
  onCompaction?: (result: CompactionResult) => void;
}

// ── Context Manager ────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4; // rough estimate
const DEFAULT_COMPACTION_THRESHOLD = 0.80;
const DEFAULT_PRESERVE_RECENT_TURNS = 10;

export class ContextManager {
  private contextWindowSize: number;
  private compactionThreshold: number;
  private preserveRecentTurns: number;
  private autoCompactEnabled: boolean;
  private compactionCount = 0;
  private tokensSavedByCompaction = 0;
  private onCompaction?: (result: CompactionResult) => void;

  constructor(options: ContextManagerOptions) {
    this.contextWindowSize = options.contextWindowOverride ?? getContextWindow(options.model);
    this.compactionThreshold = options.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
    this.preserveRecentTurns = options.preserveRecentTurns ?? DEFAULT_PRESERVE_RECENT_TURNS;
    this.autoCompactEnabled = options.autoCompactEnabled ?? true;
    this.onCompaction = options.onCompaction;
  }

  /**
   * Get the current context state for a set of messages.
   */
  getState(messages: Message[], systemPromptTokens = 0): ContextState {
    const messageTokens = estimateMessageTokens(messages);
    const totalTokens = systemPromptTokens + messageTokens;
    const utilization = totalTokens / this.contextWindowSize;

    return {
      estimatedTokens: totalTokens,
      contextWindowSize: this.contextWindowSize,
      utilization,
      needsCompaction: this.autoCompactEnabled && utilization >= this.compactionThreshold,
      compactionCount: this.compactionCount,
      tokensSavedByCompaction: this.tokensSavedByCompaction,
    };
  }

  /**
   * Check if compaction is needed and perform it if so.
   * Returns the (possibly compacted) messages array.
   */
  maybeCompact(messages: Message[], systemPromptTokens = 0): Message[] {
    const state = this.getState(messages, systemPromptTokens);
    if (!state.needsCompaction) return messages;
    return this.compact(messages);
  }

  /**
   * Force compaction of messages.
   */
  compact(messages: Message[]): Message[] {
    if (messages.length <= this.preserveRecentTurns * 2) {
      // Too few messages to compact
      return messages;
    }

    const originalTokens = estimateMessageTokens(messages);

    // Split messages: preserve recent, summarize old
    const preserveCount = this.preserveRecentTurns * 2; // user + assistant per turn
    const recentMessages = messages.slice(-preserveCount);
    const oldMessages = messages.slice(0, -preserveCount);

    if (oldMessages.length === 0) return messages;

    // Create summary of old messages
    const summary = createContextSummary(oldMessages);
    const summaryMessage: Message = {
      role: "user",
      content: `[Context Summary — ${oldMessages.length} earlier messages were compacted]\n\n${summary}\n\n[End of context summary. Recent conversation follows.]`,
    };

    const compactedMessages = [summaryMessage, ...recentMessages];
    const compactedTokens = estimateMessageTokens(compactedMessages);
    const messagesRemoved = oldMessages.length;

    this.compactionCount++;
    this.tokensSavedByCompaction += originalTokens - compactedTokens;

    const result: CompactionResult = {
      messages: compactedMessages,
      originalTokens,
      compactedTokens,
      messagesRemoved,
      summary,
    };

    this.onCompaction?.(result);
    return compactedMessages;
  }

  /**
   * Update the model (changes context window size).
   */
  setModel(model: string): void {
    this.contextWindowSize = getContextWindow(model);
  }

  /**
   * Get compaction stats.
   */
  getStats(): { compactionCount: number; tokensSavedByCompaction: number } {
    return {
      compactionCount: this.compactionCount,
      tokensSavedByCompaction: this.tokensSavedByCompaction,
    };
  }
}

// ── Token Estimation ───────────────────────────────────────────────

/**
 * Estimate token count for a set of messages.
 * Uses character-based heuristic (4 chars ≈ 1 token).
 */
export function estimateMessageTokens(messages: Message[]): number {
  let totalChars = 0;

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === "object" && block !== null) {
          const b = block as unknown as Record<string, unknown>;
          if (b.type === "text") totalChars += String(b.text ?? "").length;
          else if (b.type === "thinking") totalChars += String(b.thinking ?? "").length;
          else if (b.type === "tool_use") totalChars += JSON.stringify(b.input ?? {}).length + String(b.name ?? "").length;
          else if (b.type === "tool_result") totalChars += String(b.content ?? "").length;
          else totalChars += JSON.stringify(b).length;
        }
      }
    }
    // Add overhead for role, formatting
    totalChars += 20;
  }

  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

/**
 * Estimate token count for a string.
 */
export function estimateStringTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ── Context Summary ────────────────────────────────────────────────

function createContextSummary(messages: Message[]): string {
  const parts: string[] = [];

  // Extract key information from old messages
  let toolUsesCount = 0;
  let filesRead: Set<string> = new Set();
  let filesEdited: Set<string> = new Set();
  const topics: string[] = [];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      // Extract first line as topic hint
      const firstLine = msg.content.split("\n")[0].trim();
      if (firstLine.length > 10 && firstLine.length < 200) {
        topics.push(`[${msg.role}] ${firstLine.slice(0, 100)}`);
      }
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const b = block as unknown as Record<string, unknown>;
        if (b.type === "tool_use") {
          toolUsesCount++;
          const name = b.name as string;
          const input = b.input as Record<string, unknown> | undefined;
          if (name === "Read" && input?.file_path) filesRead.add(String(input.file_path));
          if (name === "Edit" && input?.file_path) filesEdited.add(String(input.file_path));
          if (name === "Write" && input?.file_path) filesEdited.add(String(input.file_path));
        }
      }
    }
  }

  parts.push(`This conversation had ${messages.length} messages with ${toolUsesCount} tool uses.`);

  if (filesRead.size > 0) {
    const files = [...filesRead].slice(0, 20);
    parts.push(`Files read: ${files.join(", ")}${filesRead.size > 20 ? ` (+${filesRead.size - 20} more)` : ""}`);
  }

  if (filesEdited.size > 0) {
    const files = [...filesEdited].slice(0, 20);
    parts.push(`Files modified: ${files.join(", ")}${filesEdited.size > 20 ? ` (+${filesEdited.size - 20} more)` : ""}`);
  }

  if (topics.length > 0) {
    parts.push("Key exchanges:");
    for (const topic of topics.slice(0, 15)) {
      parts.push(`  - ${topic}`);
    }
    if (topics.length > 15) parts.push(`  ... and ${topics.length - 15} more`);
  }

  return parts.join("\n");
}
