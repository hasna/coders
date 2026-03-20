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
