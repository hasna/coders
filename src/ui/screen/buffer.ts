/**
 * Screen buffer — cell-based terminal rendering with damage tracking
 *
 * Mirrors Claude Code's screen buffer (31-ui.js):
 *   - Cell grid backed by typed arrays for performance
 *   - Each cell stores: character, style, hyperlink, width
 *   - Dirty rectangle tracking for incremental redraws
 *   - ANSI diff engine for minimal escape sequence patches
 */

// ── Cell representation ────────────────────────────────────────────

export interface Cell {
  char: string;
  styleId: number;
  hyperlinkId: number;
  width: number; // 0 for continuation cells (wide chars)
}

// ── Style pool ─────────────────────────────────────────────────────

export interface CellStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
}

export class StylePool {
  private styles: CellStyle[] = [{}]; // index 0 = default/reset
  private lookup = new Map<string, number>();

  constructor() {
    this.lookup.set("{}", 0);
  }

  getOrAdd(style: CellStyle): number {
    const key = JSON.stringify(style);
    const existing = this.lookup.get(key);
    if (existing !== undefined) return existing;

    const id = this.styles.length;
    this.styles.push(style);
    this.lookup.set(key, id);
    return id;
  }

  get(id: number): CellStyle {
    return this.styles[id] ?? {};
  }

  get size(): number {
    return this.styles.length;
  }
}

// ── Damage tracking ────────────────────────────────────────────────

export interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Screen buffer ──────────────────────────────────────────────────

export class ScreenBuffer {
  width: number;
  height: number;
  cells: Cell[][];
  dirtyRects: DirtyRect[] = [];
  stylePool: StylePool;
  private fullDirty = true;

  constructor(width: number, height: number, stylePool?: StylePool) {
    this.width = width;
    this.height = height;
    this.stylePool = stylePool ?? new StylePool();
    this.cells = this.createGrid(width, height);
  }

  private createGrid(width: number, height: number): Cell[][] {
    const grid: Cell[][] = [];
    for (let y = 0; y < height; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < width; x++) {
        row.push({ char: " ", styleId: 0, hyperlinkId: 0, width: 1 });
      }
      grid.push(row);
    }
    return grid;
  }

  /**
   * Set a cell at (x, y).
   */
  setCell(x: number, y: number, char: string, styleId = 0, width = 1): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;

    const cell = this.cells[y][x];
    if (cell.char !== char || cell.styleId !== styleId || cell.width !== width) {
      cell.char = char;
      cell.styleId = styleId;
      cell.width = width;
      this.markDirty(x, y, 1, 1);
    }
  }

  /**
   * Write a string starting at (x, y) with a style.
   */
  writeString(x: number, y: number, text: string, styleId = 0): void {
    let col = x;
    for (const char of text) {
      if (col >= this.width) break;
      this.setCell(col, y, char, styleId);
      col++;
    }
  }

  /**
   * Clear a rectangular region.
   */
  clearRegion(x: number, y: number, width: number, height: number): void {
    for (let row = y; row < y + height && row < this.height; row++) {
      for (let col = x; col < x + width && col < this.width; col++) {
        this.setCell(col, row, " ", 0);
      }
    }
  }

  /**
   * Clear entire buffer.
   */
  clear(): void {
    this.clearRegion(0, 0, this.width, this.height);
    this.fullDirty = true;
  }

  /**
   * Resize the buffer.
   */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;

    const newGrid = this.createGrid(width, height);

    // Copy existing content
    const copyRows = Math.min(this.height, height);
    const copyCols = Math.min(this.width, width);
    for (let y = 0; y < copyRows; y++) {
      for (let x = 0; x < copyCols; x++) {
        newGrid[y][x] = { ...this.cells[y][x] };
      }
    }

    this.cells = newGrid;
    this.width = width;
    this.height = height;
    this.fullDirty = true;
    this.dirtyRects = [];
  }

  /**
   * Mark a region as dirty (needs redraw).
   */
  markDirty(x: number, y: number, width: number, height: number): void {
    this.dirtyRects.push({ x, y, width, height });
  }

  /**
   * Check if any region needs redrawing.
   */
  isDirty(): boolean {
    return this.fullDirty || this.dirtyRects.length > 0;
  }

  /**
   * Check if a full redraw is needed.
   */
  needsFullRedraw(): boolean {
    return this.fullDirty;
  }

  /**
   * Get and clear dirty state.
   */
  consumeDirty(): { full: boolean; rects: DirtyRect[] } {
    const result = { full: this.fullDirty, rects: [...this.dirtyRects] };
    this.fullDirty = false;
    this.dirtyRects = [];
    return result;
  }

  /**
   * Get a cell at position.
   */
  getCell(x: number, y: number): Cell | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.cells[y][x];
  }

  /**
   * Get a row as a string (for debugging/testing).
   */
  getRowText(y: number): string {
    if (y < 0 || y >= this.height) return "";
    return this.cells[y].map((c) => c.char).join("");
  }
}

// ── Factory ────────────────────────────────────────────────────────

export function createScreen(width: number, height: number): ScreenBuffer {
  return new ScreenBuffer(width, height);
}
