import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/ui/components/markdown.js";
import {
  KeybindingManager,
  parseKeyEvent,
  DEFAULT_KEYBINDINGS,
  KEYBINDING_CONTEXTS,
} from "../src/ui/keybindings.js";
import { getTheme, getAvailableThemes } from "../src/ui/themes.js";

describe("Markdown renderer", () => {
  it("renders headings", () => {
    const out = renderMarkdown("# Hello");
    expect(out).toContain("Hello");
    expect(out).toContain("#");
  });

  it("renders bold text", () => {
    const out = renderMarkdown("This is **bold** text");
    expect(out).toContain("bold");
  });

  it("renders code blocks with language", () => {
    const out = renderMarkdown("```typescript\nconst x = 1;\n```");
    expect(out).toContain("typescript");
    expect(out).toContain("const");
    expect(out).toContain("┌");
    expect(out).toContain("└");
  });

  it("renders inline code", () => {
    const out = renderMarkdown("Use `npm install` to install");
    expect(out).toContain("npm install");
  });

  it("renders lists", () => {
    const out = renderMarkdown("- Item 1\n- Item 2\n- Item 3");
    expect(out).toContain("Item 1");
    expect(out).toContain("Item 2");
    expect(out).toContain("•");
  });

  it("renders blockquotes", () => {
    const out = renderMarkdown("> This is a quote");
    expect(out).toContain("This is a quote");
    expect(out).toContain("│");
  });

  it("renders horizontal rules", () => {
    const out = renderMarkdown("---");
    expect(out).toContain("─");
  });

  it("handles empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });
});

describe("Keybinding system", () => {
  it("has 17 contexts", () => {
    expect(KEYBINDING_CONTEXTS.length).toBe(17);
  });

  it("has default keybindings", () => {
    expect(DEFAULT_KEYBINDINGS.length).toBeGreaterThan(10);
  });

  it("creates manager with defaults", () => {
    const mgr = new KeybindingManager();
    expect(mgr.getActiveContexts()).toContain("Global");
  });

  it("matches ctrl+c to interrupt", () => {
    const mgr = new KeybindingManager();
    const action = mgr.getAction({ key: "c", ctrl: true, meta: false, shift: false });
    expect(action).toBe("interrupt");
  });

  it("matches ctrl+d to exit", () => {
    const mgr = new KeybindingManager();
    const action = mgr.getAction({ key: "d", ctrl: true, meta: false, shift: false });
    expect(action).toBe("exit");
  });

  it("pushes and pops contexts", () => {
    const mgr = new KeybindingManager();
    mgr.pushContext("Chat");
    expect(mgr.getActiveContexts()).toContain("Chat");

    // Chat enter = submit
    const action = mgr.getAction({ key: "enter", ctrl: false, meta: false, shift: false });
    expect(action).toBe("submit");

    mgr.popContext("Chat");
    expect(mgr.getActiveContexts()).not.toContain("Chat");
  });

  it("does not pop Global context", () => {
    const mgr = new KeybindingManager();
    mgr.popContext("Global");
    expect(mgr.getActiveContexts()).toContain("Global");
  });

  it("returns null for unbound keys", () => {
    const mgr = new KeybindingManager();
    const action = mgr.getAction({ key: "z", ctrl: false, meta: false, shift: false });
    expect(action).toBeNull();
  });
});

describe("parseKeyEvent", () => {
  it("parses ctrl+c", () => {
    const event = parseKeyEvent("\x03");
    expect(event.key).toBe("c");
    expect(event.ctrl).toBe(true);
  });

  it("parses escape", () => {
    const event = parseKeyEvent("\x1b");
    expect(event.key).toBe("escape");
  });

  it("parses enter", () => {
    const event = parseKeyEvent("\r");
    expect(event.key).toBe("enter");
  });

  it("parses tab", () => {
    const event = parseKeyEvent("\t");
    expect(event.key).toBe("tab");
  });

  it("parses arrow up", () => {
    const event = parseKeyEvent("\x1b[A");
    expect(event.key).toBe("up");
  });

  it("parses meta+letter", () => {
    const event = parseKeyEvent("\x1bp");
    expect(event.key).toBe("p");
    expect(event.meta).toBe(true);
  });

  it("parses regular character", () => {
    const event = parseKeyEvent("a");
    expect(event.key).toBe("a");
    expect(event.ctrl).toBe(false);
    expect(event.meta).toBe(false);
  });
});

describe("Themes", () => {
  it("returns default theme", () => {
    const theme = getTheme("default");
    expect(theme.name).toBe("default");
    expect(theme.colors.primary).toBeTruthy();
    expect(theme.colors.error).toBeTruthy();
  });

  it("has multiple themes", () => {
    const themes = getAvailableThemes();
    expect(themes).toContain("default");
    expect(themes).toContain("dark");
    expect(themes).toContain("light");
  });

  it("falls back to default for unknown theme", () => {
    const theme = getTheme("nonexistent");
    expect(theme.name).toBe("default");
  });
});
