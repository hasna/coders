/**
 * Auto-mode classifier — determine tool permissions automatically
 *
 * When permission mode is "auto", this classifier decides whether to
 * allow, deny, or ask for each tool use based on configurable rules.
 */
import type { PermissionResult } from "../config/permissions.js";

export interface ClassifierRule {
  type: "environment" | "allow" | "deny";
  toolName?: string;
  commandPattern?: string;
  pathPattern?: string;
}

export interface ClassifierConfig {
  environmentRules: ClassifierRule[];
  allowRules: ClassifierRule[];
  denyRules: ClassifierRule[];
}

const DEFAULT_CONFIG: ClassifierConfig = {
  environmentRules: [],
  allowRules: [
    // Read-only tools always allowed
    { type: "allow", toolName: "Read" },
    { type: "allow", toolName: "Glob" },
    { type: "allow", toolName: "Grep" },
    { type: "allow", toolName: "LSP" },
    { type: "allow", toolName: "ToolSearch" },
    { type: "allow", toolName: "TaskGet" },
    { type: "allow", toolName: "TaskList" },
    { type: "allow", toolName: "WebSearch" },
    // Safe bash commands
    { type: "allow", toolName: "Bash", commandPattern: "^(ls|cat|head|tail|grep|find|git (status|diff|log|show))\\b" },
  ],
  denyRules: [
    // Dangerous bash patterns
    { type: "deny", toolName: "Bash", commandPattern: "rm\\s+-rf\\s+/" },
    { type: "deny", toolName: "Bash", commandPattern: "\\bsudo\\b" },
  ],
};

let _config: ClassifierConfig = DEFAULT_CONFIG;
let _enabled = false;
let _circuitBroken = false;

export function isAutoModeEnabled(): boolean { return _enabled; }
export function setAutoModeEnabled(enabled: boolean): void { _enabled = enabled; }
export function isCircuitBroken(): boolean { return _circuitBroken; }
export function setCircuitBroken(broken: boolean): void { _circuitBroken = broken; }

export function getClassifierConfig(): ClassifierConfig { return _config; }
export function setClassifierConfig(config: ClassifierConfig): void { _config = config; }

/**
 * Classify a tool use — returns allow/deny/ask decision.
 */
export function classifyToolUse(
  toolName: string,
  input: Record<string, unknown>,
): PermissionResult {
  if (_circuitBroken) {
    return { behavior: "ask", message: `Auto-mode circuit broken — asking for ${toolName}` };
  }

  // Check deny rules first
  for (const rule of _config.denyRules) {
    if (matchesRule(rule, toolName, input)) {
      return { behavior: "deny", message: `Denied by auto-mode rule` };
    }
  }

  // Check allow rules
  for (const rule of _config.allowRules) {
    if (matchesRule(rule, toolName, input)) {
      return { behavior: "allow" };
    }
  }

  // Default: ask
  return { behavior: "ask", message: `Auto-mode: confirm ${toolName}?` };
}

function matchesRule(rule: ClassifierRule, toolName: string, input: Record<string, unknown>): boolean {
  if (rule.toolName && rule.toolName !== toolName) return false;

  if (rule.commandPattern && toolName === "Bash") {
    const command = String(input.command ?? "");
    if (!new RegExp(rule.commandPattern).test(command)) return false;
  }

  if (rule.pathPattern) {
    const path = String(input.file_path ?? input.path ?? "");
    if (!new RegExp(rule.pathPattern).test(path)) return false;
  }

  return true;
}

// ── Prompt-level classification ─────────────────────────────────────
// Classifies user prompts to determine which tool categories are relevant.
// This lets us send a focused tool set to the API per turn, reducing noise
// and making the model more accurate about which tools to pick.

/** The intent category derived from the user's prompt */
export type PromptIntent =
  | "read-only"     // explain, describe, what is, how does — only search/read tools
  | "search"        // find, search, where is, locate — Glob/Grep/Read/Bash(read)
  | "write"         // create, write, build, implement, add, fix, refactor — all tools
  | "task"          // task management prompts — task tools + read tools
  | "general";      // anything else — all tools (safe default)

export interface PromptClassification {
  intent: PromptIntent;
  /** Tool names that should be enabled for this prompt */
  allowedTools: string[];
  /** Human-readable reason for the classification */
  reason: string;
}

// Tool groups by category
const READ_TOOLS = ["Read", "Glob", "Grep", "LSP", "ToolSearch", "WebSearch", "WebFetch"];
const SEARCH_TOOLS = ["Read", "Glob", "Grep", "Bash", "LSP", "ToolSearch"];
const TASK_TOOLS = ["TaskCreate", "TaskGet", "TaskList", "TaskUpdate", ...READ_TOOLS];
// When allowedTools is empty, all tools pass through (no filtering)

// Patterns for each intent (tested against lowercased, trimmed prompt)
const READ_ONLY_PATTERNS = [
  /^(explain|describe|summarize|what\s+(is|are|does|do)|how\s+(does|do|is|are)|why\s+(does|do|is|are)|tell\s+me\s+about)\b/,
  /^(can\s+you\s+explain|help\s+me\s+understand|what'?s\s+the\s+(difference|purpose|meaning))\b/,
];

const SEARCH_PATTERNS = [
  /^(find|search|where\s+(is|are|do|does)|locate|look\s+for|show\s+me\s+(where|all|the|files))\b/,
  /^(grep|which\s+files?|list\s+(all\s+)?files)\b/,
];

const WRITE_PATTERNS = [
  /^(create|write|build|implement|add|fix|refactor|update|modify|rename|move|delete|remove|edit|change|replace|install|configure|setup|set\s+up|migrate|deploy|commit|push|publish)\b/,
  /\b(please\s+)?(create|write|build|implement|add|fix|refactor|update|modify|edit|change)\b/,
];

const TASK_PATTERNS = [
  /^(create\s+a?\s*task|list\s+tasks?|show\s+tasks?|update\s+task|mark\s+task|what\s+tasks?)\b/,
  /\b(task\s*#?\d+|todo|task\s+list)\b/,
];

/**
 * Classify a user prompt to determine which tools are relevant.
 *
 * Returns an allowedTools list. If the prompt clearly needs only read/search,
 * we restrict the tool set. For write-intent or ambiguous prompts, all tools
 * are returned (the safe default — never block a legitimate tool need).
 */
export function classifyPrompt(prompt: string): PromptClassification {
  const lower = prompt.trim().toLowerCase();

  // Empty or very short prompts — don't filter
  if (lower.length < 3) {
    return { intent: "general", allowedTools: [], reason: "Prompt too short to classify" };
  }

  // Task management intent
  for (const pattern of TASK_PATTERNS) {
    if (pattern.test(lower)) {
      return { intent: "task", allowedTools: TASK_TOOLS, reason: "Task management prompt" };
    }
  }

  // Write/mutate intent — always gets all tools (checked before read-only
  // because "fix this" should get write tools even though it could be "explain the fix")
  for (const pattern of WRITE_PATTERNS) {
    if (pattern.test(lower)) {
      return { intent: "write", allowedTools: [], reason: "Write/mutate intent detected" };
    }
  }

  // Search intent — Glob, Grep, Read, Bash, LSP
  for (const pattern of SEARCH_PATTERNS) {
    if (pattern.test(lower)) {
      return { intent: "search", allowedTools: SEARCH_TOOLS, reason: "Search/find intent detected" };
    }
  }

  // Read-only intent — only search and read tools, no writes
  for (const pattern of READ_ONLY_PATTERNS) {
    if (pattern.test(lower)) {
      return { intent: "read-only", allowedTools: READ_TOOLS, reason: "Read-only/explanatory intent detected" };
    }
  }

  // Default: general — no filtering
  return { intent: "general", allowedTools: [], reason: "No specific intent detected — all tools available" };
}

/**
 * Filter a list of tool handlers based on prompt classification.
 *
 * When allowedTools is empty (write/general intent), returns all handlers
 * unchanged. When allowedTools is set, only matching handlers pass through,
 * plus any MCP tools (which are always included since we can't predict
 * their usage patterns).
 */
export function filterToolsByClassification<T extends { name: string }>(
  handlers: T[],
  classification: PromptClassification,
  builtinToolNames: Set<string>,
): T[] {
  // No filtering for write/general intent
  if (classification.allowedTools.length === 0) {
    return handlers;
  }

  const allowed = new Set(classification.allowedTools);
  return handlers.filter((h) => {
    // Always include MCP tools (not in builtin set)
    if (!builtinToolNames.has(h.name)) return true;
    // Include if in the allowed set
    return allowed.has(h.name);
  });
}
