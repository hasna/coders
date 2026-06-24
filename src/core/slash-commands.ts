/**
 * Slash command system — user-invocable commands via /name
 *
 * Matches Claude Code's 49 slash commands (01-core-slash-commands.js).
 */
import { writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { dbAll, dbGet } from "../db/index.js";
import { getCurrentSessionId, getSessionStartTime, listCheckpoints, loadLatestCheckpoint } from "./session.js";
import { DEFAULT_TEXT_LIMIT, compactLongText, parseLimit, sliceWithLimit, truncateLine } from "../utils/output.js";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  category: "core" | "task" | "git" | "mode" | "navigation" | "plugin" | "system";
  handler: (args: string) => Promise<SlashCommandResult> | SlashCommandResult;
}

export interface SlashCommandResult {
  output?: string;
  action?: "clear" | "compact" | "exit" | "toggleView" | "setModel" | "setMode" | "checkpoint" | "restore" | "export" | "theme" | "fast" | "effort" | "rename" | "resume" | "model" | "vim" | "verbose" | "plan" | "configPicker" | "sessionsPicker";
  data?: unknown;
}

const commands = new Map<string, SlashCommand>();
const usageCounts = new Map<string, number>();

const DEFAULT_TOP_COMMANDS = ["model", "clear", "compact", "diff", "help"];

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
  // Track usage for "top commands" feature
  usageCounts.set(cmd.name, (usageCounts.get(cmd.name) ?? 0) + 1);
  return cmd.handler(args);
}

/**
 * Get the top N most-used slash commands.
 * Falls back to a sensible default list if no usage history.
 */
export function getTopCommands(n = 5): SlashCommand[] {
  const all = getAllSlashCommands();
  if (usageCounts.size === 0) {
    // No history — return defaults
    return DEFAULT_TOP_COMMANDS
      .map(name => all.find(c => c.name === name))
      .filter((c): c is SlashCommand => c != null)
      .slice(0, n);
  }
  // Sort by usage count descending
  return [...all]
    .sort((a, b) => (usageCounts.get(b.name) ?? 0) - (usageCounts.get(a.name) ?? 0))
    .slice(0, n);
}

// ── Register default commands ──────────────────────────────────────

function registerDefaults(): void {
  registerSlashCommand({
    name: "help", aliases: ["h", "?"], category: "core",
    description: "Show available commands",
    handler: () => {
      const cmds = getAllSlashCommands().sort((a, b) => a.name.localeCompare(b.name));
      const categories = new Map<string, typeof cmds>();
      for (const cmd of cmds) {
        const cat = cmd.category;
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat)!.push(cmd);
      }
      const catOrder = ["core", "mode", "git", "task", "navigation", "system", "plugin"];
      const sections: string[] = [];
      for (const cat of catOrder) {
        const group = categories.get(cat);
        if (!group?.length) continue;
        sections.push(`\n  ${cat.toUpperCase()}`);
        for (const c of group) sections.push(`    /${c.name.padEnd(16)} ${c.description}`);
      }
      sections.push("\n  KEYBINDINGS");
      sections.push("    Ctrl+C         Cancel / Exit");
      sections.push("    Ctrl+L         Clear screen");
      sections.push("    Ctrl+S         Open model picker");
      sections.push("    Ctrl+Z         Undo last file edit");
      sections.push("    Ctrl+R         Reverse history search");
      sections.push("    Ctrl+\\         Toggle verbose");
      sections.push("    Up/Down        Input history");
      sections.push("    Escape         Cancel input / Abort agent");
      sections.push("    \\+Enter        Multi-line input");
      return { output: `Available commands (${cmds.length}):${sections.join("\n")}` };
    },
  });

  registerSlashCommand({
    name: "clear", category: "core",
    description: "Clear conversation history",
    handler: () => {
      const sessionId = getCurrentSessionId();
      let count = 0;
      try {
        const row = dbGet<any>("SELECT COUNT(*) AS c FROM messages WHERE session_id = ?", [sessionId]);
        count = row?.c ?? 0;
      } catch { /* silent */ }
      return { action: "clear", output: count > 10 ? `Cleared ${count} messages.` : "Conversation cleared." };
    },
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
    description: "Toggle plan mode (read-only, no code edits)",
    handler: (args) => {
      if (args.trim() === "off") {
        return { action: "plan", data: "off", output: "Exiting plan mode." };
      }
      if (args.trim()) {
        return { action: "plan", data: args.trim(), output: `Mode set to: ${args.trim()}` };
      }
      return { action: "plan" };
    },
  });

  registerSlashCommand({
    name: "model", category: "mode",
    description: "View or change the current model",
    handler: (args) => {
      if (args) return { action: "model", data: args.trim(), output: `Model set to: ${args.trim()}` };
      return { action: "model" };
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
    handler: () => ({ action: "verbose" }),
  });

  registerSlashCommand({
    name: "status", category: "system",
    description: "Show session status",
    handler: () => {
      const sessionId = getCurrentSessionId();
      const lines: string[] = ["Session status:"];
      if (sessionId) {
        lines.push(`  Session ID:     ${sessionId}`);
        try {
          const session = dbGet<any>(`SELECT created_at FROM sessions WHERE id = ?`, [sessionId]);
          if (session?.created_at) {
            const start = new Date(session.created_at).getTime();
            const dur = Date.now() - start;
            const m = Math.floor(dur / 60000);
            const s = Math.floor((dur % 60000) / 1000);
            lines.push(`  Duration:       ${m}m ${s}s`);
          }
          const stats = dbGet<any>(
            `SELECT COUNT(*) AS msg_count, COALESCE(SUM(tokens_in + tokens_out), 0) AS total_tokens, COALESCE(SUM(cost_usd), 0) AS total_cost FROM messages WHERE session_id = ?`,
            [sessionId],
          );
          if (stats) {
            lines.push(`  Messages:       ${stats.msg_count}`);
            lines.push(`  Tokens:         ${stats.total_tokens?.toLocaleString() ?? 0}`);
            lines.push(`  Cost:           $${(stats.total_cost ?? 0).toFixed(4)}`);
          }
        } catch { /* silent */ }
      } else {
        lines.push("  No active session.");
      }
      try {
        const branch = execSync("git branch --show-current", { encoding: "utf-8", timeout: 5000 }).trim();
        lines.push(`  Git branch:     ${branch}`);
      } catch { /* not a git repo */ }
      lines.push(`  Working dir:    ${process.cwd()}`);
      return { output: lines.join("\n") };
    },
  });

  registerSlashCommand({
    name: "config", category: "system",
    description: "View or modify settings",
    handler: (args) => {
      try {
        const { getSettings, saveUserSettings } = require("../config/loader.js");
        const settings = getSettings();
        const parts = args.trim().split(/\s+/);
        const key = parts[0];
        const value = parts.slice(1).join(" ");

        if (!key) {
          // Open interactive config picker
          return { action: "configPicker" };
        }
        if (key === "--text") {
          // Fallback text view: /config --text
          const lines = Object.entries(settings)
            .filter(([, v]) => v !== undefined && v !== null)
            .slice(0, 20)
            .map(([k, v]) => `  ${k.padEnd(24)} ${truncateLine(typeof v === "object" ? JSON.stringify(v) : String(v), 120)}`);
          const total = Object.entries(settings).filter(([, v]) => v !== undefined && v !== null).length;
          const hidden = total > 20 ? `\n${total - 20} more setting(s) hidden.` : "";
          return { output: `Current settings (${Math.min(total, 20)}/${total}):\n${lines.join("\n")}${hidden}\n\nUse /config <key> for one setting or /config <key> <value> to change.` };
        }

        if (!value) {
          // Show single setting
          const val = (settings as any)[key];
          if (val === undefined) return { output: `Setting "${key}" is not set.` };
          return { output: `${key} = ${compactLongText(typeof val === "object" ? JSON.stringify(val, null, 2) : String(val), DEFAULT_TEXT_LIMIT, "Use the settings file for the full value.")}` };
        }

        // Validate key against known settings — prevent __proto__ and arbitrary writes
        const ALLOWED_KEYS = new Set(Object.keys(settings));
        if (key.startsWith("__") || key === "constructor" || key === "prototype") {
          return { output: `Invalid setting key: "${key}"` };
        }
        if (!ALLOWED_KEYS.has(key)) {
          return { output: `Unknown setting: "${key}". Valid keys: ${[...ALLOWED_KEYS].join(", ")}` };
        }
        // Set value — try to parse as JSON, fallback to string
        let parsed: unknown = value;
        try { parsed = JSON.parse(value); } catch { parsed = value; }
        saveUserSettings({ [key]: parsed });
        return { output: `Set ${key} = ${typeof parsed === "object" ? JSON.stringify(parsed) : String(parsed)}` };
      } catch (e) {
        return { output: `Config error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "mcp", category: "system",
    description: "Show, add, or remove MCP servers",
    handler: (args) => {
      try {
        const parts = args.trim().split(/\s+/);
        const sub = parts[0]?.toLowerCase();

        // /mcp add <name> <command...>
        if (sub === "add" && parts.length >= 3) {
          const name = parts[1];
          const command = parts.slice(2).join(" ");
          const { addMcpServerConfig } = require("../mcp/config.js");
          addMcpServerConfig(name, { command, args: [], transport: "stdio" }, "user");
          return { output: `Added MCP server "${name}": ${command}\nRestart to connect.` };
        }

        // /mcp remove <name>
        if (sub === "remove" && parts[1]) {
          const { removeMcpServerConfig } = require("../mcp/config.js");
          const removed = removeMcpServerConfig(parts[1], process.cwd());
          return { output: removed ? `Removed MCP server "${parts[1]}"` : `Server "${parts[1]}" not found` };
        }

        // /mcp (list)
        const { loadMcpConfigsWithScope } = require("../mcp/config.js");
        const configs = loadMcpConfigsWithScope(process.cwd());
        if (configs.length === 0) return { output: "No MCP servers configured.\nUse /mcp add <name> <command> to add one." };
        const visible = sliceWithLimit(configs, 20);
        const lines = visible.items.map((c: any) => {
          const transport = c.transport ?? "stdio";
          const cmd = c.command ? `${c.command} ${(c.args ?? []).join(" ")}`.trim() : c.url ?? "—";
          return `  ${truncateLine(c.name, 20).padEnd(20)} ${c.scope.padEnd(8)} ${transport.padEnd(6)} ${truncateLine(cmd, 96)}`;
        });
        const hidden = visible.hidden > 0 ? `\n  ... ${visible.hidden} more. Use coders mcp list --limit ${Math.min(configs.length, 40)} --verbose for details.` : "";
        return { output: `MCP servers (${visible.items.length}/${configs.length}):\n  ${"Name".padEnd(20)} ${"Scope".padEnd(8)} ${"Type".padEnd(6)} Command/URL\n${lines.join("\n")}${hidden}\n\nUse coders mcp list --verbose or /mcp add <name> <command>.` };
      } catch (e) {
        return { output: `MCP error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "memory", category: "core",
    description: "View saved memories",
    handler: () => {
      const memoryDir = join(process.cwd(), ".claude", "memory");
      const lines: string[] = [];

      // Check project-local memory files
      if (existsSync(memoryDir)) {
        try {
          const files = readdirSync(memoryDir).filter(f => f.endsWith(".md"));
          if (files.length > 0) {
            lines.push(`Project memories (${files.length}):`);
            for (const f of files.slice(0, 15)) {
              lines.push(`  ${f.replace(".md", "")}`);
            }
            if (files.length > 15) lines.push(`  ... and ${files.length - 15} more`);
          }
        } catch { /* ignore */ }
      }

      // Check MEMORY.md index
      const memoryIndex = join(process.cwd(), ".claude", "memory", "MEMORY.md");
      if (existsSync(memoryIndex)) {
        try {
          const content = readFileSync(memoryIndex, "utf-8").trim();
          if (content) {
            lines.push("");
            lines.push("Memory index (MEMORY.md):");
            for (const line of content.split("\n").slice(0, 10)) {
              lines.push(`  ${line}`);
            }
          }
        } catch { /* ignore */ }
      }

      if (lines.length === 0) {
        return { output: "No local memories found.\nMemories are stored in .claude/memory/ when Claude saves information.\nFor persistent cross-session memory, use mementos MCP." };
      }
      return { output: lines.join("\n") };
    },
  });

  registerSlashCommand({
    name: "tasks", aliases: ["todo", "todos"], category: "task",
    description: "List all background tasks with their status",
    handler: () => {
      try {
        const { getAllTasks } = require("./background-tasks.js");
        const tasks = getAllTasks();
        if (tasks.length === 0) return { output: "No background tasks." };
        const visible = sliceWithLimit(tasks, 20);
        const lines = visible.items.map((t: any) => {
          const elapsed = t.endTime
            ? `${((t.endTime - t.startTime) / 1000).toFixed(1)}s`
            : `${((Date.now() - t.startTime) / 1000).toFixed(1)}s`;
          const status = t.status === "running" ? "running" : t.status === "completed" ? "done" : t.status;
          return `  ${t.id.padEnd(12)} ${status.padEnd(10)} ${elapsed.padEnd(8)} ${truncateLine(t.description, 96)}`;
        });
        const hidden = visible.hidden > 0 ? `\n  ... ${visible.hidden} more. Use TaskList with a larger limit or TaskOutput <id> for details.` : "";
        return { output: `Background tasks (${visible.items.length}/${tasks.length}):\n  ${"ID".padEnd(12)} ${"Status".padEnd(10)} ${"Time".padEnd(8)} Description\n${lines.join("\n")}${hidden}` };
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
        return { output: compactLongText(parts.join("\n\n"), DEFAULT_TEXT_LIMIT * 3, "Use git diff directly or /review <file> for a narrower view.") };
      } catch (e) {
        return { output: `Failed to get diff: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "pr", category: "git",
    description: "Show current PR status or view a specific PR",
    handler: (args) => {
      try {
        if (args.trim()) {
          // /pr <number> — show specific PR (validate input to prevent injection)
          const num = args.trim();
          if (!/^\d+$/.test(num)) return { output: `Invalid PR number: "${num}". Use /pr <number>.` };
          const { execFileSync: efs } = require("child_process");
          const out = (efs("gh", ["pr", "view", num, "--json", "title,state,url,author,body", "--template", "{{.title}} ({{.state}})\nAuthor: {{.author.login}}\nURL: {{.url}}\n\n{{.body}}"], { encoding: "utf-8", timeout: 15000 }) as string).trim();
          return { output: compactLongText(out, DEFAULT_TEXT_LIMIT * 2, "Use gh pr view directly for the full body.") };
        }
        // /pr — show PR for current branch
        const branch = execSync("git branch --show-current", { encoding: "utf-8", timeout: 5000 }).trim();
        if (branch === "main" || branch === "master") {
          // List recent PRs instead
          const list = execSync("gh pr list --limit 5 --json number,title,state,author --template '{{range .}}  #{{.number}} {{.title}} ({{.state}}) by {{.author.login}}{{\"\\n\"}}{{end}}'", { encoding: "utf-8", timeout: 15000 }).trim();
          return { output: list ? `Recent PRs:\n${list}` : "No open PRs." };
        }
        const out = execSync(`gh pr view --json title,state,url,reviewDecision --template "{{.title}} ({{.state}})\\nReview: {{.reviewDecision}}\\nURL: {{.url}}"`, { encoding: "utf-8", timeout: 15000 }).trim();
        return { output: out };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("no pull requests found") || msg.includes("Could not resolve")) {
          return { output: "No PR found for current branch. Use 'gh pr create' to create one." };
        }
        return { output: `PR error: ${msg.slice(0, 200)}` };
      }
    },
  });

  registerSlashCommand({
    name: "review", category: "git",
    description: "Review code changes (sends diff to the agent for review)",
    handler: (args) => {
      try {
        const file = args.trim();
        let diff: string;
        if (file) {
          const { execFileSync: efs } = require("child_process");
          diff = (efs("git", ["diff", "--", file], { encoding: "utf-8", timeout: 10000 }) as string).trim();
          if (!diff) diff = (efs("git", ["diff", "--cached", "--", file], { encoding: "utf-8", timeout: 10000 }) as string).trim();
          if (!diff) return { output: `No changes found in: ${file}` };
        } else {
          const unstaged = execSync("git diff", { encoding: "utf-8", timeout: 10000 }).trim();
          const staged = execSync("git diff --cached", { encoding: "utf-8", timeout: 10000 }).trim();
          diff = [staged, unstaged].filter(Boolean).join("\n\n");
          if (!diff) return { output: "No uncommitted changes to review." };
        }
        // Return the diff as output — agent will review it in the next turn
        const truncated = diff.length > 5000 ? diff.slice(0, 5000) + "\n... (truncated)" : diff;
        return { output: `Please review the following changes:\n\n\`\`\`diff\n${truncated}\n\`\`\`\n\nProvide feedback on code quality, bugs, and improvements.` };
      } catch (e) {
        return { output: `Review error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "transcript", category: "navigation",
    description: "Toggle conversation transcript",
    handler: () => ({ action: "toggleView", data: "transcript" }),
  });

  registerSlashCommand({
    name: "history", category: "navigation",
    description: "Search conversation history",
    handler: (args) => {
      try {
        const query = args.trim();
        if (!query) {
          // List recent sessions
          const sessions = dbAll<any>(
            `SELECT s.id, s.model, s.created_at, COUNT(m.id) AS msg_count, COALESCE(SUM(m.cost_usd), 0) AS cost
             FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
             GROUP BY s.id ORDER BY s.created_at DESC LIMIT 10`,
          );
          if (sessions.length === 0) return { output: "No session history found." };
          const lines = sessions.map((s: any, i: number) => {
            return `  ${i + 1}. [${s.created_at}] ${s.model ?? "?"} · ${s.msg_count} msgs · $${(s.cost ?? 0).toFixed(4)} · ${s.id.slice(0, 8)}`;
          });
          return { output: `Recent sessions:\n${lines.join("\n")}\n\nUse /history <query> to search messages.` };
        }
        // Search messages
        const results = dbAll<any>(
          `SELECT m.session_id, m.role, m.content, m.created_at
           FROM messages m WHERE m.content LIKE ? ORDER BY m.created_at DESC LIMIT 10`,
          [`%${query.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`],
        );
        if (results.length === 0) return { output: `No messages matching "${query}".` };
        const lines = results.map((r: any) => {
          const preview = (r.content ?? "").slice(0, 80).replace(/\n/g, " ");
          return `  [${r.created_at}] ${r.role}: ${preview}`;
        });
        return { output: `Search results for "${query}" (${results.length}):\n${lines.join("\n")}` };
      } catch (e) {
        return { output: `History error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "session", aliases: ["remote"], category: "system",
    description: "Show session info or remote URL",
    handler: () => {
      const sessionId = getCurrentSessionId();
      const lines: string[] = ["Session info:"];
      if (sessionId) {
        lines.push(`  ID:             ${sessionId}`);
        try {
          const session = dbGet<any>(`SELECT * FROM sessions WHERE id = ?`, [sessionId]);
          if (session) {
            lines.push(`  Created:        ${session.created_at}`);
            lines.push(`  Model:          ${session.model ?? "unknown"} (at creation)`);
            lines.push(`  Project dir:    ${session.project_dir ?? process.cwd()}`);
            try { const { VERSION } = require("../cli/index.js"); lines.push(`  Version:        ${VERSION}`); } catch { lines.push(`  Version:        ${session.app_version ?? "?"}`); };
            if (session.metadata) {
              try {
                const meta = JSON.parse(session.metadata);
                if (meta.name) lines.push(`  Name:           ${meta.name}`);
                if (meta.remoteUrl) lines.push(`  Remote URL:     ${meta.remoteUrl}`);
              } catch { /* ignore */ }
            }
          }
          const stats = dbGet<any>(
            `SELECT COUNT(*) AS msg_count FROM messages WHERE session_id = ?`,
            [sessionId],
          );
          if (stats) lines.push(`  Messages:       ${stats.msg_count}`);
        } catch { /* silent */ }
      } else {
        lines.push("  No active session.");
      }
      return { output: lines.join("\n") };
    },
  });

  registerSlashCommand({
    name: "plugin", aliases: ["plugins"], category: "plugin",
    description: "Manage plugins",
    handler: () => {
      try {
        const { discoverPlugins } = require("../plugins/loader.js");
        const plugins = discoverPlugins();
        if (plugins.length === 0) return { output: "No plugins installed.\nUse 'coders plugin install <name>' to add plugins." };
        const visible = sliceWithLimit(plugins, 20);
        const lines = visible.items.map((p: any) => {
          const status = p.enabled ? "enabled" : "disabled";
          return `  ${truncateLine(p.name, 24).padEnd(24)} v${String(p.version ?? "?").padEnd(10)} ${status.padEnd(10)} ${truncateLine(p.source ?? "", 80)}`;
        });
        const hidden = visible.hidden > 0 ? `\n  ... ${visible.hidden} more. Use coders plugin list --limit ${Math.min(plugins.length, 40)} --verbose for details.` : "";
        return { output: `Installed plugins (${visible.items.length}/${plugins.length}):\n  ${"Name".padEnd(24)} ${"Version".padEnd(11)} ${"Status".padEnd(10)} Source\n${lines.join("\n")}${hidden}` };
      } catch (e) {
        return { output: `Plugin error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
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
        // Validate path is within cwd to prevent arbitrary file writes
        const { resolve: resolvePath } = require("path");
        const resolved = resolvePath(cp.file_path);
        if (!resolved.startsWith(process.cwd()) && !resolved.startsWith(require("os").homedir())) {
          return { output: `Refusing to restore: path "${cp.file_path}" is outside the project and home directory.` };
        }
        try {
          writeFileSync(resolved, cp.original_content, "utf-8");
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
      const visible = sliceWithLimit(checkpoints, 20);
      const lines = visible.items.map((cp, i) => {
        const op = cp.edit_operation ? JSON.parse(cp.edit_operation) : null;
        const summary = op?.old_string
          ? `"${truncate(op.old_string, 30)}" -> "${truncate(op.new_string, 30)}"`
          : op?.type === "write_overwrite"
            ? "file overwrite"
            : "unknown operation";
        return `  ${i + 1}. [${cp.created_at}] ${truncateLine(cp.file_path, 120)}\n     ${summary}`;
      });
      const hidden = visible.hidden > 0 ? `\n  ... ${visible.hidden} more checkpoint(s) hidden.` : "";

      return {
        output: `Recent checkpoints (${visible.items.length}/${checkpoints.length}):\n${lines.join("\n")}${hidden}\n\nUse /rewind <number> to restore a checkpoint.`,
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
        const visible = sliceWithLimit(checkpoints, 20);
        const lines = visible.items.map((cp, i) => {
          return `  ${i + 1}. [${cp.createdAt}] "${truncateLine(cp.label, 50)}" (${cp.messageCount} messages) id:${cp.id.slice(0, 8)}`;
        });
        const hidden = visible.hidden > 0 ? `\n  ... ${visible.hidden} more checkpoint(s) hidden.` : "";
        return {
          output: `Conversation checkpoints (${visible.items.length}/${checkpoints.length}):\n${lines.join("\n")}${hidden}\n\nUse /restore latest or /restore <number> or /restore <id-prefix>`,
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
        const durationMs = Date.now() - getSessionStartTime();
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
        // Per-model breakdown
        try {
          const byModel = dbAll<any>(
            `SELECT s.model, COUNT(m.id) AS turns, COALESCE(SUM(m.tokens_in),0) AS tin, COALESCE(SUM(m.tokens_out),0) AS tout, COALESCE(SUM(m.cost_usd),0) AS cost
             FROM messages m JOIN sessions s ON s.id = m.session_id WHERE m.session_id = ? GROUP BY s.model`,
            [sessionId],
          );
          if (byModel.length > 0) {
            lines.push("");
            lines.push("  Per model:");
            for (const m of byModel) {
              lines.push(`    ${(m.model ?? "?").padEnd(12)} ${m.turns} turns · ${(m.tin + m.tout).toLocaleString()} tokens · $${m.cost.toFixed(4)}`);
            }
          }
        } catch { /* optional */ }
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
          `SELECT DISTINCT file_path, edit_operation FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT 50`,
          [sessionId],
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
          const read = sliceWithLimit(Array.from(filesRead), 20);
          const hidden = read.hidden > 0 ? `\n  ... ${read.hidden} more` : "";
          parts.push(`Files read (${read.items.length}/${filesRead.size}):\n${read.items.map(f => `  ${truncateLine(f, 120)}`).join("\n")}${hidden}`);
        }
        if (filesWritten.size > 0) {
          const written = sliceWithLimit(Array.from(filesWritten), 20);
          const hidden = written.hidden > 0 ? `\n  ... ${written.hidden} more` : "";
          parts.push(`Files written (${written.items.length}/${filesWritten.size}):\n${written.items.map(f => `  ${truncateLine(f, 120)}`).join("\n")}${hidden}`);
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
        return { action: "theme" };
      }
      return { action: "theme", data: args.trim(), output: `Theme set to: ${args.trim()}` };
    },
  });

  registerSlashCommand({
    name: "effort", category: "mode",
    description: "Set effort level [low|medium|high]",
    handler: (args) => {
      const level = args.trim().toLowerCase();
      if (!level) return { action: "effort" };
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
    handler: () => {
      // List recent sessions for the user to pick from
      try {
        const sessions = dbAll<any>(
          `SELECT s.id, s.model, s.created_at, COUNT(m.id) AS msg_count
           FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
           GROUP BY s.id ORDER BY s.created_at DESC LIMIT 5`,
        );
        if (sessions.length === 0) return { output: "No previous sessions found." };
        const lines = sessions.map((s: any, i: number) =>
          `  ${i + 1}. [${s.created_at}] ${s.model ?? "?"} · ${s.msg_count} msgs · ${s.id.slice(0, 8)}`
        );
        return { output: `Recent sessions:\n${lines.join("\n")}\n\nTo resume, restart with: coders --resume ${sessions[0].id.slice(0, 8)}` };
      } catch {
        return { output: "Resume requires restarting: coders --resume <session-id>" };
      }
    },
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

      // Validate path is within cwd or home
      const { resolve: rp } = require("path");
      const undoResolved = rp(cp.file_path);
      if (!undoResolved.startsWith(process.cwd()) && !undoResolved.startsWith(require("os").homedir())) {
        return { output: `Refusing to undo: path "${cp.file_path}" is outside the project and home directory.` };
      }

      try {
        writeFileSync(undoResolved, cp.original_content, "utf-8");
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

  registerSlashCommand({
    name: "sessions", category: "navigation",
    description: "List all sessions — interactive picker to select and resume",
    handler: (args) => {
      if (!args.trim()) {
        return { action: "sessionsPicker" };
      }
      try {
        const limit = parseLimit(args.trim(), 20, 100);
        const sessions = dbAll<any>(
          `SELECT s.id, s.model, s.created_at, s.project_dir,
                  COUNT(m.id) AS msg_count,
                  COALESCE(SUM(m.tokens_in), 0) AS tokens_in,
                  COALESCE(SUM(m.tokens_out), 0) AS tokens_out,
                  COALESCE(SUM(m.cost_usd), 0) AS cost,
                  s.metadata
           FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
           GROUP BY s.id ORDER BY s.created_at DESC LIMIT ?`,
          [limit],
        );
        if (sessions.length === 0) return { output: "No sessions found." };

        const currentId = getCurrentSessionId();
        const lines = [`Sessions (${sessions.length}, most recent first; use /sessions <limit> to adjust):`,
          `  ${"#".padEnd(4)} ${"Date".padEnd(20)} ${"Model".padEnd(10)} ${"Msgs".padEnd(6)} ${"Tokens".padEnd(10)} ${"Cost".padEnd(8)} ID`,
          `  ${"─".repeat(70)}`,
        ];
        sessions.forEach((s: any, i: number) => {
          const isCurrent = s.id === currentId;
          let name = "";
          try { name = s.metadata ? JSON.parse(s.metadata).name ?? "" : ""; } catch {}
          const date = (s.created_at ?? "").slice(0, 16);
          const tok = ((s.tokens_in ?? 0) + (s.tokens_out ?? 0)).toLocaleString();
          lines.push(
            `  ${String(i + 1).padEnd(4)} ${date.padEnd(20)} ${(s.model ?? "?").padEnd(10)} ${String(s.msg_count).padEnd(6)} ${tok.padEnd(10)} $${(s.cost ?? 0).toFixed(2).padEnd(7)} ${s.id.slice(0, 8)}${isCurrent ? " ← current" : ""}${name ? ` (${name})` : ""}`
          );
        });
        lines.push("");
        lines.push("Resume a session: coders --resume <id>");
        return { output: lines.join("\n") };
      } catch (e) {
        return { output: `Error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "login", category: "system",
    description: "Check or set API key authentication",
    handler: (args) => {
      try {
        if (args.trim()) {
          const key = args.trim();
          const { saveApiKey } = require("../auth/api-key.js");
          saveApiKey(key);
          return { output: `API key saved (${key.slice(0, 8)}...${key.slice(-4)}).` };
        }
        const { resolveApiKey } = require("../auth/api-key.js");
        const resolved = resolveApiKey();
        if (resolved) {
          return { output: `Authenticated via ${resolved.source}\nKey: ${resolved.apiKey.slice(0, 8)}...${resolved.apiKey.slice(-4)}` };
        }
        return { output: "Not authenticated. Use /login <api-key> or set ANTHROPIC_API_KEY." };
      } catch (e) {
        return { output: `Auth error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "logout", category: "system",
    description: "Remove saved API key",
    handler: () => {
      try {
        const { removeApiKey } = require("../auth/api-key.js");
        removeApiKey();
        return { output: "API key removed. Set ANTHROPIC_API_KEY env var or use /login to re-authenticate." };
      } catch (e) {
        return { output: `Error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "hooks", category: "system",
    description: "List active hooks",
    handler: () => {
      try {
        const { getRegisteredHookCount } = require("../hooks/registry.js");
        const { getSettings } = require("../config/loader.js");
        const settings = getSettings();
        const hookConfig = settings.hooks ?? {};
        const entries = Object.entries(hookConfig);
        if (entries.length === 0) return { output: `No hooks configured (${getRegisteredHookCount()} registered).\nAdd hooks in settings.json under "hooks".` };
        const visible = sliceWithLimit(entries, 20);
        const lines = visible.items.map(([event, cmds]: [string, any]) => {
          const cmdList = Array.isArray(cmds) ? cmds : [];
          return `  ${truncateLine(event, 20).padEnd(20)} ${cmdList.length} command${cmdList.length !== 1 ? "s" : ""}`;
        });
        const hidden = visible.hidden > 0 ? `\n  ... ${visible.hidden} more hook event(s) hidden.` : "";
        return { output: `Active hooks (${visible.items.length}/${entries.length}; ${getRegisteredHookCount()} registered):\n${lines.join("\n")}${hidden}` };
      } catch (e) {
        return { output: `Error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "agents", category: "system",
    description: "List running and recently completed background agents",
    handler: () => {
      try {
        const { getAllRunningAgents } = require("../tools/builtin/agent.js");
        const agents = getAllRunningAgents();
        if (agents.length === 0) return { output: "No agents running. Use the Agent tool to spawn sub-agents." };
        const visible = sliceWithLimit(agents, 20);
        const lines = visible.items.map((a: any) => {
          const status = a.status === "running" ? "⠙ running" : a.status === "completed" ? "● done" : "✗ failed";
          const result = a.result ? ` — ${truncateLine(a.result, 80)}` : "";
          return `  ${a.id.slice(0, 8)} ${truncateLine(a.type, 10).padEnd(10)} ${status}${result}`;
        });
        const hidden = visible.hidden > 0 ? `\n  ... ${visible.hidden} more. Use TaskList or TaskOutput for details.` : "";
        return { output: `Agents (${visible.items.length}/${agents.length}):\n${lines.join("\n")}${hidden}` };
      } catch {
        return { output: "No agents running." };
      }
    },
  });

  registerSlashCommand({
    name: "thinking", category: "mode",
    description: "Show or toggle extended thinking mode",
    handler: (args) => {
      try {
        const { getSettings, saveUserSettings } = require("../config/loader.js");
        const settings = getSettings();
        const thinking = settings.thinking ?? { enabled: true };
        if (!args.trim()) {
          return { output: `Thinking: ${thinking.enabled ? "enabled" : "disabled"}\nBudget: ${thinking.budgetTokens ?? "auto"} tokens\n\nUse /thinking on|off to toggle, /thinking budget <N> to set budget.` };
        }
        if (args.trim() === "on") {
          saveUserSettings({ thinking: { ...thinking, enabled: true } });
          return { output: "Extended thinking enabled." };
        }
        if (args.trim() === "off") {
          saveUserSettings({ thinking: { ...thinking, enabled: false } });
          return { output: "Extended thinking disabled." };
        }
        if (args.trim().startsWith("budget")) {
          const n = parseInt(args.replace("budget", "").trim(), 10);
          if (isNaN(n) || n < 1) return { output: "Usage: /thinking budget <number>" };
          saveUserSettings({ thinking: { ...thinking, budgetTokens: n } });
          return { output: `Thinking budget set to ${n} tokens.` };
        }
        return { output: "Usage: /thinking [on|off|budget <N>]" };
      } catch (e) {
        return { output: `Error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "doctor", category: "system",
    description: "Check installation health",
    handler: () => {
      const lines = ["Coders Doctor:"];
      const ok = "✓", fail = "✗";
      // Node version
      lines.push(`  ${ok} Node: ${process.version}`);
      lines.push(`  ${ok} Platform: ${process.platform} ${process.arch}`);
      // API key
      try {
        const { resolveApiKey } = require("../auth/api-key.js");
        const key = resolveApiKey();
        lines.push(key ? `  ${ok} Auth: configured (${key.source})` : `  ${fail} Auth: not configured`);
      } catch { lines.push(`  ${fail} Auth: error`); }
      // Git
      try { execSync("git --version", { stdio: "pipe" }); lines.push(`  ${ok} Git: available`); } catch { lines.push(`  ${fail} Git: not found`); }
      // MCP
      try {
        const { loadMcpConfigs } = require("../mcp/config.js");
        const configs = loadMcpConfigs(process.cwd());
        lines.push(`  ${ok} MCP servers: ${configs.length} configured`);
      } catch { lines.push(`  ${fail} MCP: error loading configs`); }
      // DB
      try { dbGet("SELECT 1"); lines.push(`  ${ok} Database: SQLite connected`); } catch { lines.push(`  ${fail} Database: not available`); }
      return { output: lines.join("\n") };
    },
  });

  registerSlashCommand({
    name: "bug", category: "system",
    description: "Report a bug or give feedback",
    handler: () => {
      return { output: "Report bugs at: https://github.com/hasnaxyz/open-coders/issues\n\nInclude: what you did, what happened, what you expected.\nRun /terminal and /status for system info to include." };
    },
  });

  registerSlashCommand({
    name: "context", category: "system",
    description: "Show current context window usage",
    handler: () => {
      const sessionId = getCurrentSessionId();
      if (!sessionId) return { output: "No active session." };
      try {
        const row = dbGet<any>(
          `SELECT COALESCE(SUM(tokens_in), 0) AS total_in, COALESCE(SUM(tokens_out), 0) AS total_out FROM messages WHERE session_id = ?`,
          [sessionId],
        );
        const totalIn = row?.total_in ?? 0;
        const totalOut = row?.total_out ?? 0;
        const total = totalIn + totalOut;
        const contextWindow = 200_000;
        const pct = ((total / contextWindow) * 100).toFixed(1);
        const bar = "█".repeat(Math.floor(total / contextWindow * 30)) + "░".repeat(30 - Math.floor(total / contextWindow * 30));
        const lines = [
          `Context window usage:`,
          `  [${bar}] ${pct}%`,
          `  Input tokens:   ${totalIn.toLocaleString()}`,
          `  Output tokens:  ${totalOut.toLocaleString()}`,
          `  Total:          ${total.toLocaleString()} / ${contextWindow.toLocaleString()}`,
          `  Remaining:      ~${(contextWindow - total).toLocaleString()} tokens`,
          total > contextWindow * 0.8 ? `  ⚠ Context nearly full — consider /compact` : "",
        ].filter(Boolean);
        return { output: lines.join("\n") };
      } catch (e) {
        return { output: `Error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "permissions", aliases: ["allowed-tools"], category: "system",
    description: "Show current permission mode and allow/deny rules",
    handler: () => {
      try {
        const { getSettings } = require("../config/loader.js");
        const settings = getSettings();
        const perms = settings.permissions ?? {};
        const lines = ["Permission settings:"];
        lines.push(`  Mode:     ${perms.defaultMode ?? "default"}`);
        const allow = perms.allow ?? [];
        const deny = perms.deny ?? [];
        if (allow.length > 0) {
          lines.push(`  Allow (${allow.length}):`);
          for (const rule of allow.slice(0, 10)) {
            lines.push(`    ${rule.toolName ?? "*"} ${rule.command ? `cmd:${rule.command}` : ""} ${rule.path ? `path:${rule.path}` : ""}`);
          }
          if (allow.length > 10) lines.push(`    ... +${allow.length - 10} more`);
        } else {
          lines.push("  Allow:    (none — all tools go through permission check)");
        }
        if (deny.length > 0) {
          lines.push(`  Deny (${deny.length}):`);
          for (const rule of deny.slice(0, 10)) {
            lines.push(`    ${rule.toolName ?? "*"} ${rule.command ? `cmd:${rule.command}` : ""} ${rule.path ? `path:${rule.path}` : ""}`);
          }
          if (deny.length > 10) lines.push(`    ... +${deny.length - 10} more`);
        } else {
          lines.push("  Deny:     (none)");
        }
        lines.push("");
        lines.push("Use /config permissions.defaultMode <mode> to change mode.");
        lines.push("Modes: default, plan, bypassPermissions");
        return { output: lines.join("\n") };
      } catch (e) {
        return { output: `Error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registerSlashCommand({
    name: "init", category: "core",
    description: "Generate a CLAUDE.md project instructions file",
    handler: () => {
      const claudeMd = join(process.cwd(), "CLAUDE.md");
      if (existsSync(claudeMd)) {
        return { output: `CLAUDE.md already exists at ${claudeMd}. Edit it manually or delete and re-run /init.` };
      }
      const projectName = process.cwd().split("/").pop() ?? "project";
      let gitBranch = "";
      try { gitBranch = execSync("git branch --show-current", { encoding: "utf-8", timeout: 5000 }).trim(); } catch {}
      const template = `# ${projectName} — Project Instructions

## Overview
<!-- Describe what this project does -->

## Architecture
<!-- Key directories and files -->
- \`src/\` — source code
- \`tests/\` — test files

## Development
<!-- How to build, test, run -->
\`\`\`bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
\`\`\`

## Conventions
<!-- Coding standards, naming, patterns -->
- Use TypeScript strict mode
- Prefer async/await over callbacks
${gitBranch ? `\n## Git\n- Main branch: \`${gitBranch}\`\n` : ""}
## Rules for AI Agents
- Read files before editing
- Run tests after changes
- Do not modify files outside this project
`;
      writeFileSync(claudeMd, template, "utf-8");
      return { output: `Created CLAUDE.md at ${claudeMd}\nEdit it to customize instructions for AI agents.` };
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
