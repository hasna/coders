/**
 * Tool permission checking — bridges config/permissions with tool interface
 *
 * This module connects the permission system (config/permissions.ts) with
 * the tool interface, providing the standard permission check flow:
 *   1. Check tool's own checkPermissions() method
 *   2. Check global permission rules (allow/deny)
 *   3. Apply permission mode logic
 */
import {
  checkToolPermission,
  type PermissionResult,
  type ToolPermissionContext,
} from "../config/permissions.js";
import type { Tool, ToolContext } from "./interface.js";

/**
 * Full permission check for a tool use.
 * Combines tool-specific checks with global rules.
 */
export async function checkPermissions(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<PermissionResult> {
  const permContext = context.getAppState().toolPermissionContext;

  // 1. Check global permission rules first (deny rules take priority)
  const globalResult = checkToolPermission(tool.name, input, permContext);

  if (globalResult.behavior === "deny") {
    return globalResult;
  }

  if (globalResult.behavior === "allow") {
    return { behavior: "allow", updatedInput: input };
  }

  // 2. Plan mode: only read-only tools allowed
  if (permContext.mode === "plan" && !tool.isReadOnly()) {
    return {
      behavior: "deny",
      message: `Tool "${tool.name}" is not available in plan mode (read-only tools only).`,
    };
  }

  // 3. Check tool's own permission logic
  const toolResult = await tool.checkPermissions(input, context);

  // Tool can override to allow/deny/ask
  if (toolResult.behavior !== "passthrough") {
    return toolResult;
  }

  // 4. Default behavior based on mode
  return getDefaultPermissionBehavior(tool, permContext);
}

/**
 * Get default permission behavior when no rules match.
 */
function getDefaultPermissionBehavior(
  tool: Tool,
  context: ToolPermissionContext,
): PermissionResult {
  switch (context.mode) {
    case "bypassPermissions":
      return { behavior: "allow" };

    case "dontAsk":
      // Auto-approve everything (user chose to not be asked)
      return { behavior: "allow" };

    case "acceptEdits":
      // Auto-approve edits and reads, ask for bash/agent
      if (tool.isReadOnly()) return { behavior: "allow" };
      if (isFileEditTool(tool.name)) return { behavior: "allow" };
      return { behavior: "ask", message: `Allow ${tool.name}?` };

    case "auto":
      // Classifier-based — ask by default (classifier overrides in the loop)
      return { behavior: "ask", message: `Allow ${tool.name}?` };

    case "plan":
      // Should have been caught above, but safety net
      if (tool.isReadOnly()) return { behavior: "allow" };
      return { behavior: "deny", message: "Not available in plan mode" };

    case "default":
    default:
      // Ask for everything except read-only tools
      if (tool.isReadOnly()) return { behavior: "allow" };
      return { behavior: "ask", message: `Allow ${tool.name}?` };
  }
}

/**
 * Check if a tool is allowed in the current mode without prompting.
 * Used by the speculation engine to pre-execute likely tools.
 */
export function isToolAutoAllowed(
  tool: Tool,
  context: ToolPermissionContext,
): boolean {
  if (context.mode === "bypassPermissions") return true;
  if (context.mode === "dontAsk") return true;

  if (tool.isReadOnly()) return true;

  if (context.mode === "acceptEdits" && isFileEditTool(tool.name)) return true;

  return false;
}

/**
 * Check if a tool name corresponds to a file edit tool.
 */
function isFileEditTool(name: string): boolean {
  return name === "Edit" || name === "Write" || name === "NotebookEdit";
}

/**
 * Get a human-readable description of why a tool was denied.
 */
export function getPermissionDeniedReason(
  toolName: string,
  mode: string,
): string {
  switch (mode) {
    case "plan":
      return `"${toolName}" is not available in plan mode. Only read-only tools (Read, Glob, Grep, LSP) can be used while planning.`;
    default:
      return `"${toolName}" was denied by permission rules.`;
  }
}
