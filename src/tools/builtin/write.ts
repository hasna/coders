/**
 * Write tool — create or overwrite files
 *
 * Features (matching Claude Code's Write tool):
 *   - Write content to absolute path
 *   - Create parent directories if needed
 *   - Require Read first for existing files
 *   - Track file writes
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve, isAbsolute } from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import { WRITE_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";
import { hasFileBeenRead, markFileAsRead } from "./read.js";
import { dbRun } from "../../db/index.js";

// ── Schemas ────────────────────────────────────────────────────────

const WriteInputSchema = z.strictObject({
  file_path: z.string().describe("The absolute path to the file to write"),
  content: z.string().describe("The content to write to the file"),
});

type WriteInput = z.infer<typeof WriteInputSchema>;

interface WriteOutput {
  filePath: string;
  bytesWritten: number;
  created: boolean;
}

const WriteOutputSchema = z.object({
  filePath: z.string(),
  bytesWritten: z.number(),
  created: z.boolean(),
});

// ── Write Tool ─────────────────────────────────────────────────────

export const writeTool: Tool<WriteInput, WriteOutput> = {
  name: WRITE_TOOL,
  searchHint: "create new files or overwrite existing files",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: false,

  async description(input) {
    return input?.file_path ? `Write to ${input.file_path}` : "Write a file";
  },

  async prompt() {
    return WRITE_PROMPT;
  },

  get inputSchema() { return WriteInputSchema; },
  get outputSchema() { return WriteOutputSchema; },

  userFacingName() { return "Write"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return false; },
  isReadOnly() { return false; },

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
    // Prevent writing excessively large files (>10MB)
    const MAX_WRITE_SIZE = 10 * 1024 * 1024;
    if (input.content && input.content.length > MAX_WRITE_SIZE) {
      return { result: false, message: `Content too large (${(input.content.length / 1024 / 1024).toFixed(1)}MB > 10MB limit)`, errorCode: 2 };
    }
    return { result: true };
  },

  async checkPermissions(input) {
    return { behavior: "passthrough" };
  },

  async call(input, context): Promise<ToolCallResult<WriteOutput>> {
    if (!input.file_path || typeof input.file_path !== "string") {
      return { data: { filePath: "", bytesWritten: 0, created: false } };
    }
    const resolved = resolvePath(input.file_path);
    const created = !existsSync(resolved);

    // Existing files must be read before overwriting (prevents blind overwrites)
    if (!created && !hasFileBeenRead(resolved)) {
      return {
        data: { filePath: resolved, bytesWritten: 0, created: false },
        error: `File "${input.file_path}" has not been read yet. Use the Read tool first to review existing content before overwriting.`,
      };
    }

    // Create parent directories
    const dir = dirname(resolved);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Save checkpoint BEFORE overwriting existing files (for /rewind and /undo support)
    if (!created) {
      try {
        const originalContent = readFileSync(resolved, "utf-8");
        const cpId = randomUUID();
        dbRun(
          "INSERT INTO checkpoints (id, session_id, file_path, original_content, edit_operation) VALUES (?, ?, ?, ?, ?)",
          [cpId, "current", resolved, originalContent, JSON.stringify({ type: "write_overwrite" })],
        );
      } catch { /* checkpoint failures shouldn't block write */ }
    }

    // Write the file
    writeFileSync(resolved, input.content, "utf-8");

    // Mark as read for subsequent edits
    markFileAsRead(resolved);

    return {
      data: {
        filePath: resolved,
        bytesWritten: Buffer.byteLength(input.content, "utf-8"),
        created,
      },
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    const action = result.created ? "Created" : "Updated";
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `${action} ${result.filePath} (${result.bytesWritten} bytes)`,
    };
  },
};

// ── Helpers ────────────────────────────────────────────────────────

function resolvePath(filePath: string): string {
  if (isAbsolute(filePath)) return filePath;
  return resolve(process.cwd(), filePath);
}

// ── Prompt ─────────────────────────────────────────────────────────

const WRITE_PROMPT = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents.
- Prefer the Edit tool for modifying existing files — it only sends the diff.
- Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested.`;
