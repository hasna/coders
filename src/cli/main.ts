/**
 * Main CLI setup — Commander.js program definition
 * Equivalent to Claude Code's KTz() (run function)
 *
 * This file owns the Commander.js program, all subcommands,
 * and the preAction hook that initializes configs/auth/plugins.
 */
import { Command, Option } from "commander";
import { registerEventsCommands } from "@hasna/events/commander";
import { VERSION, BUILD_TIME, PACKAGE_NAME, profileCheckpoint } from "./index.js";
import { resolveOptions } from "./args.js";
import { setProjectRoot, getSettings, getUserSettings, getProjectSettings, saveUserSettings, getConfig, saveConfig } from "../config/loader.js";
import { DEFAULT_SETTINGS } from "../config/settings.js";
import { getUserSettingsPath, getProjectSettingsPath, getConfigDir, getPluginsDir } from "../config/paths.js";
import { getDb } from "../db/index.js";
import { loadHooksFromSettings } from "../hooks/registry.js";
import { resolveApiKey, detectAuthConflicts, saveApiKey, removeApiKey, getApiProvider, type ApiKeySource } from "../auth/api-key.js";
import { removeKeychainApiKey as _removeKeychainApiKey } from "../auth/keychain.js";
import { loadMcpConfigs, loadMcpConfigsWithScope, addMcpServerConfig, removeMcpServerConfig } from "../mcp/config.js";
import type { McpConfigScope } from "../mcp/config.js";
import { loadPlugins, discoverPlugins } from "../plugins/loader.js";
import { registerStorageCommands } from "./storage.js";
import { execSync } from "child_process";
import { existsSync } from "fs";

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

    // 1. Load config cascade (settings, permissions)
    //    Set the project root to CWD so project-level settings are merged in.
    const cwd = process.cwd();
    setProjectRoot(cwd);
    const settings = getSettings();
    profileCheckpoint("preaction_config_loaded");

    // 2. Initialize database (creates schema on first call)
    try {
      getDb();
    } catch (err) {
      // DB is not critical for basic CLI operation — warn and continue
      console.warn("[init] Database initialization failed:", err instanceof Error ? err.message : err);
    }
    profileCheckpoint("preaction_db_initialized");

    // 3. Load hooks from settings
    try {
      if (settings.hooks && typeof settings.hooks === "object") {
        loadHooksFromSettings(settings.hooks as Record<string, any>);
      }
    } catch (err) {
      console.warn("[init] Hook loading failed:", err instanceof Error ? err.message : err);
    }
    profileCheckpoint("preaction_hooks_loaded");

    // 4. Resolve API key (don't fail — interactive mode handles missing keys)
    try {
      const resolved = resolveApiKey();
      if (resolved && process.env.CODERS_DEBUG) {
        console.error(`[init] API key resolved from ${resolved.source}`);
      }
    } catch (err) {
      // Not fatal — the user may not have set up auth yet
      if (process.env.CODERS_DEBUG) {
        console.error("[init] API key resolution failed:", err instanceof Error ? err.message : err);
      }
    }
    profileCheckpoint("preaction_auth_resolved");

    // 5. Load MCP server configs (discovery only — connections happen lazily)
    try {
      const mcpConfigs = loadMcpConfigs(cwd);
      if (mcpConfigs.length > 0 && process.env.CODERS_DEBUG) {
        console.error(`[init] Discovered ${mcpConfigs.length} MCP server config(s)`);
      }
    } catch (err) {
      console.warn("[init] MCP config loading failed:", err instanceof Error ? err.message : err);
    }
    profileCheckpoint("preaction_mcp_loaded");

    // 6. Discover and load plugins from ~/.coders/plugins/
    try {
      const plugins = await loadPlugins();
      if (plugins.length > 0 && process.env.CODERS_DEBUG) {
        const names = plugins.map(p => `${p.name}@${p.version}`).join(", ");
        console.error(`[init] Loaded ${plugins.length} plugin(s): ${names}`);
      }

      // Register hooks from loaded plugins
      for (const plugin of plugins) {
        if (plugin.manifest.hooks && typeof plugin.manifest.hooks === "object") {
          try {
            loadHooksFromSettings(plugin.manifest.hooks as Record<string, any>);
          } catch (hookErr) {
            if (process.env.CODERS_DEBUG) {
              console.error(`[init] Failed to load hooks from plugin "${plugin.name}":`, hookErr instanceof Error ? hookErr.message : hookErr);
            }
          }
        }
      }
    } catch (err) {
      console.warn("[init] Plugin loading failed:", err instanceof Error ? err.message : err);
    }

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
        dangerouslySkipPermissions: options.dangerouslySkipPermissions,
        initialPrompt: prompts.length > 0 ? prompts.join(" ") : undefined,
        resume: options.resume === true ? "last" : options.resume || undefined,
        agentId: options.agentId,
        agentName: options.agentName,
        teamName: options.teamName,
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
      const { runMcpServer } = await import("../mcp/server.js");
      await runMcpServer({ debug, verbose });
    });

  mcp.command("add <name>")
    .description("Add an MCP server (stdio transport)")
    .option("-s, --scope <scope>", "Config scope (local, user, project)", "local")
    .option("--transport <transport>", "Transport type (stdio, sse, streamable-http)", "stdio")
    .option("-e, --env <env...>", "Environment variables (KEY=VALUE)")
    .option("--url <url>", "URL for sse/streamable-http transport")
    .argument("[command...]", "Command and args for stdio transport")
    .action(async (name: string, commandParts: string[], options) => {
      const scope = options.scope as McpConfigScope;
      const transport = options.transport as "stdio" | "sse" | "streamable-http";
      const projectRoot = process.cwd();

      // Parse env vars from --env KEY=VALUE format
      let env: Record<string, string> | undefined;
      if (options.env) {
        env = {};
        for (const pair of options.env as string[]) {
          const eqIdx = pair.indexOf("=");
          if (eqIdx === -1) {
            console.error(`Invalid env format: '${pair}' (expected KEY=VALUE)`);
            process.exit(1);
          }
          env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
        }
      }

      // Validate: stdio needs command, sse/streamable-http needs url
      if (transport === "stdio" && commandParts.length === 0) {
        console.error("Error: stdio transport requires a command. Usage: coders mcp add <name> -- <command> [args...]");
        process.exit(1);
      }
      if ((transport === "sse" || transport === "streamable-http") && !options.url) {
        console.error(`Error: ${transport} transport requires --url`);
        process.exit(1);
      }

      const [command, ...args] = commandParts;

      try {
        addMcpServerConfig(
          name,
          {
            command: transport === "stdio" ? command : undefined,
            args: transport === "stdio" && args.length > 0 ? args : undefined,
            env,
            url: options.url,
            transport,
          },
          scope,
          scope === "project" ? projectRoot : undefined,
        );
        console.log(`Added MCP server '${name}' (${transport}, scope: ${scope})`);
      } catch (err) {
        console.error(`Error adding MCP server:`, err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  mcp.command("add-json <name> <json>")
    .description("Add an MCP server with a JSON config string")
    .option("-s, --scope <scope>", "Config scope", "local")
    .action(async (name: string, json: string, options) => {
      const scope = options.scope as McpConfigScope;
      const projectRoot = process.cwd();

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(json);
      } catch {
        console.error("Error: invalid JSON string");
        process.exit(1);
      }

      const transport = (parsed.transport as string) ?? (parsed.command ? "stdio" : parsed.url ? "sse" : "stdio");

      try {
        addMcpServerConfig(
          name,
          {
            command: parsed.command as string | undefined,
            args: parsed.args as string[] | undefined,
            env: parsed.env as Record<string, string> | undefined,
            url: parsed.url as string | undefined,
            transport: transport as "stdio" | "sse" | "streamable-http",
          },
          scope,
          scope === "project" ? projectRoot : undefined,
        );
        console.log(`Added MCP server '${name}' from JSON (${transport}, scope: ${scope})`);
      } catch (err) {
        console.error(`Error adding MCP server:`, err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  mcp.command("remove <name>")
    .description("Remove an MCP server")
    .option("-s, --scope <scope>", "Remove from specific scope")
    .action(async (name: string, options) => {
      const scope = options.scope as McpConfigScope | undefined;
      const projectRoot = process.cwd();

      const removed = removeMcpServerConfig(name, projectRoot, scope);
      if (removed) {
        console.log(`Removed MCP server '${name}'${scope ? ` from ${scope} scope` : ""}`);
      } else {
        console.error(`MCP server '${name}' not found${scope ? ` in ${scope} scope` : " in any scope"}`);
        process.exit(1);
      }
    });

  mcp.command("list")
    .description("List configured MCP servers")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const projectRoot = process.cwd();
      const configs = loadMcpConfigsWithScope(projectRoot);

      if (configs.length === 0) {
        console.log("No MCP servers configured");
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(configs, null, 2));
        return;
      }

      // Tabular display
      const nameWidth = Math.max(4, ...configs.map(c => c.name.length));
      const transportWidth = Math.max(9, ...configs.map(c => c.transport.length));
      const scopeWidth = Math.max(5, ...configs.map(c => c.scope.length));

      const header = `${"Name".padEnd(nameWidth)}  ${"Transport".padEnd(transportWidth)}  ${"Scope".padEnd(scopeWidth)}  Source`;
      const separator = "-".repeat(header.length + 10);

      console.log(header);
      console.log(separator);

      for (const config of configs) {
        const endpoint = config.command
          ? `${config.command}${config.args?.length ? " " + config.args.join(" ") : ""}`
          : config.url ?? "";
        console.log(
          `${config.name.padEnd(nameWidth)}  ${config.transport.padEnd(transportWidth)}  ${config.scope.padEnd(scopeWidth)}  ${endpoint}`,
        );
      }

      console.log(`\n${configs.length} server(s) configured`);
    });

  mcp.command("get <name>")
    .description("Get details about an MCP server")
    .option("--json", "Output as JSON")
    .action(async (name: string, options) => {
      const projectRoot = process.cwd();
      const configs = loadMcpConfigsWithScope(projectRoot);
      const config = configs.find(c => c.name === name);

      if (!config) {
        console.error(`MCP server '${name}' not found`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      console.log(`Name:       ${config.name}`);
      console.log(`Transport:  ${config.transport}`);
      console.log(`Scope:      ${config.scope}`);
      console.log(`Config:     ${config.configPath}`);
      if (config.command) console.log(`Command:    ${config.command}`);
      if (config.args?.length) console.log(`Args:       ${config.args.join(" ")}`);
      if (config.url) console.log(`URL:        ${config.url}`);
      if (config.env && Object.keys(config.env).length > 0) {
        console.log(`Env:`);
        for (const [k, v] of Object.entries(config.env)) {
          // Mask values for security — show first 4 chars
          const masked = v.length > 8 ? v.slice(0, 4) + "****" : "****";
          console.log(`  ${k}=${masked}`);
        }
      }
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
      // SSO and Console flags are not fully wired yet
      if (options.sso) {
        console.log("SSO login is not yet supported. Please use API key login instead.");
        console.log("Run: coders auth login");
        return;
      }
      if (options.console) {
        console.log("Console OAuth login is not yet supported. Please use API key login instead.");
        console.log("Run: coders auth login");
        return;
      }

      // Check if already authenticated
      const existing = resolveApiKey();
      if (existing) {
        const masked = maskApiKey(existing.apiKey);
        console.log(`Already authenticated via ${formatSource(existing.source)}`);
        console.log(`Active key: ${masked}`);
        console.log("");
        console.log("To use a different key, run 'coders auth logout' first, or enter a new key below.");
        console.log("");
      }

      // Prompt for API key via readline
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stdout });

      try {
        const apiKey = await rl.question("Enter your Anthropic API key (sk-ant-...): ");

        if (!apiKey.trim()) {
          console.error("No API key provided. Aborting.");
          process.exit(1);
        }

        const trimmed = apiKey.trim();

        // Validate key format
        if (!trimmed.startsWith("sk-ant-")) {
          console.warn("Warning: API key does not match expected format (sk-ant-...). Saving anyway.");
        }

        // Validate by making a test API call
        let keyValid = false;
        try {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": trimmed,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1,
              messages: [{ role: "user", content: "hi" }],
            }),
          });
          // 200 or 400 = valid key (authorized), 401/403 = invalid key
          if (response.status === 401 || response.status === 403) {
            console.error(`Error: API key is invalid (${response.status}).`);
            const confirm = await rl.question("Save anyway? (y/N): ");
            if (confirm.trim().toLowerCase() !== "y") {
              console.log("Aborted. No changes made.");
              return;
            }
          } else {
            keyValid = true;
          }
        } catch {
          // Network error — can't validate, save anyway
          console.warn("Warning: Could not validate API key (network error). Saving anyway.");
        }

        // Save the key to config
        saveApiKey(trimmed);

        const masked = maskApiKey(trimmed);
        console.log("");
        console.log(`API key saved: ${masked}`);
        if (keyValid) {
          console.log("Key validated successfully.");
        }
        console.log("Stored in: ~/.coders/.config.json");
      } finally {
        rl.close();
      }
    });

  auth.command("status")
    .description("Show authentication status")
    .option("--json", "Output as JSON")
    .option("--text", "Output as human-readable text")
    .action(async (options) => {
      const resolved = resolveApiKey();
      const conflicts = detectAuthConflicts();
      const provider = getApiProvider();

      if (options.json) {
        const result: Record<string, unknown> = {
          authenticated: !!resolved,
          source: resolved?.source ?? "none",
          isOAuth: resolved?.isOAuth ?? false,
          provider,
          apiKey: resolved ? maskApiKey(resolved.apiKey) : null,
          conflicts: conflicts.length > 0 ? conflicts : undefined,
        };
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Human-readable output
      if (!resolved) {
        console.log("Not authenticated.");
        console.log("");
        console.log("To authenticate, either:");
        console.log("  1. Run: coders auth login");
        console.log("  2. Set ANTHROPIC_API_KEY environment variable");
        return;
      }

      console.log("Authentication Status");
      console.log("---------------------");
      console.log(`  Status:    Authenticated`);
      console.log(`  Source:    ${formatSource(resolved.source)}`);
      console.log(`  API key:   ${maskApiKey(resolved.apiKey)}`);
      console.log(`  Type:      ${resolved.isOAuth ? "OAuth token" : "API key"}`);
      console.log(`  Provider:  ${provider}`);

      if (conflicts.length > 0) {
        console.log("");
        console.log("Warnings:");
        for (const conflict of conflicts) {
          console.log(`  - ${conflict}`);
        }
      }
    });

  auth.command("logout")
    .description("Log out from your Anthropic account")
    .action(async () => {
      const resolved = resolveApiKey();

      if (!resolved) {
        console.log("Not currently authenticated. Nothing to do.");
        return;
      }

      // If the key comes from an environment variable, we can't remove it
      if (resolved.source === "env:ANTHROPIC_API_KEY" || resolved.source === "env:CODERS_OAUTH_TOKEN") {
        console.log(`Your authentication comes from the ${resolved.source.replace("env:", "")} environment variable.`);
        console.log("Unset it from your shell to log out:");
        console.log(`  unset ${resolved.source.replace("env:", "")}`);
        return;
      }

      // Confirm before removing
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stdout });

      try {
        const masked = maskApiKey(resolved.apiKey);
        console.log(`Current auth: ${formatSource(resolved.source)} (${masked})`);
        const confirm = await rl.question("Remove stored credentials? (y/N): ");

        if (confirm.trim().toLowerCase() !== "y") {
          console.log("Aborted. No changes made.");
          return;
        }
      } finally {
        rl.close();
      }

      // Remove API key from config file
      removeApiKey();

      // Remove OAuth tokens from config file
      const config = getConfig();
      if (config.codersOauth) {
        saveConfig("codersOauth", undefined);
      }

      console.log("Logged out successfully.");
      console.log("Removed API key from config file and keychain.");
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
    .option("--builtin", "Include built-in plugins")
    .action(async (options) => {
      const { discoverPlugins: discover, BUILTIN_PLUGINS } = await import("../plugins/loader.js");

      const installed = discover();
      const showBuiltin = options.builtin ?? false;

      if (options.json) {
        const result: Record<string, unknown> = { installed };
        if (showBuiltin) result.builtin = BUILTIN_PLUGINS;
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (installed.length === 0 && !showBuiltin) {
        console.log("No plugins installed.");
        console.log("");
        console.log("Install plugins with: coders plugin install <source>");
        console.log("Plugins directory: ~/.coders/plugins/");
        return;
      }

      if (installed.length > 0) {
        const nameWidth = Math.max(4, ...installed.map(p => p.name.length));
        const versionWidth = Math.max(7, ...installed.map(p => p.version.length));

        console.log(`${"Name".padEnd(nameWidth)}  ${"Version".padEnd(versionWidth)}  Status   Source`);
        console.log("-".repeat(nameWidth + versionWidth + 25));

        for (const p of installed) {
          const status = p.enabled ? "enabled" : "disabled";
          console.log(
            `${p.name.padEnd(nameWidth)}  ${p.version.padEnd(versionWidth)}  ${status.padEnd(8)} ${p.source}`,
          );
        }
        console.log(`\n${installed.length} plugin(s) installed`);
      } else {
        console.log("No user plugins installed.");
      }

      if (showBuiltin && BUILTIN_PLUGINS.length > 0) {
        console.log("");
        console.log("Built-in plugins:");
        for (const bp of BUILTIN_PLUGINS) {
          console.log(`  ${bp.name} v${bp.version} — ${bp.description ?? ""}`);
        }
      }
    });

  plugin.command("install <plugin>")
    .alias("i")
    .description("Install a plugin from a marketplace or local path")
    .option("-s, --scope <scope>", "Installation scope", "user")
    .option("-m, --marketplace <name>", "Marketplace to install from")
    .action(async (source: string, options) => {
      const { resolve, join } = await import("path");
      const { existsSync: pathExists } = await import("fs");

      // Check if source is a local directory with a manifest
      const resolvedPath = resolve(source);
      const isLocalDir = pathExists(resolvedPath) && pathExists(join(resolvedPath, "manifest.json"));

      if (isLocalDir) {
        // Local directory install: copy to plugins dir
        try {
          const { readFileSync, cpSync, mkdirSync } = await import("fs");
          const { PluginManifestSchema } = await import("../plugins/manifest.js");

          const manifestRaw = JSON.parse(readFileSync(join(resolvedPath, "manifest.json"), "utf-8"));
          const result = PluginManifestSchema.safeParse(manifestRaw);

          if (!result.success) {
            console.error("Error: Invalid plugin manifest:");
            for (const issue of result.error.issues) {
              console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
            }
            process.exit(1);
          }

          const pluginName = result.data.name;
          const pluginsDir = getPluginsDir();
          const targetDir = join(pluginsDir, pluginName);

          if (pathExists(targetDir)) {
            console.error(`Error: Plugin "${pluginName}" is already installed.`);
            console.error("Uninstall it first: coders plugin uninstall " + pluginName);
            process.exit(1);
          }

          mkdirSync(targetDir, { recursive: true });
          cpSync(resolvedPath, targetDir, { recursive: true });

          console.log(`Installed plugin "${pluginName}" v${result.data.version} from ${resolvedPath}`);
          console.log(`Location: ${targetDir}`);
        } catch (err) {
          if (err instanceof Error && err.message.includes("process.exit")) throw err;
          console.error("Error installing plugin:", err instanceof Error ? err.message : err);
          process.exit(1);
        }
      } else {
        // Marketplace install
        try {
          const { installFromMarketplace } = await import("../plugins/marketplace.js");
          const result = await installFromMarketplace(source, options.marketplace);

          if (!result.success) {
            console.error(`Error: ${result.error}`);
            process.exit(1);
          }

          console.log(`Installed plugin "${source}" from marketplace`);
        } catch (err) {
          console.error("Error installing plugin:", err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }
    });

  plugin.command("uninstall <plugin>")
    .alias("remove")
    .description("Uninstall a plugin")
    .action(async (name: string) => {
      try {
        const { uninstallPlugin } = await import("../plugins/marketplace.js");
        const removed = await uninstallPlugin(name);

        if (removed) {
          console.log(`Uninstalled plugin "${name}"`);
        } else {
          console.error(`Plugin "${name}" is not installed.`);
          process.exit(1);
        }
      } catch (err) {
        console.error("Error uninstalling plugin:", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  plugin.command("validate <path>")
    .description("Validate a plugin manifest")
    .option("--json", "Output validation result as JSON")
    .action(async (manifestPath: string, options) => {
      try {
        const { existsSync: pathExists, readFileSync } = await import("fs");
        const { resolve, join } = await import("path");
        const { PluginManifestSchema } = await import("../plugins/manifest.js");

        const resolvedPath = resolve(manifestPath);

        // Accept either a directory (look for manifest.json inside) or a file path
        let filePath: string;
        if (pathExists(join(resolvedPath, "manifest.json"))) {
          filePath = join(resolvedPath, "manifest.json");
        } else if (pathExists(resolvedPath)) {
          filePath = resolvedPath;
        } else {
          console.error(`Error: Path not found: ${resolvedPath}`);
          process.exit(1);
          return; // unreachable, but helps TS
        }

        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(filePath, "utf-8"));
        } catch {
          console.error(`Error: Could not parse JSON from ${filePath}`);
          process.exit(1);
          return;
        }

        const result = PluginManifestSchema.safeParse(raw);

        if (options.json) {
          console.log(JSON.stringify({
            valid: result.success,
            path: filePath,
            errors: result.success ? [] : result.error.issues.map(i => ({
              path: i.path.join("."),
              message: i.message,
            })),
            manifest: result.success ? result.data : undefined,
          }, null, 2));
          return;
        }

        if (result.success) {
          console.log(`Valid plugin manifest: ${filePath}`);
          console.log(`  Name:        ${result.data.name}`);
          console.log(`  Version:     ${result.data.version}`);
          if (result.data.description) console.log(`  Description: ${result.data.description}`);
          if (result.data.author) console.log(`  Author:      ${result.data.author}`);
          if (result.data.commands?.length) console.log(`  Commands:    ${result.data.commands.length}`);
          if (result.data.skills?.length) console.log(`  Skills:      ${result.data.skills.length}`);
          if (result.data.mcpServers && Object.keys(result.data.mcpServers).length > 0) {
            console.log(`  MCP Servers: ${Object.keys(result.data.mcpServers).length}`);
          }
          if (result.data.hooks && Object.keys(result.data.hooks).length > 0) {
            console.log(`  Hooks:       ${Object.keys(result.data.hooks).length}`);
          }
        } else {
          console.error(`Invalid plugin manifest: ${filePath}`);
          console.error("");
          for (const issue of result.error.issues) {
            console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
          }
          process.exit(1);
        }
      } catch (err) {
        // Don't catch process.exit calls
        if (err && typeof err === "object" && "code" in err) throw err;
        console.error("Error validating plugin:", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── Subcommand: config ───────────────────────────────────────────

  program.command("config")
    .description("View and modify settings")
    .argument("[key]", "Setting key to get/set (supports dotted keys like thinking.enabled)")
    .argument("[value]", "Value to set (saved to user config)")
    .option("--json", "Output as JSON")
    .action(async (key?: string, value?: string, options?: { json?: boolean }) => {
      if (key && value !== undefined && value !== null) {
        // ── SET: coders config <key> <value> ──
        configSet(key, value);
      } else if (key) {
        // ── GET: coders config <key> ──
        configGet(key, options?.json ?? false);
      } else {
        // ── LIST: coders config ──
        configList(options?.json ?? false);
      }
    });

  registerStorageCommands(program);

  // ── Subcommand: doctor ───────────────────────────────────────────

  program.command("doctor")
    .description("Check the health of your Coders installation")
    .action(async () => {
      const ok = "\x1b[32m\u2713\x1b[0m";   // green checkmark
      const fail = "\x1b[31m\u2717\x1b[0m";  // red X
      let issues = 0;

      // ── A) System info ──────────────────────────────────────────
      console.log("\x1b[1mCoders Doctor\x1b[0m");
      console.log("=============\n");
      console.log(`  Version:   @hasna/coders v${VERSION}`);
      console.log(`  Build:     ${BUILD_TIME}`);
      console.log(`  Node:      ${process.version}`);
      console.log(`  Platform:  ${process.platform} ${process.arch}`);
      console.log(`  CWD:       ${process.cwd()}`);
      console.log("");

      // ── B) Auth check ───────────────────────────────────────────
      try {
        const resolved = resolveApiKey();
        if (resolved) {
          const masked = maskApiKey(resolved.apiKey);
          console.log(`  ${ok} Auth: ${masked} (via ${formatSource(resolved.source)})`);
        } else {
          console.log(`  ${fail} Auth: not configured`);
          issues++;
        }
      } catch (err) {
        console.log(`  ${fail} Auth: error — ${err instanceof Error ? err.message : err}`);
        issues++;
      }

      // ── C) Database check ───────────────────────────────────────
      try {
        const db = getDb();
        if (db) {
          const dbPath = `${getConfigDir()}/coders.db`;
          console.log(`  ${ok} Database: ${dbPath}`);
        } else {
          console.log(`  ${fail} Database: initialization returned null`);
          issues++;
        }
      } catch (err) {
        console.log(`  ${fail} Database: ${err instanceof Error ? err.message : err}`);
        issues++;
      }

      // ── D) Config check ─────────────────────────────────────────
      try {
        const userSettingsPath = getUserSettingsPath();
        const projectSettingsPath = getProjectSettingsPath(process.cwd());
        const userExists = existsSync(userSettingsPath);
        const projectExists = existsSync(projectSettingsPath);

        const parts: string[] = [];
        if (userExists) parts.push("user");
        if (projectExists) parts.push("project");

        if (parts.length > 0) {
          console.log(`  ${ok} Config: loaded (${parts.join(", ")})`);
        } else {
          console.log(`  ${ok} Config: defaults (no user/project overrides)`);
        }
        console.log(`       User:    ${userSettingsPath}${userExists ? "" : " (not found)"}`);
        console.log(`       Project: ${projectSettingsPath}${projectExists ? "" : " (not found)"}`);
      } catch (err) {
        console.log(`  ${fail} Config: ${err instanceof Error ? err.message : err}`);
        issues++;
      }

      // ── E) MCP servers check ────────────────────────────────────
      try {
        const mcpConfigs = loadMcpConfigsWithScope(process.cwd());
        if (mcpConfigs.length > 0) {
          console.log(`  ${ok} MCP servers: ${mcpConfigs.length} configured`);
          for (const cfg of mcpConfigs) {
            const endpoint = cfg.command
              ? `${cfg.command}${cfg.args?.length ? " " + cfg.args.join(" ") : ""}`
              : cfg.url ?? "";
            console.log(`       - ${cfg.name} (${cfg.scope}) ${endpoint}`);
          }
        } else {
          console.log(`  ${ok} MCP servers: none configured`);
        }
      } catch (err) {
        console.log(`  ${fail} MCP servers: ${err instanceof Error ? err.message : err}`);
        issues++;
      }

      // ── F) Git check ────────────────────────────────────────────
      try {
        const gitVersion = execSync("git --version", { encoding: "utf-8", timeout: 5000 }).trim();
        console.log(`  ${ok} Git: ${gitVersion.replace("git version ", "")}`);
      } catch {
        console.log(`  ${fail} Git: not found in PATH`);
        issues++;
      }

      // ── G) Plugin check ─────────────────────────────────────────
      try {
        const pluginsDir = getPluginsDir();
        const dirExists = existsSync(pluginsDir);
        if (dirExists) {
          const discovered = discoverPlugins();
          if (discovered.length > 0) {
            console.log(`  ${ok} Plugins: ${discovered.length} installed`);
            for (const p of discovered) {
              console.log(`       - ${p.name} v${p.version}${p.enabled ? "" : " (disabled)"}`);
            }
          } else {
            console.log(`  ${ok} Plugins: none installed (${pluginsDir})`);
          }
        } else {
          console.log(`  ${ok} Plugins: directory not created yet`);
        }
      } catch (err) {
        console.log(`  ${fail} Plugins: ${err instanceof Error ? err.message : err}`);
        issues++;
      }

      // ── H) Ripgrep check ───────────────────────────────────────
      try {
        const rgVersion = execSync("rg --version", { encoding: "utf-8", timeout: 5000 }).split("\n")[0].trim();
        console.log(`  ${ok} Ripgrep: ${rgVersion.replace("ripgrep ", "")}`);
      } catch {
        console.log(`  ${fail} Ripgrep: not found in PATH (needed for Grep tool)`);
        issues++;
      }

      // ── Summary ─────────────────────────────────────────────────
      console.log("");
      if (issues === 0) {
        console.log(`\x1b[32mAll checks passed.\x1b[0m`);
      } else {
        console.log(`\x1b[33m${issues} issue${issues > 1 ? "s" : ""} found.\x1b[0m`);
      }
    });

  // ── Subcommand: update ───────────────────────────────────────────

  program.command("update")
    .alias("upgrade")
    .description("Check for updates and install if available")
    .option("-y, --yes", "Skip confirmation and install automatically")
    .action(async (options: { yes?: boolean }) => {
      const currentVersion = VERSION;
      console.log(`Current version: ${currentVersion}`);
      console.log("Checking for updates...\n");

      // Fetch latest version from npm registry
      let latestVersion: string;
      try {
        latestVersion = execSync(`npm view ${PACKAGE_NAME} version`, {
          encoding: "utf-8",
          timeout: 15000,
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
      } catch (err) {
        console.error("Failed to check for updates.");
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
        return; // unreachable, helps TS
      }

      if (!latestVersion) {
        console.error("Could not determine the latest version from the npm registry.");
        process.exit(1);
        return;
      }

      // Compare versions (simple semver comparison)
      const parseSemver = (v: string) => {
        const parts = v.replace(/^v/, "").split(".").map(Number);
        return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0 };
      };

      const current = parseSemver(currentVersion);
      const latest = parseSemver(latestVersion);

      const isNewer =
        latest.major > current.major ||
        (latest.major === current.major && latest.minor > current.minor) ||
        (latest.major === current.major && latest.minor === current.minor && latest.patch > current.patch);

      if (!isNewer) {
        console.log(`Already up to date (v${currentVersion}).`);
        return;
      }

      console.log(`New version available: ${currentVersion} → ${latestVersion}\n`);

      // Confirm unless --yes flag is set
      if (!options.yes) {
        const { createInterface } = await import("node:readline/promises");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          const answer = await rl.question("Install update? (Y/n): ");
          if (answer.trim().toLowerCase() === "n") {
            console.log("Update cancelled.");
            return;
          }
        } finally {
          rl.close();
        }
      }

      // Detect package manager — prefer the one used to install globally
      let installCmd: string;
      try {
        // Check if bun is available and if the package was installed via bun
        execSync("bun --version", { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
        installCmd = `bun install -g ${PACKAGE_NAME}@latest`;
      } catch {
        installCmd = `npm install -g ${PACKAGE_NAME}@latest`;
      }

      console.log(`Running: ${installCmd}\n`);

      try {
        execSync(installCmd, { encoding: "utf-8", timeout: 120000, stdio: "inherit" });
        console.log(`\nSuccessfully updated to v${latestVersion}.`);
      } catch (err) {
        console.error("\nUpdate failed.");
        console.error(err instanceof Error ? err.message : String(err));
        console.error(`\nYou can try manually: ${installCmd}`);
        process.exit(1);
      }
    });

  // ── Subcommand: agents ───────────────────────────────────────────

  program.command("agents")
    .description("List configured agents")
    .action(async () => {
      console.log("No agents configured");
    });

  // ── Subcommand: dashboard ─────────────────────────────────────────

  program.command("dashboard")
    .description("Launch the web dashboard for managing open-coders")
    .option("-p, --port <port>", "Port to listen on", "7077")
    .action(async (opts) => {
      const { startDashboard } = await import("../web/server.js");
      startDashboard(parseInt(opts.port, 10));
    });

  // ── Subcommand: exec ────────────────────────────────────────────

  program.command("exec")
    .description("Run a prompt headlessly (non-interactive, streams to stdout)")
    .argument("<prompt...>", "The prompt to execute")
    .option("--model <model>", "Model to use", "sonnet")
    .option("--json", "Output as JSON")
    .action(async (promptArgs: string[], opts) => {
      const { runHeadless } = await import("../ui/app.js");
      await runHeadless({
        model: opts.model ?? "sonnet",
        prompt: promptArgs.join(" "),
        outputFormat: opts.json ? "json" : "text",
      });
    });

  // ── Parse ────────────────────────────────────────────────────────

  profileCheckpoint("run_before_parse");
registerEventsCommands(program, { source: "coders" });

  await program.parseAsync(process.argv);
  profileCheckpoint("run_after_parse");
}

// ── Config helpers ──────────────────────────────────────────────────

/** Resolve a dotted key path into a value from an object. e.g. "thinking.enabled" */
function getNestedValue(obj: Record<string, unknown>, keyPath: string): unknown {
  const parts = keyPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a dotted key path on an object. e.g. "thinking.enabled" → { thinking: { enabled: val } } */
function setNestedValue(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const parts = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || current[part] === null || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** Parse a CLI value string into the appropriate JS type. */
function parseValue(raw: string): unknown {
  // Booleans
  if (raw === "true") return true;
  if (raw === "false") return false;
  // Null
  if (raw === "null") return null;
  // Numbers (integers and floats)
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  // JSON objects/arrays
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try { return JSON.parse(raw); } catch { /* fall through to string */ }
  }
  // Default: string
  return raw;
}

/** Determine the source of a setting value: "project", "user", or "default". */
function getSource(key: string, _merged: unknown, user: unknown, project: unknown, defaults: unknown): string {
  const projectVal = getNestedValue(project as Record<string, unknown>, key);
  if (projectVal !== undefined) return "project";
  const userVal = getNestedValue(user as Record<string, unknown>, key);
  if (userVal !== undefined) return "user";
  const defaultVal = getNestedValue(defaults as Record<string, unknown>, key);
  if (defaultVal !== undefined) return "default";
  return "default";
}

/** Format a value for display — truncate long objects. */
function formatValue(val: unknown): string {
  if (val === undefined) return "(not set)";
  if (val === null) return "null";
  if (typeof val === "object") {
    const json = JSON.stringify(val);
    return json.length > 80 ? json.slice(0, 77) + "..." : json;
  }
  return String(val);
}

/** Flatten an object into dotted key paths. e.g. { a: { b: 1 } } → [["a.b", 1]] */
function flattenObject(obj: Record<string, unknown>, prefix = ""): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      entries.push(...flattenObject(value as Record<string, unknown>, fullKey));
    } else {
      entries.push([fullKey, value]);
    }
  }
  return entries;
}

/** coders config — list all settings with source info */
function configList(asJson: boolean): void {
  const merged = getSettings();
  const user = getUserSettings();
  const project = getProjectSettings();
  const defaults = DEFAULT_SETTINGS;

  if (asJson) {
    const result: Record<string, { value: unknown; source: string }> = {};
    for (const [key, value] of flattenObject(merged as Record<string, unknown>)) {
      result[key] = { value, source: getSource(key, merged, user, project, defaults) };
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Tabular display
  const entries = flattenObject(merged as Record<string, unknown>);
  const keyWidth = Math.max(3, ...entries.map(([k]) => k.length));
  const sourceWidth = 7; // "project" is the longest

  console.log(`${"Key".padEnd(keyWidth)}  ${"Source".padEnd(sourceWidth)}  Value`);
  console.log("-".repeat(keyWidth + sourceWidth + 20));

  for (const [key, value] of entries) {
    const source = getSource(key, merged, user, project, defaults);
    console.log(`${key.padEnd(keyWidth)}  ${source.padEnd(sourceWidth)}  ${formatValue(value)}`);
  }

  console.log(`\nUser config:    ${getUserSettingsPath()}`);
  console.log(`Project config: ${getProjectSettingsPath(process.cwd())}`);
}

/** coders config <key> — get a specific setting */
function configGet(key: string, asJson: boolean): void {
  const merged = getSettings();
  const value = getNestedValue(merged as Record<string, unknown>, key);

  if (value === undefined) {
    console.error(`Unknown setting: ${key}`);
    process.exit(1);
  }

  if (asJson) {
    const user = getUserSettings();
    const project = getProjectSettings();
    const source = getSource(key, merged, user, project, DEFAULT_SETTINGS);
    console.log(JSON.stringify({ key, value, source }, null, 2));
    return;
  }

  // For simple values, just print the value (useful for scripting)
  if (typeof value !== "object" || value === null) {
    console.log(String(value));
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}

/** coders config <key> <value> — set a setting in user config */
function configSet(key: string, rawValue: string): void {
  const parsed = parseValue(rawValue);
  const currentUser = getUserSettings() as Record<string, unknown>;

  // Build a partial settings object with the nested key
  const patch: Record<string, unknown> = { ...currentUser };
  setNestedValue(patch, key, parsed);

  saveUserSettings(patch);
  console.log(`Set ${key} = ${formatValue(parsed)} (saved to ${getUserSettingsPath()})`);
}

// ── Auth display helpers ──────────────────────────────────────────

/** Mask an API key for display: sk-ant-api03-...XXXX */
function maskApiKey(key: string): string {
  if (key.length <= 12) return "****";
  const prefix = key.slice(0, 10);
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}

/** Format an ApiKeySource for human-readable display */
function formatSource(source: ApiKeySource): string {
  switch (source) {
    case "env:CODERS_OAUTH_TOKEN": return "CODERS_OAUTH_TOKEN environment variable";
    case "env:ANTHROPIC_API_KEY": return "ANTHROPIC_API_KEY environment variable";
    case "keychain": return "system keychain";
    case "config:primaryApiKey": return "config file (~/.coders/.config.json)";
    case "config:codersOauth": return "OAuth tokens (config file)";
    case "none": return "none";
  }
}

// Old readline REPL removed — now using Ink UI via launchInkApp()
