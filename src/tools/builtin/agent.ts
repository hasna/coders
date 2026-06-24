/**
 * Agent tool — spawn sub-agent instances for complex tasks
 *
 * Features (matching Claude Code's 15-tools-agent.js):
 *   - Spawn sub-agents with their own tool sets
 *   - Agent types: general-purpose, Explore, Plan, verification
 *   - Model override per agent
 *   - Run in background with notifications
 *   - Worktree isolation mode
 *   - Progress tracking (token counting)
 *   - Continue existing agents via SendMessage
 */
import { z } from "zod";
import type { Tool, ToolCallResult } from "../interface.js";
import { AGENT_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";
import { runAgentLoop, type ToolHandler } from "../../core/agent-loop.js";
import { getApiClient } from "../../api/client.js";
import {
  createTask as createBgTask,
  completeTask as completeBgTask,
  failTask as failBgTask,
  updateTask as updateBgTask,
} from "../../core/background-tasks.js";
import { DEFAULT_TEXT_LIMIT, compactLongText } from "../../utils/output.js";

// ── Agent types and their available tools ──────────────────────────

export interface AgentTypeDefinition {
  name: string;
  description: string;
  allowedTools: string[] | "all";
  excludedTools?: string[];
  defaultModel?: string;
}

export const BUILTIN_AGENT_TYPES: Record<string, AgentTypeDefinition> = {
  "general-purpose": {
    name: "general-purpose",
    description: "General-purpose agent with access to all tools. Use for complex, multi-step tasks.",
    allowedTools: "all",
  },
  Explore: {
    name: "Explore",
    description: "Fast agent for exploring codebases. Read-only tools only (Read, Glob, Grep, LSP).",
    allowedTools: ["Read", "Glob", "Grep", "LSP", "Bash", "ToolSearch"],
    excludedTools: ["Agent", "Edit", "Write", "NotebookEdit", "EnterPlanMode", "ExitPlanMode"],
  },
  Plan: {
    name: "Plan",
    description: "Software architect agent for designing plans. Read-only tools plus planning tools.",
    allowedTools: ["Read", "Glob", "Grep", "LSP", "Bash", "ToolSearch", "WebFetch", "WebSearch"],
    excludedTools: ["Agent", "Edit", "Write", "NotebookEdit"],
  },
  verification: {
    name: "verification",
    description: "QA verification agent. Can read, search, and run tests but not edit files.",
    allowedTools: ["Read", "Glob", "Grep", "LSP", "Bash", "ToolSearch"],
    excludedTools: ["Agent", "Edit", "Write", "NotebookEdit"],
  },
};

// ── Schemas ────────────────────────────────────────────────────────

const AgentInputSchema = z.strictObject({
  prompt: z.string().describe("The task for the agent to perform"),
  description: z.string().optional().describe("A short (3-5 word) description of the task"),
  subagent_type: z.string().optional().describe("Agent type: general-purpose, Explore, Plan, verification, or custom agent name"),
  model: z.enum(["sonnet", "opus", "haiku"]).optional().describe("Model override for this agent"),
  run_in_background: z.boolean().optional().describe("Run agent in background, get notified on completion"),
  isolation: z.enum(["worktree"]).optional().describe("Isolation mode. 'worktree' creates a temporary git worktree."),
});

type AgentInput = z.infer<typeof AgentInputSchema>;

interface AgentOutput {
  result: string;
  agentId: string;
  agentType: string;
  model: string;
  totalTurns: number;
  usage: { inputTokens: number; outputTokens: number };
  backgrounded?: boolean;
}

const AgentOutputSchema = z.object({
  result: z.string(),
  agentId: z.string(),
  agentType: z.string(),
  model: z.string(),
  totalTurns: z.number(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  backgrounded: z.boolean().optional(),
});

// ── Running agents tracking ────────────────────────────────────────

let nextAgentId = 1;

interface RunningAgent {
  id: string;
  type: string;
  prompt: string;
  status: "running" | "completed" | "failed";
  result?: string;
  error?: string;
  abort?: AbortController;
}

const runningAgents = new Map<string, RunningAgent>();

export function getRunningAgent(id: string): RunningAgent | undefined {
  return runningAgents.get(id);
}

export function getAllRunningAgents(): RunningAgent[] {
  return [...runningAgents.values()];
}

// ── Agent Tool ─────────────────────────────────────────────────────

export const agentTool: Tool<AgentInput, AgentOutput> = {
  name: AGENT_TOOL,
  searchHint: "launch a sub-agent to handle complex multi-step tasks autonomously",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: false,

  async description(input) {
    const desc = input?.description ?? "complex task";
    return `Launch agent for: ${desc}`;
  },

  async prompt() {
    return AGENT_PROMPT;
  },

  get inputSchema() { return AgentInputSchema; },
  get outputSchema() { return AgentOutputSchema; },

  userFacingName() { return "Agent"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return false; },

  toAutoClassifierInput(input) {
    return `${input.subagent_type ?? "general-purpose"}: ${input.prompt.slice(0, 100)}`;
  },

  getActivityDescription(input) {
    return input.description ?? "Running sub-agent";
  },

  async validateInput(input) {
    if (!input.prompt || !input.prompt.trim()) {
      return { result: false, message: "prompt is required", errorCode: 1 };
    }
    return { result: true };
  },

  async checkPermissions(input) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, context): Promise<ToolCallResult<AgentOutput>> {
    const agentId = `agent-${nextAgentId++}`;
    const agentType = input.subagent_type ?? "general-purpose";
    const typeDef = BUILTIN_AGENT_TYPES[agentType] ?? BUILTIN_AGENT_TYPES["general-purpose"];
    const model = input.model ?? "sonnet";

    // Track agent
    const agentRecord: RunningAgent = {
      id: agentId,
      type: agentType,
      prompt: input.prompt,
      status: "running",
    };
    runningAgents.set(agentId, agentRecord);

    // Filter tools based on agent type
    const availableTools = filterToolsForAgentType(
      context.options.tools ?? [],
      typeDef,
    );

    // Create git worktree for isolation if requested
    let worktreePath: string | null = null;
    let worktreeBranch: string | null = null;
    if (input.isolation === "worktree") {
      try {
        const { execSync } = require("child_process");
        worktreeBranch = `agent-${agentId.slice(0, 8)}`;
        worktreePath = `/tmp/coders-worktree-${agentId.slice(0, 12)}`;
        execSync(`git worktree add -b ${worktreeBranch} ${worktreePath}`, { stdio: "pipe", timeout: 10000 });
        // Change cwd for this agent's execution
        process.chdir(worktreePath);
      } catch (e) {
        // Worktree creation failed — continue without isolation
        worktreePath = null;
        worktreeBranch = null;
      }
    }

    // Build agent-specific tool handlers
    const toolHandlers: ToolHandler[] = await Promise.all(availableTools
      .filter((t) => t.name !== AGENT_TOOL) // agents can't spawn more agents (prevent infinite recursion)
      .map(async (t) => {
        // Extract the real JSON schema from the Zod input schema
        let schemaObj: Record<string, unknown> = { type: "object", properties: {} };
        try {
          if (t.inputSchema && typeof (t.inputSchema as any).shape === "object") {
            // Convert Zod shape to JSON Schema properties
            const shape = (t.inputSchema as any).shape;
            const properties: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(shape)) {
              properties[key] = { type: "string", description: (val as any)?._def?.description ?? key };
            }
            schemaObj = { type: "object", properties };
          }
        } catch { /* fallback to empty schema */ }
        return {
          name: t.name,
          description: typeof t.description === "function" ? await t.description() : String(t.description),
          inputSchema: schemaObj as { type: "object"; properties: Record<string, unknown> },
          isReadOnly: t.isReadOnly(),
          isConcurrencySafe: t.isConcurrencySafe(),
          call: async (toolInput: Record<string, unknown>, _toolCtx: any) => {
            const result = await t.call(toolInput, context);
            return { data: result.data };
          },
        };
      }));

    // Build system prompt for sub-agent
    const systemPrompt = buildSubAgentSystemPrompt(agentType, typeDef);

    if (input.run_in_background) {
      // Register with the background task manager
      const bgTask = createBgTask("agent", input.prompt.slice(0, 100));

      // Background execution
      runAgentInBackground(agentId, bgTask.id, agentRecord, input, toolHandlers, systemPrompt, model, context);

      return {
        data: {
          result: `Agent ${agentId} (${agentType}) started in background. Task ID: ${bgTask.id}. Use TaskOutput to check its status.`,
          agentId,
          agentType,
          model,
          totalTurns: 0,
          usage: { inputTokens: 0, outputTokens: 0 },
          backgrounded: true,
        },
      };
    }

    // Foreground execution
    try {
      const loopResult = await runAgentLoop(
        [{ role: "user", content: input.prompt }],
        {
          client: getApiClient(),
          systemPrompt,
          tools: toolHandlers,
          model,
          thinkingConfig: { type: "disabled" },
          signal: context.abortController.signal,
          permissionContext: context.getAppState().toolPermissionContext,
          agentId,
          maxTurns: 25,
        },
      );

      // Extract final text from last assistant message
      const lastAssistant = [...loopResult.messages].reverse().find((m) => m.role === "assistant");
      const resultText = extractText(lastAssistant);

      agentRecord.status = "completed";
      agentRecord.result = resultText;
      setTimeout(() => runningAgents.delete(agentId), 5 * 60 * 1000);

      // Cleanup worktree if used
      if (worktreePath) {
        try {
          const { execSync } = require("child_process");
          process.chdir(context.options?.projectDir ?? process.env.HOME ?? "/");
          execSync(`git worktree remove ${worktreePath} --force`, { stdio: "pipe", timeout: 10000 });
          if (worktreeBranch) execSync(`git branch -D ${worktreeBranch}`, { stdio: "pipe", timeout: 5000 });
        } catch { /* best effort cleanup */ }
      }

      return {
        data: {
          result: resultText + (worktreePath ? `\n[Ran in isolated worktree: ${worktreeBranch}]` : ""),
          agentId,
          agentType,
          model,
          totalTurns: loopResult.totalTurns,
          usage: {
            inputTokens: loopResult.usage.totalInputTokens,
            outputTokens: loopResult.usage.totalOutputTokens,
          },
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      agentRecord.status = "failed";
      agentRecord.error = errorMsg;

      return {
        data: {
          result: `Agent failed: ${errorMsg}`,
          agentId,
          agentType,
          model,
          totalTurns: 0,
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      };
    }
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    let content = result.result;
    if (result.backgrounded) {
      content = `Agent ${result.agentId} started in background (${result.agentType}). You will be notified when it completes.`;
    }
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: compactLongText(content, DEFAULT_TEXT_LIMIT * 3, "Run the agent in background and use TaskOutput limit for larger transcripts."),
    };
  },
};

// ── Helpers ────────────────────────────────────────────────────────

function filterToolsForAgentType(tools: Tool[], typeDef: AgentTypeDefinition): Tool[] {
  if (typeDef.allowedTools === "all") {
    const excluded = new Set(typeDef.excludedTools ?? []);
    return tools.filter((t) => !excluded.has(t.name));
  }

  const allowed = new Set(typeDef.allowedTools);
  const excluded = new Set(typeDef.excludedTools ?? []);
  return tools.filter((t) => allowed.has(t.name) && !excluded.has(t.name));
}

function buildSubAgentSystemPrompt(_agentType: string, typeDef: AgentTypeDefinition): string {
  return `You are a ${typeDef.description}

You are a sub-agent spawned to handle a specific task. Complete the task thoroughly and return your findings/results.

Guidelines:
- Focus on the task given to you
- Use the tools available to you efficiently
- Return a clear, concise result
- If you cannot complete the task, explain why`;
}

function extractText(message: { role: string; content: string | unknown[] } | undefined): string {
  if (!message) return "(no response)";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }
  return "(no text content)";
}

function runAgentInBackground(
  agentId: string,
  bgTaskId: string,
  record: RunningAgent,
  input: AgentInput,
  tools: ToolHandler[],
  systemPrompt: string,
  model: string,
  parentContext: any,
): void {
  const abortController = new AbortController();
  record.abort = abortController;

  runAgentLoop(
    [{ role: "user", content: input.prompt }],
    {
      client: getApiClient(),
      systemPrompt,
      tools,
      model,
      thinkingConfig: { type: "disabled" },
      signal: abortController.signal,
      permissionContext: parentContext.getAppState().toolPermissionContext,
      agentId,
      maxTurns: 25,
      onTextDelta: (_text) => {
        updateBgTask(bgTaskId, {
          progress: { lastActivity: new Date().toISOString() },
        });
      },
      onToolUseStart: (toolName: string, _toolUseId: string, toolInput: Record<string, unknown>) => {
        // Surface sub-agent tool activity to parent UI via background task description
        const summary = toolInput.command ? String(toolInput.command).slice(0, 60)
          : toolInput.file_path ? String(toolInput.file_path)
          : toolInput.pattern ? `/${toolInput.pattern}/`
          : "";
        updateBgTask(bgTaskId, {
          description: `${toolName}${summary ? ` ${summary}` : ""}`,
          progress: { lastActivity: new Date().toISOString() },
        });
      },
    },
  ).then((result) => {
    const lastAssistant = [...result.messages].reverse().find((m) => m.role === "assistant");
    const resultText = extractText(lastAssistant);
    record.status = "completed";
    record.result = resultText;

    // Update background task manager
    const totalTokens = result.usage.totalInputTokens + result.usage.totalOutputTokens;
    updateBgTask(bgTaskId, {
      progress: {
        tokenCount: totalTokens,
        lastActivity: new Date().toISOString(),
      },
    });
    completeBgTask(bgTaskId, resultText);
    // Clean up after 5 minutes to prevent memory leak
    setTimeout(() => runningAgents.delete(agentId), 5 * 60 * 1000);
  }).catch((error) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    record.status = "failed";
    record.error = errorMsg;

    // Update background task manager
    failBgTask(bgTaskId, errorMsg);
    // Clean up after 5 minutes
    setTimeout(() => runningAgents.delete(agentId), 5 * 60 * 1000);
  });
}

// ── Prompt ─────────────────────────────────────────────────────────

const AGENT_PROMPT = `Launch a new agent to handle complex, multi-step tasks autonomously.

Available agent types:
- general-purpose: Full access to all tools. Use for complex tasks.
- Explore: Read-only tools for codebase exploration. Fast and safe.
- Plan: Software architect agent for designing implementation plans.
- verification: QA agent for testing and verification.

Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do
- Launch multiple agents concurrently when possible for performance
- Use run_in_background for long-running tasks
- Provide clear, detailed prompts so the agent can work autonomously
- Use isolation: "worktree" for agents that modify files in parallel`;
