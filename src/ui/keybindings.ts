/**
 * Keybinding system — 17 contexts with configurable key mappings
 *
 * Matches Claude Code's keybinding system (34-ui-prompt.js).
 */

// ── Keybinding Contexts ────────────────────────────────────────────

export const KEYBINDING_CONTEXTS = [
  "Global",
  "Chat",
  "Autocomplete",
  "Settings",
  "Confirmation",
  "Tabs",
  "Transcript",
  "HistorySearch",
  "Task",
  "ThemePicker",
  "Help",
  "Attachments",
  "Footer",
  "MessageSelector",
  "DiffDialog",
  "ModelPicker",
  "Select",
] as const;

export type KeybindingContext = typeof KEYBINDING_CONTEXTS[number];

// ── Key event ──────────────────────────────────────────────────────

export interface KeyEvent {
  key: string;       // e.g., "a", "enter", "tab", "escape"
  ctrl: boolean;
  meta: boolean;     // alt/option
  shift: boolean;
  raw?: string;      // raw escape sequence
}

// ── Keybinding definition ──────────────────────────────────────────

export interface Keybinding {
  context: KeybindingContext;
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  action: string;
  description: string;
}

// ── Default keybindings ────────────────────────────────────────────

export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  // Global
  { context: "Global", key: "c", ctrl: true, action: "interrupt", description: "Interrupt current operation" },
  { context: "Global", key: "d", ctrl: true, action: "exit", description: "Exit coders" },
  { context: "Global", key: "l", ctrl: true, action: "clearScreen", description: "Clear screen" },
  { context: "Global", key: "\\", ctrl: true, action: "toggleVerbose", description: "Toggle verbose mode" },

  // Chat
  { context: "Chat", key: "enter", action: "submit", description: "Submit message" },
  { context: "Chat", key: "enter", shift: true, action: "newline", description: "Insert newline" },
  { context: "Chat", key: "tab", action: "autocomplete", description: "Trigger autocomplete" },
  { context: "Chat", key: "escape", action: "cancel", description: "Cancel current action" },
  { context: "Chat", key: "up", action: "historyPrev", description: "Previous history entry" },
  { context: "Chat", key: "down", action: "historyNext", description: "Next history entry" },

  // Global shortcuts
  { context: "Global", key: "t", ctrl: true, action: "toggleTodos", description: "Toggle todo list" },
  { context: "Global", key: "o", ctrl: true, action: "toggleTranscript", description: "Toggle transcript" },
  { context: "Global", key: "r", ctrl: true, action: "historySearch", description: "Search history" },
  { context: "Global", key: "p", meta: true, action: "modelPicker", description: "Open model picker" },
  { context: "Global", key: "o", meta: true, action: "toggleFastMode", description: "Toggle fast mode" },
  { context: "Global", key: "t", meta: true, action: "toggleThinking", description: "Toggle thinking" },

  // Confirmation
  { context: "Confirmation", key: "y", action: "confirm", description: "Confirm" },
  { context: "Confirmation", key: "n", action: "deny", description: "Deny" },
  { context: "Confirmation", key: "a", action: "allowAlways", description: "Always allow" },
  { context: "Confirmation", key: "escape", action: "cancel", description: "Cancel" },

  // Tabs
  { context: "Tabs", key: "tab", action: "nextTab", description: "Next tab" },
  { context: "Tabs", key: "tab", shift: true, action: "prevTab", description: "Previous tab" },

  // Help
  { context: "Help", key: "escape", action: "close", description: "Close help" },
  { context: "Help", key: "q", action: "close", description: "Close help" },
];

// ── Keybinding Manager ─────────────────────────────────────────────

export class KeybindingManager {
  private bindings: Keybinding[];
  private activeContexts: Set<KeybindingContext> = new Set(["Global"]);

  constructor(bindings?: Keybinding[]) {
    this.bindings = bindings ?? [...DEFAULT_KEYBINDINGS];
  }

  /**
   * Push a context onto the active stack.
   */
  pushContext(context: KeybindingContext): void {
    this.activeContexts.add(context);
  }

  /**
   * Remove a context from the active stack.
   */
  popContext(context: KeybindingContext): void {
    if (context !== "Global") {
      this.activeContexts.delete(context);
    }
  }

  /**
   * Set the active contexts (replaces all except Global).
   */
  setContexts(contexts: KeybindingContext[]): void {
    this.activeContexts = new Set(["Global", ...contexts]);
  }

  /**
   * Get the action for a key event, checking active contexts.
   * Returns the first matching action (most specific context wins).
   */
  getAction(event: KeyEvent): string | null {
    // Check contexts in reverse order (most recently added first)
    const contexts = [...this.activeContexts].reverse();

    for (const context of contexts) {
      for (const binding of this.bindings) {
        if (binding.context !== context) continue;
        if (matchesKey(event, binding)) {
          return binding.action;
        }
      }
    }
    return null;
  }

  /**
   * Get all bindings for a context.
   */
  getBindingsForContext(context: KeybindingContext): Keybinding[] {
    return this.bindings.filter((b) => b.context === context);
  }

  /**
   * Add a custom keybinding.
   */
  addBinding(binding: Keybinding): void {
    this.bindings.push(binding);
  }

  /**
   * Get all active contexts.
   */
  getActiveContexts(): KeybindingContext[] {
    return [...this.activeContexts];
  }
}

function matchesKey(event: KeyEvent, binding: Keybinding): boolean {
  if (event.key !== binding.key) return false;
  if ((binding.ctrl ?? false) !== event.ctrl) return false;
  if ((binding.meta ?? false) !== event.meta) return false;
  if ((binding.shift ?? false) !== event.shift) return false;
  return true;
}

// ── Parse key event from raw input ─────────────────────────────────

export function parseKeyEvent(data: Buffer | string): KeyEvent {
  const raw = typeof data === "string" ? data : data.toString("utf-8");

  // Enter and Tab before ctrl detection (they overlap with ctrl+m and ctrl+i)
  if (raw === "\r" || raw === "\n") {
    return { key: "enter", ctrl: false, meta: false, shift: false, raw };
  }
  if (raw === "\t") {
    return { key: "tab", ctrl: false, meta: false, shift: false, raw };
  }

  // Ctrl+letter (0x01-0x1a), excluding tab(0x09) and enter(0x0d)
  if (raw.length === 1) {
    const code = raw.charCodeAt(0);
    if (code >= 1 && code <= 26 && code !== 9 && code !== 13) {
      return { key: String.fromCharCode(code + 96), ctrl: true, meta: false, shift: false, raw };
    }
    if (code === 27) {
      return { key: "escape", ctrl: false, meta: false, shift: false, raw };
    }
    if (code === 127) {
      return { key: "backspace", ctrl: false, meta: false, shift: false, raw };
    }
    return { key: raw, ctrl: false, meta: false, shift: false, raw };
  }

  // CSI sequences
  if (raw.startsWith("\x1b[")) {
    const seq = raw.slice(2);
    if (seq === "A") return { key: "up", ctrl: false, meta: false, shift: false, raw };
    if (seq === "B") return { key: "down", ctrl: false, meta: false, shift: false, raw };
    if (seq === "C") return { key: "right", ctrl: false, meta: false, shift: false, raw };
    if (seq === "D") return { key: "left", ctrl: false, meta: false, shift: false, raw };
    if (seq === "H") return { key: "home", ctrl: false, meta: false, shift: false, raw };
    if (seq === "F") return { key: "end", ctrl: false, meta: false, shift: false, raw };
    if (seq === "3~") return { key: "delete", ctrl: false, meta: false, shift: false, raw };
    if (seq === "Z") return { key: "tab", ctrl: false, meta: false, shift: true, raw };
  }

  // Meta+letter (ESC + letter)
  if (raw.startsWith("\x1b") && raw.length === 2) {
    return { key: raw[1], ctrl: false, meta: true, shift: false, raw };
  }

  return { key: raw, ctrl: false, meta: false, shift: false, raw };
}
