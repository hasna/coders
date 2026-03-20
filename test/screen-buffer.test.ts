import { describe, it, expect } from "vitest";
import { ScreenBuffer, createScreen, StylePool } from "../src/ui/screen/buffer.js";
import { renderFullFrame, renderDiff, ANSI } from "../src/ui/screen/renderer.js";
import { detectTerminal, getTerminalSize } from "../src/ui/screen/terminal.js";

describe("ScreenBuffer", () => {
  it("creates with correct dimensions", () => {
    const buf = createScreen(80, 24);
    expect(buf.width).toBe(80);
    expect(buf.height).toBe(24);
  });

  it("initializes cells with spaces", () => {
    const buf = createScreen(10, 5);
    expect(buf.getCell(0, 0)?.char).toBe(" ");
    expect(buf.getRowText(0)).toBe("          ");
  });

  it("sets and gets cells", () => {
    const buf = createScreen(10, 5);
    buf.setCell(3, 2, "X");
    expect(buf.getCell(3, 2)?.char).toBe("X");
  });

  it("writes strings", () => {
    const buf = createScreen(20, 5);
    buf.writeString(2, 1, "Hello");
    expect(buf.getRowText(1)).toBe("  Hello             ");
  });

  it("clears regions", () => {
    const buf = createScreen(10, 5);
    buf.writeString(0, 0, "XXXXXXXXXX");
    buf.clearRegion(2, 0, 3, 1);
    expect(buf.getRowText(0)).toBe("XX   XXXXX");
  });

  it("tracks dirty state", () => {
    const buf = createScreen(10, 5);
    expect(buf.isDirty()).toBe(true); // initially dirty (full redraw)

    const dirty = buf.consumeDirty();
    expect(dirty.full).toBe(true);
    expect(buf.isDirty()).toBe(false);

    buf.setCell(0, 0, "A");
    expect(buf.isDirty()).toBe(true);
  });

  it("resizes correctly", () => {
    const buf = createScreen(10, 5);
    buf.writeString(0, 0, "Hello");
    buf.resize(20, 10);
    expect(buf.width).toBe(20);
    expect(buf.height).toBe(10);
    // Original content preserved
    expect(buf.getRowText(0).startsWith("Hello")).toBe(true);
    expect(buf.needsFullRedraw()).toBe(true);
  });

  it("handles out-of-bounds gracefully", () => {
    const buf = createScreen(5, 5);
    buf.setCell(-1, 0, "X"); // should not throw
    buf.setCell(100, 100, "X"); // should not throw
    expect(buf.getCell(-1, 0)).toBeNull();
    expect(buf.getCell(100, 100)).toBeNull();
  });
});

describe("StylePool", () => {
  it("starts with default style at index 0", () => {
    const pool = new StylePool();
    expect(pool.size).toBe(1);
    expect(pool.get(0)).toEqual({});
  });

  it("deduplicates identical styles", () => {
    const pool = new StylePool();
    const id1 = pool.getOrAdd({ bold: true, fg: "red" });
    const id2 = pool.getOrAdd({ bold: true, fg: "red" });
    expect(id1).toBe(id2);
  });

  it("assigns unique IDs to different styles", () => {
    const pool = new StylePool();
    const id1 = pool.getOrAdd({ fg: "red" });
    const id2 = pool.getOrAdd({ fg: "blue" });
    expect(id1).not.toBe(id2);
  });
});

describe("Renderer", () => {
  it("renders full frame", () => {
    const buf = createScreen(5, 2);
    buf.writeString(0, 0, "Hi");
    const output = renderFullFrame(buf);
    expect(output).toContain("Hi");
    expect(output).toContain(ANSI.hideCursor);
    expect(output).toContain(ANSI.showCursor);
  });

  it("renders diff between frames", () => {
    const prev = createScreen(10, 3);
    prev.writeString(0, 0, "Hello");

    const curr = createScreen(10, 3);
    curr.writeString(0, 0, "World");

    const diff = renderDiff(curr, prev);
    // Diff contains the changed characters (may be split by cursor moves)
    expect(diff).toContain("W");
    expect(diff).toContain("d"); // 'l' at pos 3 is same in Hello/World, so skipped
    expect(diff.length).toBeGreaterThan(0);
  });

  it("falls back to full frame on resize", () => {
    const prev = createScreen(10, 3);
    const curr = createScreen(20, 5); // different size
    const output = renderDiff(curr, prev);
    // Should produce full frame output
    expect(output.length).toBeGreaterThan(0);
  });
});

describe("Terminal detection", () => {
  it("returns terminal capabilities", () => {
    const caps = detectTerminal();
    expect(caps.name).toBeTruthy();
    expect([1, 4, 8, 24]).toContain(caps.colorDepth);
    expect(typeof caps.unicode).toBe("boolean");
    expect(typeof caps.hyperlinks).toBe("boolean");
  });

  it("returns terminal size", () => {
    const size = getTerminalSize();
    expect(size.columns).toBeGreaterThan(0);
    expect(size.rows).toBeGreaterThan(0);
  });
});
