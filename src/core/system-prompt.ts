/**
 * Dynamic system prompt builder
 *
 * Builds the system prompt from multiple sources:
 *   1. Core agent instructions
 *   2. CODERS.md / CLAUDE.md project instructions
 *   3. Tool-specific prompts (from each tool.prompt())
 *   4. Permission context (current mode, restrictions)
 *   5. Session context (project dir, git branch, active tasks)
 *   6. Team context (if in a team)
 *
 * Uses ephemeral cache blocks for long-lived sections.
 */
import { buildInstructionsPrompt } from "../memory/files.js";
import type { ToolPermissionContext } from "../config/permissions.js";
import type { Tool } from "../tools/interface.js";

// ── Types ──────────────────────────────────────────────────────────

export interface SystemPromptContext {
  projectDir: string;
  model: string;
  permissionMode: string;
  tools: Array<{ name: string; prompt: string }>;
  gitBranch?: string;
  teamName?: string;
  agentName?: string;
  activeTasks?: Array<{ id: string; subject: string; status: string }>;
  customInstructions?: string;
}

export interface SystemPromptBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

// ── Core Instructions ──────────────────────────────────────────────

const CORE_INSTRUCTIONS = `You are an expert coding assistant. You help users with software engineering tasks by reading, writing, and editing code, running commands, and searching codebases.

# Tools
You have access to tools for interacting with the user's codebase and system. Use them proactively:
- **Read**: Read files to understand code before modifying it
- **Edit**: Make precise string replacements in files. Always Read first.
- **Write**: Create new files. Prefer Edit for existing files.
- **Glob**: Find files by name pattern
- **Grep**: Search file contents with regex
- **Bash**: Run shell commands for builds, tests, git, etc.

# Guidelines
- Read files before editing them
- Use Glob/Grep to find relevant files before making changes
- Run tests after making changes
- Keep changes minimal and focused
- Preserve existing code style and conventions
- Never introduce security vulnerabilities`;

// ── Builder ────────────────────────────────────────────────────────

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const sections: string[] = [];

  // 1. Core instructions
  sections.push(CORE_INSTRUCTIONS);

  // 2. Project instructions (CODERS.md / CLAUDE.md)
  const projectInstructions = buildInstructionsPrompt(ctx.projectDir);
  if (projectInstructions) {
    sections.push(`\n# Project Instructions\n\n${projectInstructions}`);
  }

  // 3. Permission mode context
  if (ctx.permissionMode === "plan") {
    sections.push(`\n# Mode: Plan
You are in PLAN MODE. You may only use read-only tools (Read, Glob, Grep, LSP).
Do NOT write, edit, or create files. Focus on exploring and designing.
Use ExitPlanMode when your plan is ready for approval.`);
  }

  // 4. Tool descriptions
  if (ctx.tools.length > 0) {
    const toolSection = ctx.tools
      .filter((t) => t.prompt)
      .map((t) => `## ${t.name}\n${t.prompt}`)
      .join("\n\n");
    if (toolSection) {
      sections.push(`\n# Available Tools\n\n${toolSection}`);
    }
  }

  // 5. Session context
  const ctxParts: string[] = [];
  ctxParts.push(`Working directory: ${ctx.projectDir}`);
  ctxParts.push(`Model: ${ctx.model}`);
  if (ctx.gitBranch) ctxParts.push(`Git branch: ${ctx.gitBranch}`);
  if (ctx.teamName) ctxParts.push(`Team: ${ctx.teamName}`);
  if (ctx.agentName) ctxParts.push(`Agent: ${ctx.agentName}`);
  sections.push(`\n# Session\n${ctxParts.join("\n")}`);

  // 6. Active tasks
  if (ctx.activeTasks && ctx.activeTasks.length > 0) {
    const taskList = ctx.activeTasks
      .map((t) => `- [${t.status}] #${t.id}: ${t.subject}`)
      .join("\n");
    sections.push(`\n# Active Tasks\n${taskList}`);
  }

  // 7. Custom instructions (from settings)
  if (ctx.customInstructions) {
    sections.push(`\n# Custom Instructions\n${ctx.customInstructions}`);
  }

  return sections.join("\n");
}

/**
 * Build system prompt as content blocks with cache hints.
 * Long-lived sections (core instructions, project instructions) get
 * ephemeral cache_control for Anthropic API prompt caching.
 */
export function buildSystemPromptBlocks(ctx: SystemPromptContext): SystemPromptBlock[] {
  const blocks: SystemPromptBlock[] = [];

  // Core instructions (cached — rarely changes)
  blocks.push({
    type: "text",
    text: CORE_INSTRUCTIONS,
    cache_control: { type: "ephemeral" },
  });

  // Project instructions (cached — changes on file edit)
  const projectInstructions = buildInstructionsPrompt(ctx.projectDir);
  if (projectInstructions) {
    blocks.push({
      type: "text",
      text: `# Project Instructions\n\n${projectInstructions}`,
      cache_control: { type: "ephemeral" },
    });
  }

  // Dynamic context (NOT cached — changes every turn)
  const dynamic = buildDynamicContext(ctx);
  if (dynamic) {
    blocks.push({ type: "text", text: dynamic });
  }

  return blocks;
}

function buildDynamicContext(ctx: SystemPromptContext): string {
  const parts: string[] = [];

  if (ctx.permissionMode === "plan") {
    parts.push("MODE: Plan (read-only). Use ExitPlanMode when ready.");
  }

  parts.push(`CWD: ${ctx.projectDir} | Model: ${ctx.model}`);

  if (ctx.gitBranch) parts.push(`Branch: ${ctx.gitBranch}`);
  if (ctx.teamName && ctx.agentName) parts.push(`Team: ${ctx.teamName} | Agent: ${ctx.agentName}`);

  if (ctx.activeTasks && ctx.activeTasks.length > 0) {
    parts.push("Tasks: " + ctx.activeTasks.map((t) => `#${t.id}[${t.status}]`).join(", "));
  }

  return parts.join("\n");
}

// ── Cache ──────────────────────────────────────────────────────────

let _cachedPrompt: string | null = null;
let _cacheKey: string | null = null;

export function getCachedSystemPrompt(ctx: SystemPromptContext): string {
  const key = `${ctx.projectDir}:${ctx.model}:${ctx.permissionMode}:${ctx.tools.length}`;
  if (_cacheKey === key && _cachedPrompt) return _cachedPrompt;
  _cachedPrompt = buildSystemPrompt(ctx);
  _cacheKey = key;
  return _cachedPrompt;
}

export function invalidateSystemPromptCache(): void {
  _cachedPrompt = null;
  _cacheKey = null;
}
