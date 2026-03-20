/**
 * InputPrompt — text input with history and cursor
 *
 * Features:
 *   - ❯ prompt character in cyan
 *   - Cursor indicator (▎)
 *   - Command history (up/down)
 *   - Slash command detection
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

const PROMPT_CHAR = "❯";

interface InputPromptProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function InputPrompt({ onSubmit, disabled, placeholder }: InputPromptProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput((ch, key) => {
    if (disabled) return;

    if (key.return) {
      const text = value.trim();
      if (text) {
        setHistory((h) => [text, ...h].slice(0, 100));
        setHistoryIndex(-1);
        setValue("");
        onSubmit(text);
      }
    } else if (key.upArrow) {
      if (history.length > 0) {
        const newIdx = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIdx);
        setValue(history[newIdx]);
      }
    } else if (key.downArrow) {
      if (historyIndex > 0) {
        const newIdx = historyIndex - 1;
        setHistoryIndex(newIdx);
        setValue(history[newIdx]);
      } else {
        setHistoryIndex(-1);
        setValue("");
      }
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
    } else if (key.escape) {
      setValue("");
      setHistoryIndex(-1);
    } else if (!key.ctrl && !key.meta && ch) {
      setValue((v) => v + ch);
    }
  });

  return (
    <Box>
      <Text color="cyan" bold>{PROMPT_CHAR} </Text>
      {value ? (
        <Text>{value}</Text>
      ) : placeholder ? (
        <Text dimColor>{placeholder}</Text>
      ) : null}
      {!disabled && <Text color="gray">▎</Text>}
    </Box>
  );
}

/**
 * PermissionDialog — y/n/a confirmation for tool use
 *
 * Shows: "Allow [ToolName]: [summary]? (y)es (n)o (a)lways"
 */
interface PermissionDialogProps {
  toolName: string;
  summary: string;
  onAllow: () => void;
  onDeny: () => void;
  onAlwaysAllow: () => void;
}

export function PermissionDialog({ toolName, summary, onAllow, onDeny, onAlwaysAllow }: PermissionDialogProps) {
  useInput((ch) => {
    if (ch === "y" || ch === "Y") onAllow();
    else if (ch === "n" || ch === "N") onDeny();
    else if (ch === "a" || ch === "A") onAlwaysAllow();
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="yellow" bold>? </Text>
        <Text>Allow </Text>
        <Text bold>{toolName}</Text>
        <Text dimColor>: {summary.slice(0, 80)}</Text>
      </Box>
      <Box>
        <Text dimColor>  </Text>
        <Text color="green">(y)es</Text>
        <Text dimColor> </Text>
        <Text color="red">(n)o</Text>
        <Text dimColor> </Text>
        <Text color="blue">(a)lways allow</Text>
      </Box>
    </Box>
  );
}
