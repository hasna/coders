/**
 * Permission system — tool access control
 *
 * Mirrors Claude Code's permission model (04-config-permissions.js):
 *   - 6 permission modes
 *   - Per-tool allow/deny rules
 *   - Auto-classifier for "auto" mode
 *   - Tool permission context tracks current mode + pre-plan state
 */
import type { PermissionMode } from "../core/constants.js";
import type { PermissionRule, Settings } from "./settings.js";

// ── Permission check result ────────────────────────────────────────

export type PermissionBehavior = "allow" | "deny" | "ask" | "passthrough";

export interface PermissionResult {
  behavior: PermissionBehavior;
  message?: string;
  updatedInput?: unknown;
  suggestions?: PermissionSuggestion[];
}

export interface PermissionSuggestion {
  type: "addRules";
  rules: PermissionRule[];
  behavior: "allow" | "deny";
  destination: "localSettings" | "userSettings" | "projectSettings";
}

// ── Tool permission context (tracks mode across session) ───────────

export interface ToolPermissionContext {
  mode: PermissionMode;
  prePlanMode?: PermissionMode; // saved when entering plan mode
  allowRules: PermissionRule[];
  denyRules: PermissionRule[];
}

export function createDefaultPermissionContext(settings?: Settings): ToolPermissionContext {
  const defaultMode = settings?.permissions?.defaultMode ?? "default";
  return {
    mode: defaultMode as PermissionMode,
    allowRules: settings?.permissions?.allow ?? [],
    denyRules: settings?.permissions?.deny ?? [],
  };
}

// ── Permission checking ────────────────────────────────────────────

export function checkToolPermission(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolPermissionContext,
): PermissionResult {
  // Bypass mode — allow everything
  if (context.mode === "bypassPermissions") {
    return { behavior: "allow" };
  }

  // Check explicit deny rules first
  for (const rule of context.denyRules) {
    if (matchesRule(rule, toolName, input)) {
      return { behavior: "deny", message: `Denied by rule: ${describeRule(rule)}` };
    }
  }

  // Check explicit allow rules
  for (const rule of context.allowRules) {
    if (matchesRule(rule, toolName, input)) {
      return { behavior: "allow" };
    }
  }

  // Mode-specific behavior
  switch (context.mode) {
    case "plan":
      // Plan mode: only read-only tools allowed
      return { behavior: "passthrough" }; // let tool's own isReadOnly() decide

    case "acceptEdits":
      // Auto-approve file edits, ask for bash
      if (isFileEditTool(toolName)) return { behavior: "allow" };
      return { behavior: "passthrough" };

    case "dontAsk":
      // Auto-approve reads
      if (isReadOnlyTool(toolName)) return { behavior: "allow" };
      return { behavior: "passthrough" };

    case "auto":
      // Classifier-based — passthrough to the auto-classifier
      return { behavior: "passthrough" };

    case "default":
    default:
      return { behavior: "passthrough" };
  }
}

// ── Mode transitions ───────────────────────────────────────────────

export function enterPlanMode(context: ToolPermissionContext): ToolPermissionContext {
  return {
    ...context,
    prePlanMode: context.mode,
    mode: "plan",
  };
}

export function exitPlanMode(context: ToolPermissionContext): ToolPermissionContext {
  const restoredMode = context.prePlanMode ?? "default";
  return {
    ...context,
    mode: restoredMode,
    prePlanMode: undefined,
  };
}

// ── Rule matching ──────────────────────────────────────────────────

function matchesRule(
  rule: PermissionRule,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  // Match by tool name
  if (rule.toolName && rule.toolName !== toolName) return false;

  // Match by command (for Bash tool)
  if (rule.command && toolName === "Bash") {
    const command = input.command as string | undefined;
    if (!command) return false;
    // Match command as a word boundary — prevents "rm" matching "firmware"
    const escapedCmd = rule.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`(^|\\s|/|;|&&|\\|\\|)${escapedCmd}(\\s|$)`).test(command)) return false;
  }

  // Match by path (for file tools)
  if (rule.path) {
    const filePath = (input.file_path ?? input.path ?? input.filePath) as string | undefined;
    if (!filePath) return false;
    if (!matchesPathPattern(filePath, rule.path)) return false;
  }

  return true;
}

function matchesPathPattern(filePath: string, pattern: string): boolean {
  // Simple glob-like matching
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return filePath.startsWith(prefix);
  }
  if (pattern.includes("*")) {
    // Escape regex metacharacters except *, then convert * to .*
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const regex = new RegExp("^" + escaped + "$");
    return regex.test(filePath);
  }
  return filePath === pattern || filePath.startsWith(pattern + "/");
}

function describeRule(rule: PermissionRule): string {
  const parts: string[] = [];
  if (rule.toolName) parts.push(`tool=${rule.toolName}`);
  if (rule.command) parts.push(`command=${rule.command}`);
  if (rule.path) parts.push(`path=${rule.path}`);
  return parts.join(", ") || "unnamed rule";
}

// ── Tool classification helpers ────────────────────────────────────

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "LSP", "ToolSearch", "TaskGet", "TaskList"]);
const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

function isFileEditTool(name: string): boolean {
  return FILE_EDIT_TOOLS.has(name);
}
