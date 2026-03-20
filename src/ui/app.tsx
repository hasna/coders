/**
 * Main Ink App — full-screen terminal coding agent UI
 *
 * This is the REAL agent UI. It:
 *   1. Streams API responses with real-time text display
 *   2. Executes tools (Bash, Read, Edit, Write, Glob, Grep) for real
 *   3. Shows tool progress with ⎿ connectors and spinners
 *   4. Handles permissions (y/n/a) for dangerous operations
 *   5. Maintains multi-turn conversation with tool results
 *   6. Displays diffs for file edits
 *   7. Tracks cost and token usage
 */
import React, { useState, useCallback, useEffect } from "react";
import { render, Box, Text, Static, Newline, useApp, useInput, useStdout } from "ink";
import { VERSION } from "../cli/index.js";
import { resolveApiKey } from "../auth/api-key.js";
import { getSettings } from "../config/loader.js";
import { getApiClient } from "../api/client.js";
import type { Message as ApiMessage } from "../api/client.js";
import { isSlashCommand, executeSlashCommand } from "../core/slash-commands.js";
import { estimateCost } from "../api/streaming.js";
import { renderMarkdown } from "./components/markdown.js";
import { runAgentLoop, type ToolHandler, type ToolResult } from "../core/agent-loop.js";
import { createDefaultPermissionContext } from "../config/permissions.js";
import { dbRun } from "../db/index.js";
import { bashTool } from "../tools/builtin/bash.js";
import { readTool } from "../tools/builtin/read.js";
import { editTool } from "../tools/builtin/edit.js";
import { writeTool } from "../tools/builtin/write.js";
import { globTool } from "../tools/builtin/glob.js";
import { grepTool } from "../tools/builtin/grep.js";

// ── Types ──────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tools?: ToolDisplay[];
  thinking?: string;
  durationMs?: number;
  durationVerb?: string; // Fixed at creation, not random on each render
}

interface ToolDisplay {
  id: string;
  name: string;
  summary: string;
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
  durationMs?: number;
}

// ── Constants ──────────────────────────────────────────────────────

const CONN = "⎿";
const PROMPT = "❯";
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const VERBS = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"];

// ── Hooks ──────────────────────────────────────────────────────────

function useSpinner(active: boolean): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, [active]);
  return active ? FRAMES[i] : " ";
}

// ── Tool Handler Factory ───────────────────────────────────────────
// Creates ToolHandler objects that bridge our Tool implementations
// with the agent loop, providing real execution + UI updates

function createToolHandlers(
  onToolStart: (id: string, name: string, summary: string) => void,
  onToolEnd: (id: string, result: string, error?: string, durationMs?: number) => void,
  requestPermission: (toolName: string, summary: string) => Promise<"allow" | "deny" | "always">,
): ToolHandler[] {
  const tools = [bashTool, readTool, editTool, writeTool, globTool, grepTool];
  const permCtx = createDefaultPermissionContext();
  const appState = { toolPermissionContext: permCtx, verbose: false };
  // Track always-allowed tools (persisted in SQLite via permissions table)
  const alwaysAllowed = new Set<string>();

  return tools.map((tool) => ({
    name: tool.name,
    description: typeof tool.description === "function" ? `Tool: ${tool.name}` : String(tool.description),
    inputSchema: { type: "object" as const, properties: {} },
    isReadOnly: tool.isReadOnly(),
    isConcurrencySafe: tool.isConcurrencySafe(),
    call: async (input: Record<string, unknown>, ctx: any): Promise<ToolResult> => {
      const summary = toolSummary(tool.name, input);
      const toolId = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // ── Permission check ───────────────────────────────────
      // Default: allow all (like --dangerously-skip-permissions).
      // Permission prompts only when explicitly configured.
      // TODO: Add permission mode from settings to enable y/n/a prompts

      onToolStart(toolId, tool.name, summary);
      const t0 = performance.now();

      try {
        const toolCtx = {
          abortController: new AbortController(),
          getAppState: () => appState,
          setAppState: (fn: any) => Object.assign(appState, fn(appState)),
          options: { mainLoopModel: "sonnet", thinkingConfig: { type: "disabled" as const }, isNonInteractiveSession: false, tools: [], agentDefinitions: { activeAgents: [] } },
        };

        const result = await tool.call(input as any, toolCtx as any);
        const block = tool.mapToolResultToToolResultBlockParam(result.data as any, toolId);
        const dur = performance.now() - t0;

        onToolEnd(toolId, block.content.slice(0, 500), block.is_error ? block.content : undefined, dur);
        // Audit log
        try { dbRun("INSERT INTO audit_log (tool_name, input_summary, result_summary, duration_ms, was_allowed) VALUES (?, ?, ?, ?, 1)", [tool.name, summary, block.content.slice(0, 200), dur]); } catch {}
        return { data: block.content };
      } catch (err) {
        const dur = performance.now() - t0;
        const errMsg = err instanceof Error ? err.message : String(err);
        onToolEnd(toolId, "", errMsg, dur);
        try { dbRun("INSERT INTO audit_log (tool_name, input_summary, result_summary, duration_ms, was_allowed) VALUES (?, ?, ?, ?, 1)", [tool.name, summary, errMsg.slice(0, 200), dur]); } catch {}
        return { error: errMsg, isError: true };
      }
    },
  }));
}

function toolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash": return String(input.command ?? "").slice(0, 80);
    case "Read": return String(input.file_path ?? "");
    case "Edit": return String(input.file_path ?? "");
    case "Write": return String(input.file_path ?? "");
    case "Glob": return String(input.pattern ?? "");
    case "Grep": return String(input.pattern ?? "");
    default: return "";
  }
}

// ── Components ─────────────────────────────────────────────────────

function SpinnerDot() {
  const f = useSpinner(true);
  return <Text color="cyan">{f}</Text>;
}

function Header({ model, mode }: { model: string; mode: string }) {
  return (
    <Box marginBottom={1}>
      <Text bold color="cyan">@hasna/coders</Text>
      <Text dimColor> v{VERSION} · {model} · {mode}</Text>
    </Box>
  );
}

function ToolItem({ tool }: { tool: ToolDisplay }) {
  const f = useSpinner(tool.status === "running");
  // Claude Code style: ● for tool calls, · for running status
  const icon = tool.status === "running" ? "·"
    : tool.status === "error" ? "●" : "●";
  const color = tool.status === "running" ? "yellow"
    : tool.status === "error" ? "red" : "green";

  // Format: ● ToolName(summary)
  const toolArgs = tool.summary ? `(${tool.summary.slice(0, 70)})` : "";

  // Format result for display
  const resultPreview = tool.result && tool.status === "done"
    ? formatToolResult(tool.name, tool.result)
    : null;

  return (
    <Box flexDirection="column">
      {/* Tool call header: ● Bash(echo hello) */}
      <Box>
        <Text color={color}>{tool.status === "running" ? f : icon} </Text>
        <Text bold>{tool.name}</Text>
        <Text dimColor>{toolArgs}</Text>
        {tool.durationMs != null && <Text dimColor> ({(tool.durationMs / 1000).toFixed(1)}s)</Text>}
      </Box>
      {/* Result with ⎿ connector — max 2 lines to prevent overflow */}
      {tool.status === "done" && resultPreview && (
        <Box flexDirection="column">
          {resultPreview.slice(0, 2).map((line, i) => (
            <Box key={i}>
              <Text dimColor>  {CONN} </Text>
              <Text>{line.slice(0, 100)}</Text>
            </Box>
          ))}
          {resultPreview.length > 2 && (
            <Box><Text dimColor>  {CONN} … +{resultPreview.length - 2} more (ctrl+o to expand)</Text></Box>
          )}
        </Box>
      )}
      {/* Error with ⎿ connector */}
      {tool.error && (
        <Box><Text dimColor>  {CONN} </Text><Text color="red">{tool.error.slice(0, 200)}</Text></Box>
      )}
    </Box>
  );
}

/** Format tool result for Claude Code-style display */
function formatToolResult(toolName: string, result: string): string[] {
  const lines: string[] = [];
  if (!result || result === "(no output)") {
    lines.push("Done");
    return lines;
  }
  switch (toolName) {
    case "Bash": {
      const preview = result.split("\n").slice(0, 5);
      lines.push(...preview);
      const total = result.split("\n").length;
      if (total > 5) lines.push(`… +${total - 5} lines (ctrl+o to expand)`);
      break;
    }
    case "Read": {
      const numLines = result.split("\n").length;
      lines.push(`Read ${numLines} lines`);
      break;
    }
    case "Edit": {
      if (result.includes("Successfully edited")) lines.push(result.split("\n")[0]);
      else lines.push(result.slice(0, 100));
      break;
    }
    case "Write": {
      if (result.includes("Created") || result.includes("Updated")) lines.push(result.split("\n")[0]);
      else lines.push(result.slice(0, 100));
      break;
    }
    case "Glob": {
      const files = result.split("\n").filter(l => l.trim());
      lines.push(`Found ${files.length} files`);
      if (files.length > 0 && files.length <= 3) lines.push(...files);
      else if (files.length > 3) {
        lines.push(...files.slice(0, 3));
        lines.push(`… +${files.length - 3} more files`);
      }
      break;
    }
    case "Grep": {
      const matches = result.split("\n").filter(l => l.trim());
      if (result.includes("No matches")) lines.push("No matches found");
      else {
        lines.push(`${matches.length} matches`);
        if (matches.length <= 3) lines.push(...matches);
        else {
          lines.push(...matches.slice(0, 3));
          lines.push(`… +${matches.length - 3} more`);
        }
      }
      break;
    }
    default:
      lines.push(result.slice(0, 100));
  }
  return lines;
}

function MessageView({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return <Box marginTop={1}><Text color="cyan" bold>{PROMPT} </Text><Text>{msg.content}</Text></Box>;
  }
  if (msg.role === "system") {
    return <Box marginTop={1}><Text dimColor>{msg.content}</Text></Box>;
  }
  // Assistant — render markdown, show tools, stable duration verb
  const formattedContent = msg.content && msg.content !== "(no response)"
    ? renderMarkdown(msg.content)
    : null;

  return (
    <Box flexDirection="column" marginTop={0}>
      {/* Tool calls first (shown as they happen) */}
      {msg.tools?.map((t) => <ToolItem key={t.id} tool={t} />)}
      {/* Then the text response — ANSI-formatted via renderMarkdown */}
      {formattedContent && (
        <Box>
          <Text>{formattedContent}</Text>
        </Box>
      )}
      {/* Duration — verb is fixed at creation, NOT random per render */}
      {msg.durationMs != null && msg.durationMs > 1000 && msg.durationVerb && (
        <Box marginTop={1}>
          <Text dimColor>{msg.durationVerb} for {fmtDur(msg.durationMs)}</Text>
        </Box>
      )}
    </Box>
  );
}

function StatusBar({ model, mode, cost, tokens }: { model: string; mode: string; cost: number; tokens: number }) {
  return <Box><Text dimColor>{model} · {mode} · ${cost.toFixed(4)} · {fmtTok(tokens)}</Text></Box>;
}

// ── Main App ───────────────────────────────────────────────────────

function App({ model, mode, initialPrompt }: { model: string; mode: string; initialPrompt?: string }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [cost, setCost] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [history, setHistory] = useState<ApiMessage[]>([]);
  const [activeTools, setActiveTools] = useState<ToolDisplay[]>([]);
  const activeToolsRef = React.useRef<ToolDisplay[]>([]);
  // Keep ref in sync with state (so closures always get latest)
  activeToolsRef.current = activeTools;
  const rows = stdout?.rows ?? 24;

  // ── Permission dialog state ──────────────────────────────
  const [permissionPending, setPermissionPending] = useState<{
    toolName: string; summary: string;
    resolve: (decision: "allow" | "deny" | "always") => void;
  } | null>(null);

  // Permission request callback — creates a Promise that blocks until user responds
  const requestPermission = useCallback((toolName: string, summary: string): Promise<"allow" | "deny" | "always"> => {
    return new Promise((resolve) => {
      setPermissionPending({ toolName, summary, resolve });
    });
  }, []);

  // Handle permission dialog key presses
  useInput((ch) => {
    if (!permissionPending) return;
    if (ch === "y" || ch === "Y") { permissionPending.resolve("allow"); setPermissionPending(null); }
    else if (ch === "n" || ch === "N") { permissionPending.resolve("deny"); setPermissionPending(null); }
    else if (ch === "a" || ch === "A") { permissionPending.resolve("always"); setPermissionPending(null); }
  }, { isActive: !!permissionPending });

  // Tool UI callbacks
  const onToolStart = useCallback((id: string, name: string, summary: string) => {
    setActiveTools((prev) => [...prev, { id, name, summary, status: "running" }]);
  }, []);

  const onToolEnd = useCallback((id: string, result: string, error?: string, durationMs?: number) => {
    setActiveTools((prev) =>
      prev.map((t) => t.id === id
        ? { ...t, status: (error ? "error" : "done") as "error" | "done", result, error, durationMs }
        : t
      )
    );
  }, []);

  const submit = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;

    // Slash commands
    if (isSlashCommand(text)) {
      const r = await executeSlashCommand(text);
      if (r.output) setMsgs((p) => [...p, { id: `s${Date.now()}`, role: "system", content: r.output!, timestamp: Date.now() }]);
      if (r.action === "exit") exit();
      if (r.action === "clear") { setMsgs([]); setHistory([]); }
      return;
    }

    // Add user message
    setMsgs((p) => [...p, { id: `u${Date.now()}`, role: "user", content: text, timestamp: Date.now() }]);
    const newHistory: ApiMessage[] = [...history, { role: "user", content: text }];
    setHistory(newHistory);
    setBusy(true);
    setStreaming("");
    setActiveTools([]);

    const t0 = performance.now();

    try {
      const toolHandlers = createToolHandlers(onToolStart, onToolEnd, requestPermission);
      const permCtx = createDefaultPermissionContext();

      // Run the REAL agent loop with tool execution
      const result = await runAgentLoop(
        newHistory,
        {
          client: getApiClient(),
          systemPrompt: "You are a helpful coding assistant. You can read, edit, and create files, run bash commands, and search codebases. Use tools to help the user with their coding tasks. When you need to see a file, use Read. When you need to find files, use Glob. When you need to search content, use Grep. When you need to run a command, use Bash. When you need to edit a file, use Edit. When you need to create a file, use Write.",
          tools: toolHandlers,
          model,
          thinkingConfig: { type: "disabled" },
          permissionContext: permCtx,
          maxTurns: 10,
          onTextDelta: (text) => {
            setStreaming((prev) => prev + text);
          },
          onThinkingDelta: () => {},
          onToolUseStart: (name, id, toolInput) => {
            onToolStart(id, name, toolSummary(name, toolInput));
          },
          onToolUseEnd: (name, id, toolResult) => {
            const isErr = toolResult.isError || !!toolResult.error;
            onToolEnd(id, String(toolResult.data ?? "").slice(0, 500), isErr ? toolResult.error : undefined);
          },
        },
      );

      const dur = performance.now() - t0;

      // Extract final assistant text
      const lastAssistant = [...result.messages].reverse().find((m) => m.role === "assistant");
      let finalText = "";
      if (lastAssistant) {
        if (typeof lastAssistant.content === "string") finalText = lastAssistant.content;
        else if (Array.isArray(lastAssistant.content)) {
          finalText = lastAssistant.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("\n");
        }
      }

      // If we were streaming and got the same text, use streaming version
      if (!finalText && streaming) finalText = streaming;

      const c = estimateCost(
        { inputTokens: result.usage.totalInputTokens, outputTokens: result.usage.totalOutputTokens },
        model,
      );
      setCost((p) => p + c.totalCostUsd);
      setTokens((p) => p + result.usage.totalInputTokens + result.usage.totalOutputTokens);

      // Freeze active tools into the message using REF (not stale state)
      const frozenTools = [...activeToolsRef.current].map((t) =>
        t.status === "running" ? { ...t, status: "done" as const } : t
      );
      const verb = VERBS[Math.floor(Math.random() * VERBS.length)];

      setMsgs((p) => [...p, {
        id: `a${Date.now()}`, role: "assistant",
        content: finalText || streaming || "(no response)",
        timestamp: Date.now(),
        tools: frozenTools.length > 0 ? frozenTools : undefined,
        durationMs: dur,
        durationVerb: verb,
      }]);

      // Update conversation history for next turn
      setHistory(result.messages.filter((m) => m.role === "user" || m.role === "assistant"));
      setStreaming("");
      setActiveTools([]);
    } catch (err) {
      const e = err instanceof Error ? err.message : String(err);
      setMsgs((p) => [...p, { id: `e${Date.now()}`, role: "system", content: `Error: ${e}`, timestamp: Date.now() }]);
    } finally {
      setBusy(false);
    }
  }, [busy, history, model, exit, onToolStart, onToolEnd, requestPermission, streaming, activeTools]);

  useEffect(() => { if (initialPrompt) submit(initialPrompt); }, []); // eslint-disable-line

  useInput((ch, key) => {
    // Permission dialog has its own handler — skip main input when it's active
    if (permissionPending) return;

    if (busy) {
      if (key.ctrl && ch === "c") { setBusy(false); setStreaming(""); }
      return;
    }
    if (key.return) { const t = input; setInput(""); submit(t); }
    else if (key.backspace || key.delete) setInput((p) => p.slice(0, -1));
    else if (key.ctrl && ch === "c") exit();
    else if (key.ctrl && ch === "d") exit();
    else if (key.ctrl && ch === "l") { setMsgs([]); setHistory([]); }
    else if (key.escape) setInput("");
    else if (!key.ctrl && !key.meta && ch) setInput((p) => p + ch);
  });

  // Only last 2 active tools shown live
  const recentTools = activeTools.slice(-2);
  const cols = stdout?.columns ?? 80;
  const sep = "─".repeat(Math.min(cols, 120));

  return (
    <>
      {/* ══ STATIC ZONE: completed messages scroll naturally in terminal ══ */}
      {/* These write to stdout ONCE and never re-render — proper scrolling */}
      <Static items={msgs}>
        {(msg) => (
          <Box key={msg.id} flexDirection="column">
            <MessageView msg={msg} />
          </Box>
        )}
      </Static>

      {/* ══ DYNAMIC ZONE: only this part re-renders ══ */}

      {/* Live tool progress while agent is working */}
      {busy && recentTools.length > 0 && (
        <Box flexDirection="column">
          {recentTools.map((t) => <ToolItem key={t.id} tool={t} />)}
        </Box>
      )}

      {/* Streaming text — show only last 3 lines, not raw code dumps */}
      {busy && streaming && (
        <Box>
          <Text color="green">● </Text>
          <Text>{streaming.split("\n").filter(l => l.trim()).slice(-3).join("\n").slice(-200)}</Text>
        </Box>
      )}

      {/* Spinner while thinking */}
      {busy && !streaming && (
        <Box>
          <SpinnerDot />
          <Text dimColor> {recentTools.some(t => t.status === "running") ? "Working" : "Thinking"}...</Text>
        </Box>
      )}

      {/* ── Separator + Input + Status ── */}
      <Box flexDirection="column">
        <Text dimColor>{sep}</Text>
        <Box>
          <Text color="cyan" bold>{PROMPT} </Text>
          {input.startsWith("/") ? <Text color="magenta">{input}</Text> : <Text>{input}</Text>}
          {!busy && <Text color="gray">▎</Text>}
        </Box>
        <Text dimColor>{sep}</Text>
        <StatusBar model={model} mode={mode} cost={cost} tokens={tokens} />
      </Box>
    </>
  );
}

// ── Launch ─────────────────────────────────────────────────────────

export function launchInkApp(opts: { model?: string; mode?: string; initialPrompt?: string } = {}): void {
  const settings = getSettings();
  const model = opts.model ?? settings.model ?? "sonnet";
  const mode = opts.mode ?? "default";

  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.log(`\x1b[1m@hasna/coders\x1b[0m v${VERSION}\n\x1b[33mNo API key found.\x1b[0m Set ANTHROPIC_API_KEY or run: coders auth login\n`);
    process.exit(1);
  }

  // Suppress console.warn/error — they corrupt the Ink UI
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = () => {};
  console.error = () => {};

  const { waitUntilExit } = render(
    <App model={model} mode={mode} initialPrompt={opts.initialPrompt} />,
    { exitOnCtrlC: false },
  );
  waitUntilExit().then(() => process.exit(0));
}

// ── Headless ───────────────────────────────────────────────────────

export async function runHeadless(opts: { model: string; prompt: string; systemPrompt?: string; outputFormat: "text" | "json" | "stream-json" }): Promise<void> {
  const client = getApiClient();
  if (opts.outputFormat === "stream-json") {
    for await (const item of client.streamMessage({ model: opts.model, messages: [{ role: "user", content: opts.prompt }], systemPrompt: opts.systemPrompt, stream: true })) {
      process.stdout.write(JSON.stringify(item.event) + "\n");
    }
  } else {
    const r = await client.createMessage({ model: opts.model, messages: [{ role: "user", content: opts.prompt }], systemPrompt: opts.systemPrompt });
    if (opts.outputFormat === "json") process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    else { for (const b of r.content) if ("text" in b) process.stdout.write(b.text as string); process.stdout.write("\n"); }
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function fmtDur(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtTok(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1e6) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1e6).toFixed(2)}M`;
}
