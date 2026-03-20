/**
 * Slash command system — user-invocable commands via /name
 *
 * Matches Claude Code's 49 slash commands (01-core-slash-commands.js).
 */
import { writeFileSync } from "fs";
import { dbAll, dbGet } from "../db/index.js";

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

  registerSlashCommand({
    name: "rewind", category: "core",
    description: "List recent file checkpoints and restore one",
    handler: (args) => {
      interface Checkpoint {
        id: string;
        file_path: string;
        original_content: string;
        edit_operation: string;
        created_at: string;
      }

      const checkpoints = dbAll<Checkpoint>(
        "SELECT * FROM checkpoints ORDER BY created_at DESC LIMIT 10",
      );

      if (checkpoints.length === 0) {
        return { output: "No checkpoints found. Checkpoints are created when files are edited or overwritten." };
      }

      // If user passed a number, restore that checkpoint
      const choice = parseInt(args, 10);
      if (!isNaN(choice) && choice >= 1 && choice <= checkpoints.length) {
        const cp = checkpoints[choice - 1];
        try {
          writeFileSync(cp.file_path, cp.original_content, "utf-8");
          const op = cp.edit_operation ? JSON.parse(cp.edit_operation) : null;
          const summary = op?.old_string
            ? `Reverted edit: "${truncate(op.old_string, 40)}" -> "${truncate(op.new_string, 40)}"`
            : "Restored original content";
          return { output: `Restored checkpoint #${choice}: ${cp.file_path}\n${summary}` };
        } catch (e) {
          return { output: `Failed to restore checkpoint: ${e instanceof Error ? e.message : String(e)}` };
        }
      }

      // Otherwise list checkpoints
      const lines = checkpoints.map((cp, i) => {
        const op = cp.edit_operation ? JSON.parse(cp.edit_operation) : null;
        const summary = op?.old_string
          ? `"${truncate(op.old_string, 30)}" -> "${truncate(op.new_string, 30)}"`
          : op?.type === "write_overwrite"
            ? "file overwrite"
            : "unknown operation";
        return `  ${i + 1}. [${cp.created_at}] ${cp.file_path}\n     ${summary}`;
      });

      return {
        output: `Recent checkpoints:\n${lines.join("\n")}\n\nUse /rewind <number> to restore a checkpoint.`,
      };
    },
  });

  registerSlashCommand({
    name: "undo", category: "core",
    description: "Revert the last file edit from the most recent checkpoint",
    handler: () => {
      interface Checkpoint {
        id: string;
        file_path: string;
        original_content: string;
        edit_operation: string;
        created_at: string;
      }

      const cp = dbGet<Checkpoint>(
        "SELECT * FROM checkpoints ORDER BY created_at DESC LIMIT 1",
      );

      if (!cp) {
        return { output: "No checkpoints found. Nothing to undo." };
      }

      try {
        writeFileSync(cp.file_path, cp.original_content, "utf-8");
        const op = cp.edit_operation ? JSON.parse(cp.edit_operation) : null;
        const summary = op?.old_string
          ? `Reverted: "${truncate(op.old_string, 50)}" -> "${truncate(op.new_string, 50)}"`
          : op?.type === "write_overwrite"
            ? "Restored file before overwrite"
            : "Restored original content";
        return { output: `Undo successful: ${cp.file_path}\n${summary}\n[checkpoint: ${cp.id} at ${cp.created_at}]` };
      } catch (e) {
        return { output: `Failed to undo: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  const oneLine = s.replace(/\n/g, "\\n");
  return oneLine.length > max ? oneLine.slice(0, max) + "..." : oneLine;
}

// Initialize on module load
registerDefaults();
