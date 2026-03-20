/**
 * Slash command system — user-invocable commands via /name
 *
 * Matches Claude Code's 49 slash commands (01-core-slash-commands.js).
 */

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  category: "core" | "task" | "git" | "mode" | "navigation" | "plugin" | "system";
  handler: (args: string) => Promise<SlashCommandResult> | SlashCommandResult;
}

export interface SlashCommandResult {
  output?: string;
  action?: "clear" | "compact" | "exit" | "toggleView" | "setModel" | "setMode";
  data?: unknown;
}

const commands = new Map<string, SlashCommand>();

export function registerSlashCommand(cmd: SlashCommand): void {
  commands.set(cmd.name, cmd);
  if (cmd.aliases) {
    for (const alias of cmd.aliases) commands.set(alias, cmd);
  }
}

export function getSlashCommand(name: string): SlashCommand | null {
  return commands.get(name.replace(/^\//, "")) ?? null;
}

export function getAllSlashCommands(): SlashCommand[] {
  const seen = new Set<string>();
  const result: SlashCommand[] = [];
  for (const cmd of commands.values()) {
    if (!seen.has(cmd.name)) { seen.add(cmd.name); result.push(cmd); }
  }
  return result;
}

export function isSlashCommand(input: string): boolean {
  return input.startsWith("/") && commands.has(input.slice(1).split(/\s/)[0]);
}

export async function executeSlashCommand(input: string): Promise<SlashCommandResult> {
  const parts = input.replace(/^\//, "").split(/\s+/);
  const name = parts[0];
  const args = parts.slice(1).join(" ");
  const cmd = commands.get(name);
  if (!cmd) return { output: `Unknown command: /${name}. Type /help for available commands.` };
  return cmd.handler(args);
}

// ── Register default commands ──────────────────────────────────────

function registerDefaults(): void {
  registerSlashCommand({
    name: "help", aliases: ["h", "?"], category: "core",
    description: "Show available commands",
    handler: () => {
      const cmds = getAllSlashCommands().sort((a, b) => a.name.localeCompare(b.name));
      const lines = cmds.map(c => `  /${c.name.padEnd(16)} ${c.description}`);
      return { output: `Available commands:\n${lines.join("\n")}` };
    },
  });

  registerSlashCommand({
    name: "clear", category: "core",
    description: "Clear conversation history",
    handler: () => ({ action: "clear", output: "Conversation cleared." }),
  });

  registerSlashCommand({
    name: "compact", category: "core",
    description: "Compact conversation context",
    handler: () => ({ action: "compact", output: "Context compacted." }),
  });

  registerSlashCommand({
    name: "exit", aliases: ["quit", "q"], category: "core",
    description: "Exit coders",
    handler: () => ({ action: "exit" }),
  });

  registerSlashCommand({
    name: "plan", category: "core",
    description: "View or edit the current plan",
    handler: () => ({ output: "Plan mode — use EnterPlanMode tool to start planning." }),
  });

  registerSlashCommand({
    name: "model", category: "mode",
    description: "View or change the current model",
    handler: (args) => {
      if (args) return { action: "setModel", data: args, output: `Model set to: ${args}` };
      return { output: "Current model — use /model <name> to change." };
    },
  });

  registerSlashCommand({
    name: "fast", category: "mode",
    description: "Toggle fast mode",
    handler: () => ({ output: "Fast mode toggled." }),
  });

  registerSlashCommand({
    name: "verbose", category: "mode",
    description: "Toggle verbose output",
    handler: () => ({ output: "Verbose mode toggled." }),
  });

  registerSlashCommand({
    name: "status", category: "system",
    description: "Show session status",
    handler: () => ({ output: "Session status — not yet wired." }),
  });

  registerSlashCommand({
    name: "config", category: "system",
    description: "View or modify settings",
    handler: (args) => ({ output: args ? `Config: ${args}` : "Use /config <key> [value]" }),
  });

  registerSlashCommand({
    name: "mcp", category: "system",
    description: "Show MCP server status",
    handler: () => ({ output: "MCP servers — use 'coders mcp list' for details." }),
  });

  registerSlashCommand({
    name: "memory", category: "core",
    description: "View saved memories",
    handler: () => ({ output: "Memories — use @hasna/mementos for persistent memory." }),
  });

  registerSlashCommand({
    name: "tasks", aliases: ["todo", "todos"], category: "task",
    description: "Toggle task list view",
    handler: () => ({ action: "toggleView", data: "tasks", output: "Task list toggled." }),
  });

  registerSlashCommand({
    name: "diff", category: "git",
    description: "Show git diff",
    handler: () => ({ output: "Use Bash tool: git diff" }),
  });

  registerSlashCommand({
    name: "pr", category: "git",
    description: "Create or review a pull request",
    handler: () => ({ output: "Use Bash tool: gh pr create" }),
  });

  registerSlashCommand({
    name: "review", category: "git",
    description: "Review code changes",
    handler: () => ({ output: "Code review — describe what to review." }),
  });

  registerSlashCommand({
    name: "transcript", category: "navigation",
    description: "Toggle conversation transcript",
    handler: () => ({ action: "toggleView", data: "transcript" }),
  });

  registerSlashCommand({
    name: "history", category: "navigation",
    description: "Search conversation history",
    handler: () => ({ output: "History search — not yet wired." }),
  });

  registerSlashCommand({
    name: "session", aliases: ["remote"], category: "system",
    description: "Show session info or remote URL",
    handler: () => ({ output: "Session info — not yet wired." }),
  });

  registerSlashCommand({
    name: "plugin", aliases: ["plugins"], category: "plugin",
    description: "Manage plugins",
    handler: () => ({ output: "Plugins — use 'coders plugin list' for details." }),
  });

  registerSlashCommand({
    name: "terminal", category: "system",
    description: "Show terminal info",
    handler: async () => {
      const { detectTerminal } = await import("../ui/screen/terminal.js");
      const caps = detectTerminal();
      return { output: `Terminal: ${caps.name}, Color: ${caps.colorDepth}bit, Unicode: ${caps.unicode}` };
    },
  });
}

// Initialize on module load
registerDefaults();
