/**
 * ANSI render diff engine — compute minimal escape sequences between frames
 *
 * Given the current and previous screen buffers, generates the smallest
 * set of ANSI escape sequences to update the terminal.
 */
import type { ScreenBuffer, CellStyle } from "./buffer.js";

// ── ANSI escape codes ──────────────────────────────────────────────

const ESC = "\x1b";
const CSI = `${ESC}[`;

export const ANSI = {
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  italic: `${CSI}3m`,
  underline: `${CSI}4m`,
  inverse: `${CSI}7m`,
  strikethrough: `${CSI}9m`,
  moveTo: (x: number, y: number) => `${CSI}${y + 1};${x + 1}H`,
  clearScreen: `${CSI}2J`,
  clearLine: `${CSI}2K`,
  showCursor: `${CSI}?25h`,
  hideCursor: `${CSI}?25l`,
  saveCursor: `${ESC}7`,
  restoreCursor: `${ESC}8`,
  enterAltScreen: `${CSI}?1049h`,
  exitAltScreen: `${CSI}?1049l`,
  fg: (color: string) => colorToAnsi(color, true),
  bg: (color: string) => colorToAnsi(color, false),
};

// ── Render full frame ──────────────────────────────────────────────

export function renderFullFrame(buffer: ScreenBuffer): string {
  const out: string[] = [ANSI.hideCursor, ANSI.moveTo(0, 0)];
  let lastStyleId = -1;

  for (let y = 0; y < buffer.height; y++) {
    out.push(ANSI.moveTo(0, y));
    for (let x = 0; x < buffer.width; x++) {
      const cell = buffer.cells[y][x];
      if (cell.styleId !== lastStyleId) {
        out.push(styleToAnsi(buffer.stylePool.get(cell.styleId)));
        lastStyleId = cell.styleId;
      }
      out.push(cell.char);
    }
  }

  out.push(ANSI.reset, ANSI.showCursor);
  return out.join("");
}

// ── Render diff (incremental update) ───────────────────────────────

export function renderDiff(
  current: ScreenBuffer,
  previous: ScreenBuffer,
): string {
  if (current.width !== previous.width || current.height !== previous.height) {
    return renderFullFrame(current);
  }

  const out: string[] = [ANSI.hideCursor];
  let lastX = -1;
  let lastY = -1;
  let lastStyleId = -1;

  for (let y = 0; y < current.height; y++) {
    for (let x = 0; x < current.width; x++) {
      const curr = current.cells[y][x];
      const prev = previous.cells[y][x];

      // Skip unchanged cells
      if (
        curr.char === prev.char &&
        curr.styleId === prev.styleId &&
        curr.width === prev.width
      ) {
        continue;
      }

      // Move cursor if not sequential
      if (y !== lastY || x !== lastX + 1) {
        out.push(ANSI.moveTo(x, y));
      }

      // Apply style if changed
      if (curr.styleId !== lastStyleId) {
        out.push(styleToAnsi(current.stylePool.get(curr.styleId)));
        lastStyleId = curr.styleId;
      }

      out.push(curr.char);
      lastX = x;
      lastY = y;
    }
  }

  out.push(ANSI.reset, ANSI.showCursor);
  return out.join("");
}

// ── Style helpers ──────────────────────────────────────────────────

function styleToAnsi(style: CellStyle): string {
  const parts: string[] = [`${CSI}0m`]; // reset first

  if (style.bold) parts.push(ANSI.bold);
  if (style.dim) parts.push(ANSI.dim);
  if (style.italic) parts.push(ANSI.italic);
  if (style.underline) parts.push(ANSI.underline);
  if (style.inverse) parts.push(ANSI.inverse);
  if (style.strikethrough) parts.push(ANSI.strikethrough);
  if (style.fg) parts.push(ANSI.fg(style.fg));
  if (style.bg) parts.push(ANSI.bg(style.bg));

  return parts.join("");
}

// Named colors to ANSI codes
const COLOR_MAP: Record<string, number> = {
  black: 0, red: 1, green: 2, yellow: 3,
  blue: 4, magenta: 5, cyan: 6, white: 7,
  brightBlack: 8, brightRed: 9, brightGreen: 10, brightYellow: 11,
  brightBlue: 12, brightMagenta: 13, brightCyan: 14, brightWhite: 15,
  gray: 8, grey: 8,
};

function colorToAnsi(color: string, isFg: boolean): string {
  const base = isFg ? 30 : 40;

  // Named color
  const named = COLOR_MAP[color];
  if (named !== undefined) {
    if (named < 8) return `${CSI}${base + named}m`;
    return `${CSI}${base + 60 + (named - 8)}m`;
  }

  // Hex color (#rrggbb)
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `${CSI}${isFg ? 38 : 48};2;${r};${g};${b}m`;
  }

  // 256-color (number)
  const num = parseInt(color, 10);
  if (!isNaN(num) && num >= 0 && num <= 255) {
    return `${CSI}${isFg ? 38 : 48};5;${num}m`;
  }

  return "";
}
