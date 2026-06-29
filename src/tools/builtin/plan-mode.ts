/**
 * Plan mode tools — EnterPlanMode and ExitPlanMode
 *
 * EnterPlanMode: switches to read-only plan mode for exploration/design
 * ExitPlanMode: reads plan from file, presents for user approval, restores mode
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import type { Tool, ToolCallResult } from "../interface.js";
import { enterPlanMode, exitPlanMode } from "../../config/permissions.js";
import { ENTER_PLAN_MODE_TOOL, EXIT_PLAN_MODE_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";
import { getPlansDir } from "../../config/paths.js";

// ── Plan file helpers ──────────────────────────────────────────────

function getPlanFilePath(agentId?: string): string {
  const dir = getPlansDir();
  const name = agentId ? `plan-${agentId}.md` : "plan.md";
  return join(dir, name);
}

function readPlanFile(agentId?: string): string | null {
  const path = getPlanFilePath(agentId);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

// ── Track plan mode state ──────────────────────────────────────────

let _hasExitedPlanMode = false;
export function hasExitedPlanMode(): boolean { return _hasExitedPlanMode; }

// ── EnterPlanMode ──────────────────────────────────────────────────

const EnterPlanInputSchema = z.strictObject({});
const EnterPlanOutputSchema = z.object({ message: z.string() });

export const enterPlanModeTool: Tool<Record<string, never>, { message: string }> = {
  name: ENTER_PLAN_MODE_TOOL,
  searchHint: "switch to plan mode to design an approach before coding",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description() { return "Enter plan mode for exploration and design"; },
  async prompt() { return ENTER_PLAN_PROMPT; },

  get inputSchema() { return EnterPlanInputSchema; },
  get outputSchema() { return EnterPlanOutputSchema; },

  userFacingName() { return ""; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },
  toAutoClassifierInput() { return ""; },

  async checkPermissions(input) {
    return { behavior: "allow", updatedInput: input };
  },

  async validateInput() { return { result: true }; },

  async call(_input, context): Promise<ToolCallResult<{ message: string }>> {
    if (context.agentId) {
      throw new Error("EnterPlanMode cannot be used in agent contexts");
    }

    context.setAppState((state) => ({
      ...state,
      toolPermissionContext: enterPlanMode(state.toolPermissionContext),
    }));

    return {
      data: {
        message: "Entered plan mode. Focus on exploring the codebase and designing an implementation approach.",
      },
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `${result.message}

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Use AskUserQuestion if you need to clarify approaches
5. Design a concrete implementation strategy
6. When ready, use ExitPlanMode to present your plan for approval

Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.`,
    };
  },
};

// ── ExitPlanMode ───────────────────────────────────────────────────

const ExitPlanInputSchema = z.strictObject({}).passthrough();

interface ExitPlanOutput {
  plan: string | null;
  isAgent: boolean;
  filePath?: string;
  hasTaskTool?: boolean;
}

const ExitPlanOutputSchema = z.object({
  plan: z.string().nullable(),
  isAgent: z.boolean(),
  filePath: z.string().optional(),
  hasTaskTool: z.boolean().optional(),
});

export const exitPlanModeTool: Tool<Record<string, never>, ExitPlanOutput> = {
  name: EXIT_PLAN_MODE_TOOL,
  searchHint: "present plan for approval and start coding (plan mode only)",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description() { return "Exit plan mode — present plan for user approval"; },
  async prompt() { return EXIT_PLAN_PROMPT; },

  get inputSchema() { return ExitPlanInputSchema; },
  get outputSchema() { return ExitPlanOutputSchema; },

  userFacingName() { return ""; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return false; },
  toAutoClassifierInput() { return ""; },

  requiresUserInteraction() { return true; },

  async validateInput(_input, context) {
    const mode = context?.getAppState?.()?.toolPermissionContext?.mode;
    if (mode !== "plan") {
      return {
        result: false,
        message: "You are not in plan mode. This tool is only for exiting plan mode after writing a plan.",
        errorCode: 1,
      };
    }
    return { result: true };
  },

  async checkPermissions(input) {
    return { behavior: "ask", message: "Exit plan mode?", updatedInput: input };
  },

  async call(_input, context): Promise<ToolCallResult<ExitPlanOutput>> {
    const isAgent = !!context.agentId;
    const plan = readPlanFile(context.agentId);
    const filePath = getPlanFilePath(context.agentId);

    // Restore pre-plan mode
    context.setAppState((state) => ({
      ...state,
      toolPermissionContext: exitPlanMode(state.toolPermissionContext),
    }));

    _hasExitedPlanMode = true;

    const hasTaskTool = context.options.tools?.some(
      (t) => t.name === "Agent",
    );

    return {
      data: { plan, isAgent, filePath, hasTaskTool },
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    if (result.isAgent) {
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: 'User has approved the plan. There is nothing else needed from you now. Please respond with "ok"',
      };
    }

    if (!result.plan || result.plan.trim() === "") {
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "Exited plan mode. You can now write code and use all tools.",
      };
    }

    const taskHint = result.hasTaskTool
      ? "\n\nIf this plan can be broken down into multiple independent tasks, consider using the Agent tool to parallelize the work."
      : "";

    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `User has approved your plan. You can now start coding.

Your plan has been saved to: ${result.filePath}
You can refer back to it if needed during implementation.${taskHint}

## Approved Plan:
${result.plan}`,
    };
  },
};

// ── Prompts ────────────────────────────────────────────────────────

const ENTER_PLAN_PROMPT = `Use this tool proactively when you're about to start a non-trivial implementation task.
Getting user sign-off on your approach before writing code prevents wasted effort.

Use EnterPlanMode for: new features, multiple valid approaches, code modifications,
architectural decisions, multi-file changes, unclear requirements.

Skip for: single-line fixes, trivial changes, specific detailed instructions, pure research.`;

const EXIT_PLAN_PROMPT = `Use this tool when you are in plan mode and have finished writing your plan.
This tool reads the plan from the plan file and presents it for user approval.
Only use when the task requires planning implementation steps that require writing code.`;
