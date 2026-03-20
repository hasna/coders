/**
 * Write tool — create or overwrite files
 *
 * Features (matching Claude Code's Write tool):
 *   - Write content to absolute path
 *   - Create parent directories if needed
 *   - Require Read first for existing files
 *   - Track file writes
 */
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve, isAbsolute } from "path";
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import { WRITE_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";
import { hasFileBeenRead, markFileAsRead } from "./read.js";

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

    const resolved = resolvePath(input.file_path);

    // If file exists, require it to have been read first
    if (existsSync(resolved) && !hasFileBeenRead(resolved)) {
      return {
        result: false,
        message: "This file already exists. You must Read it first before overwriting. Use the Read tool, then retry.",
        errorCode: 2,
      };
    }

    return { result: true };
  },

  async checkPermissions(input) {
    return { behavior: "passthrough" };
  },

  async call(input, context): Promise<ToolCallResult<WriteOutput>> {
    const resolved = resolvePath(input.file_path);
    const created = !existsSync(resolved);

    // Create parent directories
    const dir = dirname(resolved);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
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
