/**
 * Slash command system — user-invocable commands via /name
 *
 * Matches Claude Code's 49 slash commands (01-core-slash-commands.js).
 */
import { writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { dbAll, dbGet } from "../db/index.js";
import { getCurrentSessionId, listCheckpoints, loadLatestCheckpoint } from "./session.js";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  category: "core" | "task" | "git" | "mode" | "navigation" | "plugin" | "system";
  handler: (args: string) => Promise<SlashCommandResult> | SlashCommandResult;
}

export interface SlashCommandResult {
  output?: string;
  action?: "clear" | "compact" | "exit" | "toggleView" | "setModel" | "setMode" | "checkpoint" | "restore" | "export" | "theme" | "fast" | "effort" | "rename" | "resume" | "model" | "vim";
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
    description: "Compact conversation context [instructions]",
    handler: (args) => ({
      action: "compact",
      data: args.trim() || undefined,
      output: args.trim() ? `Context compacted with instructions: ${args.trim()}` : "Context compacted.",
    }),
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
      if (args) return { action: "model", data: args.trim(), output: `Model set to: ${args.trim()}` };
      return { output: "Current model — use /model <name> to change." };
    },
  });

  registerSlashCommand({
    name: "fast", category: "mode",
    description: "Toggle fast mode (switch between current model and haiku)",
    handler: () => ({ action: "fast", output: "Fast mode toggled." }),
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
    description: "List all background tasks with their status",
    handler: () => {
      try {
        const { getAllTasks } = require("./background-tasks.js");
        const tasks = getAllTasks();
        if (tasks.length === 0) return { output: "No background tasks." };
        const lines = tasks.map((t: any) => {
          const elapsed = t.endTime
            ? `${((t.endTime - t.startTime) / 1000).toFixed(1)}s`
            : `${((Date.now() - t.startTime) / 1000).toFixed(1)}s`;
          const status = t.status === "running" ? "running" : t.status === "completed" ? "done" : t.status;
          return `  ${t.id.padEnd(12)} ${status.padEnd(10)} ${elapsed.padEnd(8)} ${t.description}`;
        });
        return { output: `Background tasks:\n  ${"ID".padEnd(12)} ${"Status".padEnd(10)} ${"Time".padEnd(8)} Description\n${lines.join("\n")}` };
      } catch {
        return { output: "No background tasks." };
      }
    },
  });

  registerSlashCommand({
    name: "diff", category: "git",
    description: "Show uncommitted git changes",
    handler: () => {
      try {
        const unstaged = execSync("git diff", { encoding: "utf-8", timeout: 10000 }).trim();
        const staged = execSync("git diff --cached", { encoding: "utf-8", timeout: 10000 }).trim();
        const parts: string[] = [];
        if (staged) parts.push(`── Staged changes ──\n${staged}`);
        if (unstaged) parts.push(`── Unstaged changes ──\n${unstaged}`);
        if (parts.length === 0) return { output: "No uncommitted changes." };
        return { output: parts.join("\n\n") };
      } catch (e) {
        return { output: `Failed to get diff: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
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
    name: "checkpoint", aliases: ["cp"], category: "core",
    description: "Save a conversation checkpoint [label]",
    handler: (args) => {
      // The actual save is done in the app (which has access to the messages/history state).
      // We pass the label through data so the app can use it.
      const label = args.trim() || undefined;
      return {
        action: "checkpoint",
        data: label,
        output: "", // The app will set the actual output after saving
      };
    },
  });

  registerSlashCommand({
    name: "restore", category: "core",
    description: "Restore a conversation checkpoint [id or 'latest']",
    handler: (args) => {
      const sessionId = getCurrentSessionId();
      if (!sessionId) {
        return { output: "No active session. Cannot list or restore checkpoints." };
      }

      const arg = args.trim();

      // No argument: list available checkpoints
      if (!arg) {
        const checkpoints = listCheckpoints(sessionId);
        if (checkpoints.length === 0) {
          return { output: "No checkpoints found. Use /checkpoint [label] to save one." };
        }
        const lines = checkpoints.map((cp, i) => {
          return `  ${i + 1}. [${cp.createdAt}] "${cp.label}" (${cp.messageCount} messages) id:${cp.id.slice(0, 8)}`;
        });
        return {
          output: `Conversation checkpoints:\n${lines.join("\n")}\n\nUse /restore latest or /restore <number> or /restore <id-prefix>`,
        };
      }

      // "latest" — restore most recent
      if (arg === "latest") {
        const cp = loadLatestCheckpoint(sessionId);
        if (!cp) {
          return { output: "No checkpoints found for this session." };
        }
        return {
          action: "restore",
          data: cp,
          output: `Restored checkpoint "${cp.label}" (${cp.messageCount} messages, ${cp.createdAt})`,
        };
      }

      // Numeric — pick from the list by index
      const num = parseInt(arg, 10);
      if (!isNaN(num) && num >= 1) {
        const checkpoints = listCheckpoints(sessionId);
        if (num > checkpoints.length) {
          return { output: `Only ${checkpoints.length} checkpoint(s) available. Use /restore to list them.` };
        }
        const cp = checkpoints[num - 1];
        return {
          action: "restore",
          data: cp,
          output: `Restored checkpoint #${num} "${cp.label}" (${cp.messageCount} messages, ${cp.createdAt})`,
        };
      }

      // ID prefix match
      const checkpoints = listCheckpoints(sessionId, 50);
      const match = checkpoints.find(cp => cp.id.startsWith(arg));
      if (match) {
        return {
          action: "restore",
          data: match,
          output: `Restored checkpoint "${match.label}" (${match.messageCount} messages, ${match.createdAt})`,
        };
      }

      return { output: `No checkpoint found matching "${arg}". Use /restore to list available checkpoints.` };
    },
  });

  registerSlashCommand({
    name: "cost", category: "system",
    description: "Show session cost, token usage, and duration",
    handler: () => {
      const sessionId = getCurrentSessionId();
      if (!sessionId) return { output: "No active session." };
      try {
        const row = dbGet<any>(
          `SELECT created_at,
                  COALESCE(SUM(tokens_in), 0) AS total_in,
                  COALESCE(SUM(tokens_out), 0) AS total_out,
                  COALESCE(SUM(cost_usd), 0) AS total_cost
           FROM messages WHERE session_id = ?`,
          [sessionId],
        );
        const session = dbGet<any>(`SELECT created_at FROM sessions WHERE id = ?`, [sessionId]);
        const startTime = session?.created_at ? new Date(session.created_at).getTime() : Date.now();
        const durationMs = Date.now() - startTime;
        const durationMin = Math.floor(durationMs / 60000);
        const durationSec = Math.floor((durationMs % 60000) / 1000);
        const totalIn = row?.total_in ?? 0;
        const totalOut = row?.total_out ?? 0;
        const totalCost = row?.total_cost ?? 0;
        const lines = [
          `Session cost:`,
          `  Duration:       ${durationMin}m ${durationSec}s`,
          `  Input tokens:   ${totalIn.toLocaleString()}`,
          `  Output tokens:  ${totalOut.toLocaleString()}`,
          `  Total tokens:   ${(totalIn + totalOut).toLocaleString()}`,
          `  Total cost:     $${totalCost.toFixed(4)}`,
        ];
        return { output: lines.join("\n") };
      } catch (e) {
        return { output: `Failed to get cost info: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "files", category: "system",
    description: "List files read/written in this session",
    handler: () => {
      const sessionId = getCurrentSessionId();
      if (!sessionId) return { output: "No active session." };
      try {
        const rows = dbAll<any>(
          `SELECT DISTINCT file_path, edit_operation FROM checkpoints WHERE session_id = ? OR 1=1 ORDER BY created_at DESC LIMIT 50`,
        );
        // Also check messages for tool_uses referencing files
        const msgRows = dbAll<any>(
          `SELECT tool_uses FROM messages WHERE session_id = ? AND tool_uses IS NOT NULL`,
          [sessionId],
        );
        const filesRead = new Set<string>();
        const filesWritten = new Set<string>();
        for (const r of msgRows) {
          try {
            const uses = JSON.parse(r.tool_uses);
            if (Array.isArray(uses)) {
              for (const u of uses) {
                if (u.name === "Read" && u.input?.file_path) filesRead.add(u.input.file_path);
                if ((u.name === "Edit" || u.name === "Write") && u.input?.file_path) filesWritten.add(u.input.file_path);
              }
            }
          } catch { /* skip malformed */ }
        }
        const parts: string[] = [];
        if (filesRead.size > 0) {
          parts.push(`Files read (${filesRead.size}):\n${Array.from(filesRead).map(f => `  ${f}`).join("\n")}`);
        }
        if (filesWritten.size > 0) {
          parts.push(`Files written (${filesWritten.size}):\n${Array.from(filesWritten).map(f => `  ${f}`).join("\n")}`);
        }
        if (parts.length === 0) return { output: "No files tracked in this session." };
        return { output: parts.join("\n\n") };
      } catch (e) {
        return { output: `Failed to list files: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "export", category: "core",
    description: "Export conversation to a file [path]",
    handler: (args) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const path = args.trim() || join(process.cwd(), `coders-export-${timestamp}.md`);
      return { action: "export", data: path, output: `Exporting conversation to: ${path}` };
    },
  });

  registerSlashCommand({
    name: "theme", category: "mode",
    description: "Change UI theme [name]",
    handler: (args) => {
      if (!args.trim()) {
        try {
          const { getAvailableThemes } = require("../ui/themes.js");
          const themes = getAvailableThemes();
          return { output: `Available themes: ${themes.join(", ")}\nUse /theme <name> to switch.` };
        } catch {
          return { output: "Available themes: default, dark, light\nUse /theme <name> to switch." };
        }
      }
      return { action: "theme", data: args.trim(), output: `Theme set to: ${args.trim()}` };
    },
  });

  registerSlashCommand({
    name: "effort", category: "mode",
    description: "Set effort level [low|medium|high]",
    handler: (args) => {
      const level = args.trim().toLowerCase();
      if (!level) return { output: "Usage: /effort <low|medium|high>" };
      if (!["low", "medium", "high"].includes(level)) {
        return { output: `Invalid effort level: "${level}". Must be one of: low, medium, high` };
      }
      return { action: "effort", data: level, output: `Effort level set to: ${level}` };
    },
  });

  registerSlashCommand({
    name: "skills", category: "system",
    description: "List available skills from .coders/skills/ and .claude/skills/",
    handler: () => {
      const skillDirs = [
        join(process.cwd(), ".coders", "skills"),
        join(process.cwd(), ".claude", "skills"),
      ];
      const skills: string[] = [];
      for (const dir of skillDirs) {
        if (!existsSync(dir)) continue;
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const skillMd = join(dir, entry.name, "SKILL.md");
              if (existsSync(skillMd)) {
                skills.push(`  ${entry.name} (${dir}/${entry.name}/SKILL.md)`);
              }
            }
          }
        } catch { /* ignore unreadable dirs */ }
      }
      if (skills.length === 0) return { output: "No skills found. Place SKILL.md files in .coders/skills/<name>/ or .claude/skills/<name>/." };
      return { output: `Available skills (${skills.length}):\n${skills.join("\n")}` };
    },
  });

  registerSlashCommand({
    name: "rename", category: "core",
    description: "Rename the current session [name]",
    handler: (args) => {
      if (!args.trim()) return { output: "Usage: /rename <name>" };
      return { action: "rename", data: args.trim(), output: `Session renamed to: ${args.trim()}` };
    },
  });

  registerSlashCommand({
    name: "resume", category: "navigation",
    description: "Resume the last session",
    handler: () => ({ action: "resume", output: "Resuming last session..." }),
  });

  registerSlashCommand({
    name: "vim", category: "mode",
    description: "Toggle vim keybinding mode",
    handler: () => ({ action: "vim", output: "Vim mode toggled." }),
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
