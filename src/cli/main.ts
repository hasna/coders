/**
 * Main CLI setup — Commander.js program definition
 * Equivalent to Claude Code's KTz() (run function)
 *
 * This file owns the Commander.js program, all subcommands,
 * and the preAction hook that initializes configs/auth/plugins.
 */
import { Command, Option } from "commander";
import { VERSION, BUILD_TIME, PACKAGE_NAME, ISSUES_URL, profileCheckpoint } from "./index.js";
import type { CliOptions } from "./args.js";
import { resolveOptions } from "./args.js";

/** Help formatter matching Claude Code's style */
function helpConfig() {
  return {
    sortSubcommands: true,
    showGlobalOptions: true,
  };
}

export async function main(): Promise<void> {
  profileCheckpoint("main_start");

  const program = new Command();

  program
    .name("coders")
    .description("Open-source coding agent CLI with native @hasna/* ecosystem integration")
    .version(`${VERSION} (Coders)`, "-v, --version", "Output the version number")
    .configureHelp(helpConfig())
    // Main options
    .option("-p, --print", "Print mode (non-interactive, stream output)")
    .option("--verbose", "Show detailed debug output")
    .option("--debug", "Enable debug mode")
    .option("--model <model>", "Override the default model")
    .option("--permission-mode <mode>", "Permission mode: default, plan, acceptEdits, dontAsk, auto, bypassPermissions")
    .option("-w, --worktree [name]", "Create a new git worktree for this session")
    .option("--mcp-config <path>", "Path to additional MCP server config")
    .option("--settings <path>", "Path to settings file override")
    .option("--resume [session]", "Resume a previous session")
    .option("--allowed-tools <tools>", "Comma-separated list of allowed tools")
    .option("--disallowed-tools <tools>", "Comma-separated list of disallowed tools")
    // Hidden options (matching Claude Code)
    .addOption(new Option("--dangerously-skip-permissions", "Skip all permission checks").hideHelp())
    .addOption(new Option("--enable-auto-mode", "Opt in to auto mode").hideHelp())
    .addOption(new Option("--brief", "Enable SendMessage tool for agent-to-user communication").hideHelp())
    .addOption(new Option("--agent-id <id>", "Teammate agent ID").hideHelp())
    .addOption(new Option("--agent-name <name>", "Teammate display name").hideHelp())
    .addOption(new Option("--agent-color <color>", "Teammate UI color").hideHelp())
    .addOption(new Option("--team-name <name>", "Team name for coordination").hideHelp())
    .addOption(new Option("--plan-mode-required", "Require plan mode before implementation").hideHelp())
    .addOption(new Option("--parent-session-id <id>", "Parent session ID for correlation").hideHelp())
    .addOption(new Option("--teammate-mode <mode>", 'Spawn mode: "tmux", "in-process", "auto"').choices(["auto", "tmux", "in-process"]).hideHelp())
    .addOption(new Option("--agent-type <type>", "Custom agent type").hideHelp())
    .addOption(new Option("--input-format <format>", "Input format: text, stream-json").hideHelp())
    .addOption(new Option("--output-format <format>", "Output format: text, json, stream-json").hideHelp())
    .addOption(new Option("--system-prompt <prompt>", "Override system prompt").hideHelp())
    .addOption(new Option("--append-system-prompt <prompt>", "Append to system prompt").hideHelp());

  // ── preAction hook: init configs, auth, plugins ──────────────────

  program.hook("preAction", async (_thisCommand, _actionCommand) => {
    profileCheckpoint("preaction_start");
    // TODO: Phase 1 tasks will wire these up:
    // 1. Load config cascade (settings, permissions)
    // 2. Initialize auth (resolve API key)
    // 3. Load MCP servers
    // 4. Load plugins
    // 5. Run migrations
    profileCheckpoint("preaction_complete");
  });

  // ── Main action: interactive or print mode ───────────────────────

  program.action(async (rawOptions: Record<string, unknown>, cmd: Command) => {
    profileCheckpoint("action_start");
    const options = resolveOptions(rawOptions);
    const prompts = cmd.args; // Remaining positional args = initial prompt

    if (options.print) {
      // Headless/print mode
      if (prompts.length === 0) { console.error("Error: --print requires a prompt"); process.exit(1); }
      const { runHeadless } = await import("../ui/app.js");
      await runHeadless({
        model: options.model ?? getSettings().model ?? "sonnet",
        prompt: prompts.join(" "),
        outputFormat: (options.outputFormat as "text" | "json" | "stream-json") ?? "text",
      });
    } else {
      // Interactive mode: full Ink terminal UI
      const { launchInkApp } = await import("../ui/app.js");
      launchInkApp({
        model: options.model,
        mode: options.permissionMode,
        initialPrompt: prompts.length > 0 ? prompts.join(" ") : undefined,
      });
    }
  });

  // ── Subcommand: mcp ──────────────────────────────────────────────

  const mcp = program
    .command("mcp")
    .description("Configure and manage MCP servers")
    .configureHelp(helpConfig());

  mcp.command("serve")
    .description("Start the Coders MCP server")
    .option("-d, --debug", "Enable debug mode")
    .option("--verbose", "Override verbose mode")
    .action(async ({ debug, verbose }) => {
      // TODO: Phase 4 — MCP server
      console.log("MCP server mode — not yet implemented");
    });

  mcp.command("add <name>")
    .description("Add an MCP server (stdio transport)")
    .option("-s, --scope <scope>", "Config scope (local, user, project)", "local")
    .option("--transport <transport>", "Transport type (stdio, sse)", "stdio")
    .argument("[command...]", "Command and args for stdio transport")
    .action(async (name: string, command: string[], options) => {
      console.log(`Adding MCP server '${name}' [${options.transport}] scope=${options.scope}`);
    });

  mcp.command("add-json <name> <json>")
    .description("Add an MCP server with a JSON config string")
    .option("-s, --scope <scope>", "Config scope", "local")
    .action(async (name: string, json: string, options) => {
      console.log(`Adding MCP server '${name}' from JSON`);
    });

  mcp.command("remove <name>")
    .description("Remove an MCP server")
    .option("-s, --scope <scope>", "Remove from specific scope")
    .action(async (name: string) => {
      console.log(`Removing MCP server: ${name}`);
    });

  mcp.command("list")
    .description("List configured MCP servers")
    .action(async () => {
      console.log("No MCP servers configured yet");
    });

  mcp.command("get <name>")
    .description("Get details about an MCP server")
    .action(async (name: string) => {
      console.log(`MCP server '${name}' — not found`);
    });

  // ── Subcommand: auth ─────────────────────────────────────────────

  const auth = program
    .command("auth")
    .description("Manage authentication")
    .configureHelp(helpConfig());

  auth.command("login")
    .description("Sign in to your Anthropic account")
    .option("--email <email>", "Pre-populate email")
    .option("--sso", "Force SSO login")
    .option("--console", "Use Anthropic Console (API billing)")
    .action(async (options) => {
      console.log("Auth login — not yet implemented");
    });

  auth.command("status")
    .description("Show authentication status")
    .option("--json", "Output as JSON")
    .option("--text", "Output as human-readable text")
    .action(async (options) => {
      console.log("Auth status — not yet implemented");
    });

  auth.command("logout")
    .description("Log out from your Anthropic account")
    .action(async () => {
      console.log("Auth logout — not yet implemented");
    });

  // ── Subcommand: plugin ───────────────────────────────────────────

  const plugin = program
    .command("plugin")
    .alias("plugins")
    .description("Manage Coders plugins")
    .configureHelp(helpConfig());

  plugin.command("list")
    .description("List installed plugins")
    .option("--json", "Output as JSON")
    .action(async () => {
      console.log("No plugins installed");
    });

  plugin.command("install <plugin>")
    .alias("i")
    .description("Install a plugin")
    .option("-s, --scope <scope>", "Installation scope", "user")
    .action(async (name: string) => {
      console.log(`Installing plugin: ${name}`);
    });

  plugin.command("uninstall <plugin>")
    .alias("remove")
    .description("Uninstall a plugin")
    .action(async (name: string) => {
      console.log(`Uninstalling plugin: ${name}`);
    });

  plugin.command("validate <path>")
    .description("Validate a plugin manifest")
    .action(async (path: string) => {
      console.log(`Validating plugin at: ${path}`);
    });

  // ── Subcommand: config ───────────────────────────────────────────

  program.command("config")
    .description("View and modify settings")
    .argument("[key]", "Setting key to get/set")
    .argument("[value]", "Value to set")
    .action(async (key?: string, value?: string) => {
      if (key && value) {
        console.log(`Setting ${key} = ${value}`);
      } else if (key) {
        console.log(`Getting ${key} — not yet implemented`);
      } else {
        console.log("Config — use 'coders config <key> [value]'");
      }
    });

  // ── Subcommand: doctor ───────────────────────────────────────────

  program.command("doctor")
    .description("Check the health of your Coders installation")
    .action(async () => {
      console.log(`@hasna/coders v${VERSION}`);
      console.log(`Build: ${BUILD_TIME}`);
      console.log(`Node: ${process.version}`);
      console.log(`Platform: ${process.platform} ${process.arch}`);
      console.log(`CWD: ${process.cwd()}`);
      // TODO: Check auth, MCP servers, config, plugins
      console.log("Status: OK (basic checks only)");
    });

  // ── Subcommand: update ───────────────────────────────────────────

  program.command("update")
    .alias("upgrade")
    .description("Check for updates and install if available")
    .action(async () => {
      console.log("Update check — not yet implemented");
    });

  // ── Subcommand: agents ───────────────────────────────────────────

  program.command("agents")
    .description("List configured agents")
    .action(async () => {
      console.log("No agents configured");
    });

  // ── Parse ────────────────────────────────────────────────────────

  profileCheckpoint("run_before_parse");
  await program.parseAsync(process.argv);
  profileCheckpoint("run_after_parse");
}

// ── Lazy imports for interactive mode ─────────────────────────────

import { getSettings } from "../config/loader.js";

// Old readline REPL removed — now using Ink UI via launchInkApp()
