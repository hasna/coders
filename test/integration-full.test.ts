/**
 * Full integration test — exercises every module end-to-end
 *
 * Tests the complete flow: CLI → Config → Auth → API → Tools → UI → MCP → Integrations
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync, execFileSync } from "child_process";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Test workspace ─────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), "coders-integration-test");
const CLI_PATH = join(process.cwd(), "src/cli/index.ts");

function runCLI(args: string, opts?: { cwd?: string; env?: Record<string, string> }): string {
  return execSync(`npx tsx ${CLI_PATH} ${args}`, {
    encoding: "utf-8",
    cwd: opts?.cwd ?? TEST_DIR,
    env: { ...process.env, ...opts?.env },
    timeout: 10_000,
    stdio: "pipe",
  }).trim();
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

// ── 1. CLI Module ──────────────────────────────────────────────────

describe("CLI Integration", () => {
  it("--version prints version", () => {
    const out = runCLI("--version");
    expect(out).toMatch(/^\d+\.\d+\.\d+ \(Coders\)$/);
  });

  it("--help shows all commands", () => {
    const out = runCLI("--help");
    expect(out).toContain("coders");
    expect(out).toContain("mcp");
    expect(out).toContain("auth");
    expect(out).toContain("config");
    expect(out).toContain("doctor");
    expect(out).toContain("update");
  });

  it("doctor shows system info", () => {
    const out = runCLI("doctor");
    expect(out).toContain("@hasna/coders");
    expect(out).toContain("Node:");
    expect(out).toContain("Platform:");
  });

  it("mcp list works", () => {
    const out = runCLI("mcp list");
    expect(out).toContain("No MCP servers") || expect(out.length).toBeGreaterThan(0);
  });

  it("auth status works", () => {
    const out = runCLI("auth status");
    expect(out).toContain("Auth status");
  });
});

// ── 2. Config Module ───────────────────────────────────────────────

describe("Config Integration", () => {
  it("loads settings without error", async () => {
    const { getSettings, resetConfigCache } = await import("../src/config/loader.js");
    resetConfigCache();
    const settings = getSettings();
    expect(settings).toBeTruthy();
    expect(typeof settings.autoCompactEnabled).toBe("boolean");
  });

  it("config cascade merges user + defaults", async () => {
    const { getSettings, resetConfigCache } = await import("../src/config/loader.js");
    resetConfigCache();
    const settings = getSettings();
    // autoCompactEnabled defaults to true
    expect(settings.autoCompactEnabled).toBe(true);
  });

  it("permissions default to 'default' mode", async () => {
    const { createDefaultPermissionContext } = await import("../src/config/permissions.js");
    const ctx = createDefaultPermissionContext();
    expect(ctx.mode).toBe("default");
  });

  it("config paths resolve correctly", async () => {
    const { getConfigDir, getSessionsDir } = await import("../src/config/paths.js");
    expect(getConfigDir()).toBeTruthy();
    expect(getSessionsDir()).toContain("sessions");
  });
});

// ── 3. Auth Module ─────────────────────────────────────────────────

describe("Auth Integration", () => {
  it("resolves API key from env", async () => {
    const { resolveApiKey } = await import("../src/auth/api-key.js");
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test-integration-key";
    const resolved = resolveApiKey();
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe("env:ANTHROPIC_API_KEY");
    if (original) process.env.ANTHROPIC_API_KEY = original;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it("detects 30+ secret patterns", async () => {
    const { SECRET_PATTERNS, detectSecrets } = await import("../src/auth/secrets.js");
    expect(SECRET_PATTERNS.length).toBeGreaterThanOrEqual(30);
    expect(detectSecrets("AKIAIOSFODNN7EXAMPLE")).toContain("aws-access-key");
    expect(detectSecrets("-----BEGIN RSA PRIVATE KEY-----")).toContain("ssh-private-key");
    expect(detectSecrets("normal text")).toEqual([]);
  });

  it("generates PKCE challenge", async () => {
    const { generateCodeVerifier, generateCodeChallenge } = await import("../src/auth/oauth.js");
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(verifier.length).toBeGreaterThan(30);
    expect(challenge).not.toBe(verifier);
  });
});

// ── 4. API Module ──────────────────────────────────────────────────

describe("API Integration", () => {
  it("resolves all model aliases", async () => {
    const { resolveModelId, MODEL_REGISTRY } = await import("../src/api/models.js");
    // Test every alias
    for (const [alias, entry] of Object.entries(MODEL_REGISTRY)) {
      const resolved = resolveModelId(alias, "firstParty");
      expect(resolved).toBe(entry.variants.firstParty);
    }
    // User aliases
    expect(resolveModelId("sonnet")).toContain("claude-sonnet");
    expect(resolveModelId("opus")).toContain("claude-opus");
    expect(resolveModelId("haiku")).toContain("claude-haiku");
  });

  it("all 5 providers are available", async () => {
    const { getAvailableProviders } = await import("../src/api/providers/index.js");
    const providers = getAvailableProviders();
    expect(providers).toContain("anthropic");
    expect(providers).toContain("bedrock");
    expect(providers).toContain("vertex");
    expect(providers).toContain("openai");
    expect(providers).toContain("ollama");
  });

  it("OpenAI adapter transforms messages correctly", async () => {
    const { OpenAIAdapter } = await import("../src/api/providers/openai.js");
    const adapter = new OpenAIAdapter();
    const body = adapter.buildRequestBody({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
      system: "Be helpful",
      tools: [{ name: "Bash", description: "Run commands", input_schema: { type: "object" } }],
    });
    const msgs = body.messages as Array<Record<string, unknown>>;
    expect(msgs[0]).toEqual({ role: "system", content: "Be helpful" });
    expect(msgs[1]).toEqual({ role: "user", content: "Hello" });
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools[0]).toHaveProperty("type", "function");
  });

  it("cost estimation is accurate", async () => {
    const { estimateCost } = await import("../src/api/streaming.js");
    const cost = estimateCost({ inputTokens: 1_000_000, outputTokens: 100_000 }, "claude-sonnet-4-6");
    expect(cost.inputCostUsd).toBe(3.0);
    expect(cost.outputCostUsd).toBe(1.5);
  });
});

// ── 5. Tools Module ────────────────────────────────────────────────

describe("Tools Integration", () => {
  it("tool registry supports full lifecycle", async () => {
    const {
      registerTool, getTool, getEnabledTools, searchTools,
      registerDeferredTool, loadDeferredTool, resetRegistry,
    } = await import("../src/tools/registry.js");
    const { z } = await import("zod");

    resetRegistry();

    // Register a mock tool
    const mockTool: any = {
      name: "IntegrationTestTool",
      searchHint: "test tool for integration",
      maxResultSizeChars: 100000,
      shouldDefer: false,
      description: async () => "test",
      prompt: async () => "test",
      get inputSchema() { return z.object({}); },
      get outputSchema() { return z.object({}); },
      userFacingName: () => "Test",
      isEnabled: () => true,
      isConcurrencySafe: () => true,
      isReadOnly: () => true,
      toAutoClassifierInput: () => "",
      checkPermissions: async () => ({ behavior: "allow" as const }),
      validateInput: async () => ({ result: true }),
      call: async () => ({ data: {} }),
      mapToolResultToToolResultBlockParam: (r: any, id: string) => ({ type: "tool_result" as const, tool_use_id: id, content: "ok" }),
    };

    registerTool(mockTool);
    expect(getTool("IntegrationTestTool")).toBeTruthy();
    expect(getEnabledTools().some(t => t.name === "IntegrationTestTool")).toBe(true);
    expect(searchTools("integration").some(r => r.name === "IntegrationTestTool")).toBe(true);

    // Deferred tool
    registerDeferredTool({
      name: "DeferredTest",
      searchHint: "deferred",
      description: "deferred test",
      loader: async () => ({ ...mockTool, name: "DeferredTest" }),
    });
    expect(searchTools("deferred").some(r => r.deferred)).toBe(true);
    const loaded = await loadDeferredTool("DeferredTest");
    expect(loaded).toBeTruthy();

    resetRegistry();
  });

  it("Bash tool executes real commands", async () => {
    const { bashTool } = await import("../src/tools/builtin/bash.js");
    const ctx: any = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default", allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {},
    };

    const result = await bashTool.call({ command: "echo integration_test_123" }, ctx);
    expect(result.data.stdout).toContain("integration_test_123");
    expect(result.data.exitCode).toBe(0);
  });

  it("Read/Edit/Write cycle works end-to-end", async () => {
    const { readTool, clearReadHistory } = await import("../src/tools/builtin/read.js");
    const { editTool } = await import("../src/tools/builtin/edit.js");
    const { writeTool } = await import("../src/tools/builtin/write.js");

    clearReadHistory();
    const testFile = join(TEST_DIR, "rw-test.txt");
    const ctx: any = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default", allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {},
    };

    // Write a new file
    await writeTool.call({ file_path: testFile, content: "hello world\nline two\n" }, ctx);
    expect(existsSync(testFile)).toBe(true);

    // Read it
    const readResult = await readTool.call({ file_path: testFile }, ctx);
    expect(readResult.data.content).toContain("hello world");
    expect(readResult.data.content).toContain("line two");

    // Edit it
    const editResult = await editTool.call({
      file_path: testFile, old_string: "hello world", new_string: "HELLO WORLD",
    }, ctx);
    expect(editResult.data.replacements).toBe(1);

    // Verify edit
    const verifyResult = await readTool.call({ file_path: testFile }, ctx);
    expect(verifyResult.data.content).toContain("HELLO WORLD");
    expect(verifyResult.data.content).not.toContain("\thello world");
  });

  it("Glob finds files", async () => {
    const { globTool } = await import("../src/tools/builtin/glob.js");
    const ctx: any = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default", allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {},
    };

    const result = await globTool.call({ pattern: "src/**/*.ts" }, ctx);
    expect(result.data.files.length).toBeGreaterThan(20);
  });

  it("Grep searches content", async () => {
    const { grepTool } = await import("../src/tools/builtin/grep.js");
    const ctx: any = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default", allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {},
    };

    const result = await grepTool.call({ pattern: "BASH_TOOL", path: "src/core/constants.ts" }, ctx);
    expect(result.data.matchCount).toBeGreaterThan(0);
  });

  it("Task tools CRUD cycle works", async () => {
    const { taskCreateTool } = await import("../src/tools/builtin/tasks.js");
    const { taskGetTool } = await import("../src/tools/builtin/tasks.js");
    const { taskListTool } = await import("../src/tools/builtin/tasks.js");
    const { taskUpdateTool } = await import("../src/tools/builtin/tasks.js");
    const { resetTodosIntegration } = await import("../src/integrations/todos.js");

    resetTodosIntegration();
    const ctx: any = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default", allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {},
    };

    // Create
    const created = await taskCreateTool.call({ subject: "Integration test task", description: "Testing full CRUD" }, ctx);
    const id = created.data.task.id;
    expect(id).toBeTruthy();

    // Get
    const got = await taskGetTool.call({ taskId: id }, ctx);
    expect(got.data.task).not.toBeNull();
    expect(got.data.task!.subject).toBe("Integration test task");

    // Update
    const updated = await taskUpdateTool.call({ taskId: id, status: "completed" }, ctx);
    expect(updated.data.success).toBe(true);

    // List
    const list = await taskListTool.call({} as any, ctx);
    expect(list.data.tasks.some(t => t.id === id && t.status === "completed")).toBe(true);
  });

  it("permission modes work correctly", async () => {
    const { checkToolPermission, createDefaultPermissionContext, enterPlanMode } = await import("../src/config/permissions.js");

    // Default mode: passthrough for everything
    const defaultCtx = createDefaultPermissionContext();
    expect(checkToolPermission("Read", {}, defaultCtx).behavior).toBe("passthrough");

    // Plan mode: passthrough (tool-level isReadOnly decides)
    const planCtx = enterPlanMode(defaultCtx);
    expect(planCtx.mode).toBe("plan");

    // Bypass mode: allow everything
    const bypassCtx = { ...defaultCtx, mode: "bypassPermissions" as const };
    expect(checkToolPermission("Bash", { command: "rm -rf /" }, bypassCtx).behavior).toBe("allow");
  });
});

// ── 6. UI Module ───────────────────────────────────────────────────

describe("UI Integration", () => {
  it("screen buffer renders and diffs", async () => {
    const { createScreen } = await import("../src/ui/screen/buffer.js");
    const { renderFullFrame, renderDiff } = await import("../src/ui/screen/renderer.js");

    const buf1 = createScreen(40, 10);
    buf1.writeString(0, 0, "Hello, World!");
    const frame1 = renderFullFrame(buf1);
    expect(frame1).toContain("Hello");

    const buf2 = createScreen(40, 10);
    buf2.writeString(0, 0, "Goodbye, World!");
    const diff = renderDiff(buf2, buf1);
    expect(diff.length).toBeGreaterThan(0);
  });

  it("keybindings resolve correctly", async () => {
    const { KeybindingManager, parseKeyEvent } = await import("../src/ui/keybindings.js");
    const mgr = new KeybindingManager();

    // ctrl+c = interrupt
    expect(mgr.getAction(parseKeyEvent("\x03"))).toBe("interrupt");
    // ctrl+d = exit
    expect(mgr.getAction(parseKeyEvent("\x04"))).toBe("exit");
    // escape = unbound in Global
    expect(mgr.getAction(parseKeyEvent("\x1b"))).toBeNull();

    // Push Chat context
    mgr.pushContext("Chat");
    expect(mgr.getAction(parseKeyEvent("\r"))).toBe("submit");
  });

  it("markdown renders all elements", async () => {
    const { renderMarkdown } = await import("../src/ui/components/markdown.js");
    const md = `# Heading
**bold** and *italic*
\`\`\`typescript
const x = 1;
\`\`\`
- list item
> blockquote
---`;
    const out = renderMarkdown(md);
    expect(out).toContain("Heading");
    expect(out).toContain("bold");
    expect(out).toContain("const");
    expect(out).toContain("list item");
    expect(out).toContain("blockquote");
    expect(out).toContain("─");
  });

  it("terminal detection returns valid caps", async () => {
    const { detectTerminal } = await import("../src/ui/screen/terminal.js");
    const caps = detectTerminal();
    expect(caps.name).toBeTruthy();
    expect([1, 4, 8, 24]).toContain(caps.colorDepth);
  });

  it("themes are available", async () => {
    const { getTheme, getAvailableThemes } = await import("../src/ui/themes.js");
    expect(getAvailableThemes().length).toBeGreaterThanOrEqual(3);
    expect(getTheme("dark").colors.primary).toBeTruthy();
  });
});

// ── 7. MCP Module ──────────────────────────────────────────────────

describe("MCP Integration", () => {
  it("MCP server creates successfully", async () => {
    const { createMcpServer } = await import("../src/mcp/server.js");
    const server = await createMcpServer({ debug: false });
    expect(server).toBeTruthy();
  });

  it("MCP config loads from all sources", async () => {
    const { loadMcpConfigs } = await import("../src/mcp/config.js");
    const configs = loadMcpConfigs(TEST_DIR);
    expect(Array.isArray(configs)).toBe(true);
  });
});

// ── 8. Integrations Module ─────────────────────────────────────────

describe("Integrations", () => {
  it("TodosIntegration full lifecycle", async () => {
    const { TodosIntegration } = await import("../src/integrations/todos.js");
    const todos = new TodosIntegration();

    const task = await todos.createTask({ subject: "Test", description: "Full lifecycle" });
    await todos.updateTask(task.id, { status: "in_progress" });
    const fetched = await todos.getTask(task.id);
    expect(fetched!.status).toBe("in_progress");
    await todos.completeTask(task.id);
    const completed = await todos.getTask(task.id);
    expect(completed!.status).toBe("completed");

    const stats = await todos.getStats();
    expect(stats.completed).toBeGreaterThanOrEqual(1);
  });

  it("ConversationsIntegration messaging", async () => {
    const { ConversationsIntegration } = await import("../src/integrations/conversations.js");
    const convos = new ConversationsIntegration({ agentName: "test-agent", sessionId: "test" });

    await convos.registerAgent("tester");
    await convos.createSpace("test-space");
    await convos.sendToSpace("test-space", "Hello from integration test");
    const msgs = await convos.readSpaceMessages("test-space");
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toContain("integration test");
    convos.destroy();
  });

  it("MementosIntegration memory lifecycle", async () => {
    const { MementosIntegration } = await import("../src/integrations/mementos.js");
    const mem = new MementosIntegration();

    await mem.save({ key: "test-key", value: "test-value", importance: 8, tags: ["test"] });
    const result = await mem.get("test-key");
    expect(result!.value).toBe("test-value");

    const searched = await mem.search("test");
    expect(searched.length).toBeGreaterThan(0);

    await mem.forget("test-key");
    expect(await mem.get("test-key")).toBeNull();
  });

  it("Ecosystem integrations are registered", async () => {
    const { getAllIntegrationStatuses } = await import("../src/integrations/ecosystem.js");
    const statuses = getAllIntegrationStatuses();
    expect(statuses.length).toBe(10);
    expect(statuses.every(s => s.packageName.startsWith("@hasna/"))).toBe(true);
  });
});

// ── 9. Advanced Features ───────────────────────────────────────────

describe("Advanced Features", () => {
  it("speculation engine lifecycle", async () => {
    const { startSpeculation, stopSpeculation, getSpeculationState, canSpeculateOnTool } = await import("../src/core/speculation.js");

    startSpeculation();
    expect(getSpeculationState().active).toBe(true);
    expect(canSpeculateOnTool("Read", { mode: "default" as any, allowRules: [], denyRules: [] })).toBe(true);
    expect(canSpeculateOnTool("Bash", { mode: "default" as any, allowRules: [], denyRules: [] })).toBe(false);
    stopSpeculation();
    expect(getSpeculationState().active).toBe(false);
  });

  it("auto-mode classifier rules", async () => {
    const { classifyToolUse, setCircuitBroken } = await import("../src/core/classifier.js");

    expect(classifyToolUse("Read", {}).behavior).toBe("allow");
    expect(classifyToolUse("Glob", {}).behavior).toBe("allow");
    expect(classifyToolUse("Bash", { command: "sudo rm -rf /" }).behavior).toBe("deny");
    expect(classifyToolUse("UnknownTool", {}).behavior).toBe("ask");

    setCircuitBroken(true);
    expect(classifyToolUse("Read", {}).behavior).toBe("ask");
    setCircuitBroken(false);
  });

  it("hook system registers and queries", async () => {
    const { registerHook, getHooksForEvent, clearHooks, getRegisteredHookCount } = await import("../src/hooks/registry.js");
    clearHooks();
    registerHook({ event: "SessionStart", commands: [{ type: "command", command: "echo start" }], source: "settings" });
    expect(getRegisteredHookCount()).toBe(1);
    expect(getHooksForEvent("SessionStart").length).toBe(1);
    expect(getHooksForEvent("Stop").length).toBe(0);
    clearHooks();
  });

  it("slash commands work", async () => {
    const { isSlashCommand, executeSlashCommand, getAllSlashCommands } = await import("../src/core/slash-commands.js");

    expect(getAllSlashCommands().length).toBeGreaterThanOrEqual(20);
    expect(isSlashCommand("/help")).toBe(true);
    expect(isSlashCommand("/nonexistent")).toBe(false);
    expect(isSlashCommand("not a command")).toBe(false);

    const helpResult = await executeSlashCommand("/help");
    expect(helpResult.output).toContain("Available commands");

    const clearResult = await executeSlashCommand("/clear");
    expect(clearResult.action).toBe("clear");
  });

  it("context manager tracks and compacts", async () => {
    const { ContextManager } = await import("../src/core/context.js");

    const cm = new ContextManager({ model: "sonnet", contextWindowOverride: 1000, preserveRecentTurns: 2 });
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "x".repeat(400),
    }));

    const state = cm.getState(msgs);
    expect(state.needsCompaction).toBe(true);

    const compacted = cm.compact(msgs);
    expect(compacted.length).toBeLessThan(msgs.length);
    expect(compacted[0].content).toContain("Context Summary");
  });

  it("session create and save", async () => {
    const { createSession, saveSession, loadSession } = await import("../src/core/session.js");

    const session = createSession(TEST_DIR);
    session.messages = [{ role: "user", content: "Test message" }];
    saveSession(session);

    const loaded = loadSession(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.messages.length).toBe(1);
  });

  it("git remote parsing", async () => {
    const { parseGitRemote } = await import("../src/git/repo.js");

    expect(parseGitRemote("git@github.com:owner/repo.git")).toEqual({ owner: "owner", name: "repo" });
    expect(parseGitRemote("https://github.com/org/project.git")).toEqual({ owner: "org", name: "project" });
    expect(parseGitRemote("https://gitlab.com/group/subgroup/repo")).toEqual({ owner: "subgroup", name: "repo" });
  });

  it("telemetry emits and clears", async () => {
    const { emitEvent, getEventCount, clearEvents } = await import("../src/telemetry/events.js");
    clearEvents();
    emitEvent("integration_test");
    emitEvent("another_event", { key: "val" });
    expect(getEventCount()).toBe(2);
    clearEvents();
    expect(getEventCount()).toBe(0);
  });
});
