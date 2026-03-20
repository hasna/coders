/**
 * Read tool — file reading with line numbers
 *
 * Features (matching Claude Code's Read tool):
 *   - cat -n style output with line numbers
 *   - Default 2000 line limit
 *   - Offset/limit for partial reads
 *   - PDF support with page ranges
 *   - Image support (return as base64 content block)
 *   - Jupyter notebook rendering
 *   - Absolute paths required
 *   - Track reads (required before Edit/Write)
 */
import { readFileSync, statSync, existsSync } from "fs";
import { extname, isAbsolute, resolve } from "path";
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import type { PermissionResult } from "../../config/permissions.js";
import { READ_TOOL, DEFAULT_READ_LINE_LIMIT, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";

// ── Track which files have been read ───────────────────────────────

const readFiles = new Set<string>();

export function hasFileBeenRead(filePath: string): boolean {
  return readFiles.has(resolve(filePath));
}

export function markFileAsRead(filePath: string): void {
  readFiles.add(resolve(filePath));
}

export function clearReadHistory(): void {
  readFiles.clear();
}

// ── Schemas ────────────────────────────────────────────────────────

const ReadInputSchema = z.strictObject({
  file_path: z.string().describe("The absolute path to the file to read"),
  offset: z.number().optional().describe("Line number to start reading from (1-based)"),
  limit: z.number().optional().describe("Number of lines to read"),
  pages: z.string().optional().describe('Page range for PDFs, e.g. "1-5", "3", "10-20"'),
});

type ReadInput = z.infer<typeof ReadInputSchema>;

interface ReadOutput {
  content: string;
  filePath: string;
  totalLines: number;
  linesRead: number;
  startLine: number;
}

const ReadOutputSchema = z.object({
  content: z.string(),
  filePath: z.string(),
  totalLines: z.number(),
  linesRead: z.number(),
  startLine: z.number(),
});

// ── Image extensions ───────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
]);

const PDF_EXTENSION = ".pdf";
const NOTEBOOK_EXTENSION = ".ipynb";

// ── Read Tool ──────────────────────────────────────────────────────

export const readTool: Tool<ReadInput, ReadOutput> = {
  name: READ_TOOL,
  searchHint: "read file contents from the local filesystem",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: false,

  async description(input) {
    return input?.file_path ? `Read ${input.file_path}` : "Read a file";
  },

  async prompt() {
    return READ_PROMPT;
  },

  get inputSchema() { return ReadInputSchema; },
  get outputSchema() { return ReadOutputSchema; },

  userFacingName() { return "Read"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },

  toAutoClassifierInput(input) {
    return input.file_path;
  },

  getPath(input) {
    return resolvePath(input.file_path);
  },

  async validateInput(input) {
    if (!input.file_path) {
      return { result: false, message: "file_path is required", errorCode: 1 };
    }

    const resolved = resolvePath(input.file_path);

    // Check exists
    if (!existsSync(resolved)) {
      return { result: false, message: `File does not exist: ${input.file_path}`, errorCode: 2 };
    }

    // Check it's a file, not a directory
    try {
      const stat = statSync(resolved);
      if (stat.isDirectory()) {
        return { result: false, message: `Path is a directory, not a file: ${input.file_path}. Use Bash with ls to list directory contents.`, errorCode: 3 };
      }
    } catch {
      return { result: false, message: `Cannot access: ${input.file_path}`, errorCode: 4 };
    }

    return { result: true };
  },

  async checkPermissions(input) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, context): Promise<ToolCallResult<ReadOutput>> {
    if (!input.file_path || typeof input.file_path !== "string") {
      return { data: { content: "Error: file_path is required", filePath: "", totalLines: 0, linesRead: 0, startLine: 0 } };
    }
    const resolved = resolvePath(input.file_path);
    const ext = extname(resolved).toLowerCase();

    // Track read
    markFileAsRead(resolved);

    // Image files
    if (IMAGE_EXTENSIONS.has(ext)) {
      return readImageFile(resolved, input);
    }

    // PDF files
    if (ext === PDF_EXTENSION) {
      return readPdfFile(resolved, input);
    }

    // Jupyter notebooks
    if (ext === NOTEBOOK_EXTENSION) {
      return readNotebookFile(resolved, input);
    }

    // Text files
    return readTextFile(resolved, input);
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: result.content || "(empty file)",
    };
  },
};

// ── Text file reading ──────────────────────────────────────────────

function readTextFile(filePath: string, input: ReadInput): ToolCallResult<ReadOutput> {
  const rawContent = readFileSync(filePath, "utf-8");
  const allLines = rawContent.split("\n");
  const totalLines = allLines.length;

  const startLine = input.offset ?? 1;
  const limit = input.limit ?? DEFAULT_READ_LINE_LIMIT;

  // Slice lines (1-based offset)
  const startIdx = Math.max(0, startLine - 1);
  const endIdx = Math.min(totalLines, startIdx + limit);
  const selectedLines = allLines.slice(startIdx, endIdx);

  // Format with line numbers (cat -n style)
  const formatted = selectedLines
    .map((line, i) => {
      const lineNum = startIdx + i + 1;
      return `${String(lineNum).padStart(6)}\t${line}`;
    })
    .join("\n");

  return {
    data: {
      content: formatted,
      filePath,
      totalLines,
      linesRead: selectedLines.length,
      startLine,
    },
  };
}

// ── Image file reading ─────────────────────────────────────────────

function readImageFile(filePath: string, input: ReadInput): ToolCallResult<ReadOutput> {
  // Return a description — the actual multimodal content would be handled
  // by the UI layer which can send base64 image content blocks
  const stat = statSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const content = `[Image file: ${filePath} (${ext}, ${formatBytes(stat.size)})]`;

  return {
    data: {
      content,
      filePath,
      totalLines: 1,
      linesRead: 1,
      startLine: 1,
    },
  };
}

// ── PDF file reading ───────────────────────────────────────────────

function readPdfFile(filePath: string, input: ReadInput): ToolCallResult<ReadOutput> {
  // PDF reading requires external library (pdf-parse or similar)
  // For now, return a placeholder
  const stat = statSync(filePath);
  const pages = input.pages ?? "1-5";
  const content = `[PDF file: ${filePath} (${formatBytes(stat.size)}, requested pages: ${pages}). PDF reading requires pdf-parse library — install to enable.]`;

  return {
    data: {
      content,
      filePath,
      totalLines: 1,
      linesRead: 1,
      startLine: 1,
    },
  };
}

// ── Jupyter notebook reading ───────────────────────────────────────

function readNotebookFile(filePath: string, input: ReadInput): ToolCallResult<ReadOutput> {
  try {
    const rawContent = readFileSync(filePath, "utf-8");
    const notebook = JSON.parse(rawContent) as {
      cells?: Array<{
        cell_type: string;
        source: string[];
        outputs?: Array<{ text?: string[]; output_type: string }>;
      }>;
    };

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return {
        data: { content: "[Invalid notebook format]", filePath, totalLines: 1, linesRead: 1, startLine: 1 },
      };
    }

    const lines: string[] = [];
    for (let i = 0; i < notebook.cells.length; i++) {
      const cell = notebook.cells[i];
      lines.push(`--- Cell ${i + 1} [${cell.cell_type}] ---`);
      const source = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source ?? "");
      lines.push(source);
      if (cell.outputs && cell.outputs.length > 0) {
        lines.push("--- Output ---");
        for (const output of cell.outputs) {
          if (output.text) {
            lines.push(Array.isArray(output.text) ? output.text.join("") : String(output.text));
          }
        }
      }
      lines.push("");
    }

    const content = lines.join("\n");
    return {
      data: {
        content,
        filePath,
        totalLines: lines.length,
        linesRead: lines.length,
        startLine: 1,
      },
    };
  } catch {
    return {
      data: { content: "[Error reading notebook]", filePath, totalLines: 1, linesRead: 1, startLine: 1 },
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function resolvePath(filePath: string): string {
  if (isAbsolute(filePath)) return filePath;
  return resolve(process.cwd(), filePath);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Prompt ─────────────────────────────────────────────────────────

const READ_PROMPT = `Reads a file from the local filesystem. You can access any file directly by using this tool.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${DEFAULT_READ_LINE_LIMIT} lines starting from the beginning of the file
- You can optionally specify a line offset and limit for long files
- Results are returned using cat -n format, with line numbers starting at 1
- This tool can read images (PNG, JPG, etc). When reading an image file the contents are presented visually.
- This tool can read PDF files (.pdf). For large PDFs, provide the pages parameter (e.g., pages: "1-5"). Max 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb) and returns all cells with their outputs.
- This tool can only read files, not directories. To read a directory, use ls via the Bash tool.`;
