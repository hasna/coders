/**
 * MessageList — scrollable conversation view with markdown rendering
 *
 * Displays user messages (❯ prefix), assistant messages (markdown),
 * tool uses (⎿ connector with status), and system messages.
 */
import React from "react";
import { Box, Text } from "ink";
import { renderMarkdown } from "./markdown.js";

// ── Types ──────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tools?: ToolDisplay[];
  thinking?: string;
  durationMs?: number;
}

export interface ToolDisplay {
  id: string;
  name: string;
  summary: string;
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
  durationMs?: number;
}

// ── Constants ──────────────────────────────────────────────────────

const CONNECTOR = "⎿";
const PROMPT_CHAR = "❯";
const VERBS = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"];

// ── Tool Item ──────────────────────────────────────────────────────

export function ToolItem({ tool }: { tool: ToolDisplay }) {
  const icon = tool.status === "running" ? "○"
    : tool.status === "error" ? "✗" : "✓";
  const color = tool.status === "running" ? "yellow"
    : tool.status === "error" ? "red" : "green";

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>  {CONNECTOR} </Text>
        <Text color={color}>{icon} </Text>
        <Text bold>{tool.name}</Text>
        {tool.summary && <Text dimColor> {tool.summary}</Text>}
        {tool.durationMs != null && <Text dimColor> ({(tool.durationMs / 1000).toFixed(1)}s)</Text>}
      </Box>
      {tool.status === "error" && tool.error && (
        <Box>
          <Text dimColor>     {CONNECTOR} </Text>
          <Text color="red">{tool.error.slice(0, 200)}</Text>
        </Box>
      )}
      {tool.status === "done" && tool.result && tool.result.length > 0 && tool.result.length < 500 && (
        <Box>
          <Text dimColor>     {CONNECTOR} </Text>
          <Text dimColor>{tool.result.slice(0, 200)}</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Single Message View ────────────────────────────────────────────

export function MessageView({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <Box marginTop={1}>
        <Text color="cyan" bold>{PROMPT_CHAR} </Text>
        <Text>{msg.content}</Text>
      </Box>
    );
  }

  if (msg.role === "system") {
    return (
      <Box marginTop={1}>
        <Text dimColor>{msg.content}</Text>
      </Box>
    );
  }

  // Assistant message with markdown
  const verb = VERBS[Math.floor(Math.random() * VERBS.length)];

  return (
    <Box flexDirection="column" marginTop={1}>
      {msg.thinking && (
        <Box>
          <Text dimColor italic>{"💭 "}{msg.thinking.slice(0, 300)}{msg.thinking.length > 300 ? "..." : ""}</Text>
        </Box>
      )}
      {msg.content && (
        <Box>
          <Text>{msg.content}</Text>
        </Box>
      )}
      {msg.tools?.map((t) => (
        <ToolItem key={t.id} tool={t} />
      ))}
      {msg.durationMs != null && msg.durationMs > 2000 && (
        <Box marginTop={1}>
          <Text dimColor>{verb} for {formatDuration(msg.durationMs)}</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Message List (scrollable) ──────────────────────────────────────

interface MessageListProps {
  messages: ChatMessage[];
  maxVisible: number;
  streamingText?: string;
  isProcessing?: boolean;
}

export function MessageList({ messages, maxVisible, streamingText, isProcessing }: MessageListProps) {
  const visible = messages.slice(-maxVisible);
  const hidden = messages.length - visible.length;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {hidden > 0 && (
        <Box>
          <Text dimColor>  ↑ {hidden} earlier message{hidden !== 1 ? "s" : ""}</Text>
        </Box>
      )}
      {visible.map((msg) => (
        <MessageView key={msg.id} msg={msg} />
      ))}
      {isProcessing && streamingText && (
        <Box marginTop={1}>
          <Text>{streamingText}</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
