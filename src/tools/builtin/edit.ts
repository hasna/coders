/**
 * Edit tool — exact string replacement in files
 *
 * Features (matching Claude Code's 17-tools-edit.js):
 *   - Simple mode: old_string -> new_string replacement
 *   - replace_all flag for global replacement
 *   - Requires file to have been Read first
 *   - Generates structured patch and git diff
 *   - Validates old_string uniqueness
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";
import { resolve, isAbsolute } from "path";
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import { EDIT_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";
import { hasFileBeenRead, markFileAsRead } from "./read.js";

// ── Schemas ────────────────────────────────────────────────────────

const EditInputSchema = z.strictObject({
  file_path: z.string().describe("The absolute path to the file to modify"),
  old_string: z.string().describe("The text to replace"),
  new_string: z.string().describe("The text to replace it with (must be different from old_string)"),
  replace_all: z.boolean().default(false).describe("Replace all occurrences (default false)"),
});

type EditInput = z.infer<typeof EditInputSchema>;

interface EditOutput {
  filePath: string;
  oldString: string;
  newString: string;
  replacements: number;
  originalFile: string;
  gitDiff?: string;
}

const EditOutputSchema = z.object({
  filePath: z.string(),
  oldString: z.string(),
  newString: z.string(),
  replacements: z.number(),
  originalFile: z.string(),
  gitDiff: z.string().optional(),
});

// ── Edit Tool ──────────────────────────────────────────────────────

export const editTool: Tool<EditInput, EditOutput> = {
  name: EDIT_TOOL,
  searchHint: "replace text in files using exact string matching",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: false,

  async description(input) {
    return input?.file_path ? `Edit ${input.file_path}` : "Edit a file";
  },

  async prompt() {
    return EDIT_PROMPT;
  },

  get inputSchema() { return EditInputSchema; },
  get outputSchema() { return EditOutputSchema; },

  userFacingName() { return "Edit"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return false; },
  isReadOnly() { return false; },

  toAutoClassifierInput(input) {
    return `${input.file_path}: ${input.old_string} -> ${input.new_string}`;
  },

  getPath(input) {
    return resolvePath(input.file_path);
  },

  async validateInput(input) {
    if (!input.file_path) {
      return { result: false, message: "file_path is required", errorCode: 1 };
    }
    if (input.old_string === input.new_string) {
      return { result: false, message: "old_string and new_string must be different", errorCode: 2 };
    }

    const resolved = resolvePath(input.file_path);

    if (!existsSync(resolved)) {
      return { result: false, message: `File does not exist: ${input.file_path}`, errorCode: 3 };
    }

    // Check if file was read first
    if (!hasFileBeenRead(resolved)) {
      return {
        result: false,
        message: "You must Read this file before editing it. Use the Read tool first.",
        errorCode: 4,
      };
    }

    // Check uniqueness of old_string
    const content = readFileSync(resolved, "utf-8");
    const count = countOccurrences(content, input.old_string);

    if (count === 0) {
      return {
        result: false,
        message: `old_string not found in file. Make sure you're using the exact text including whitespace and indentation.`,
        errorCode: 5,
      };
    }

    if (count > 1 && !input.replace_all) {
      return {
        result: false,
        message: `old_string found ${count} times in the file. Either provide more surrounding context to make it unique, or set replace_all to true.`,
        errorCode: 6,
      };
    }

    return { result: true };
  },

  async checkPermissions(input) {
    return { behavior: "passthrough" };
  },

  async call(input, context): Promise<ToolCallResult<EditOutput>> {
    const resolved = resolvePath(input.file_path);
    const originalContent = readFileSync(resolved, "utf-8");

    let newContent: string;
    let replacements: number;

    if (input.replace_all) {
      const parts = originalContent.split(input.old_string);
      replacements = parts.length - 1;
      newContent = parts.join(input.new_string);
    } else {
      const idx = originalContent.indexOf(input.old_string);
      if (idx === -1) {
        return {
          data: {
            filePath: resolved,
            oldString: input.old_string,
            newString: input.new_string,
            replacements: 0,
            originalFile: originalContent,
          },
        };
      }
      newContent =
        originalContent.slice(0, idx) +
        input.new_string +
        originalContent.slice(idx + input.old_string.length);
      replacements = 1;
    }

    // Write the file
    writeFileSync(resolved, newContent, "utf-8");

    // Mark as read (so subsequent edits work)
    markFileAsRead(resolved);

    // Generate simple diff
    const gitDiff = generateSimpleDiff(originalContent, newContent, input.file_path);

    return {
      data: {
        filePath: resolved,
        oldString: input.old_string,
        newString: input.new_string,
        replacements,
        originalFile: originalContent,
        gitDiff,
      },
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    const msg = result.replacements > 0
      ? `Successfully edited ${result.filePath} (${result.replacements} replacement${result.replacements > 1 ? "s" : ""})`
      : `No replacements made in ${result.filePath}`;

    const content = result.gitDiff
      ? `${msg}\n\n${result.gitDiff}`
      : msg;

    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content,
    };
  },
};

// ── Helpers ────────────────────────────────────────────────────────

function resolvePath(filePath: string): string {
  if (isAbsolute(filePath)) return filePath;
  return resolve(process.cwd(), filePath);
}

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

function generateSimpleDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  // Simple line-by-line diff (not a full unified diff algorithm)
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
    } else {
      // Find the changed region
      const contextStart = Math.max(0, i - 2);
      lines.push(`@@ -${contextStart + 1} @@`);

      // Show removed lines
      while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
        lines.push(`-${oldLines[i]}`);
        i++;
        if (lines.length > 50) break; // limit diff size
      }
      // Show added lines
      while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
        lines.push(`+${newLines[j]}`);
        j++;
        if (lines.length > 100) break;
      }
      if (lines.length > 100) {
        lines.push("... (diff truncated)");
        break;
      }
    }
  }

  return lines.length > 2 ? lines.join("\n") : "";
}

// ── Prompt ─────────────────────────────────────────────────────────

const EDIT_PROMPT = `Performs exact string replacements in files.

Usage:
- You must use the Read tool at least once before editing. This tool will error if you attempt an edit without reading the file.
- The edit will FAIL if old_string is not unique in the file. Provide more surrounding context to make it unique, or use replace_all.
- Use replace_all for renaming variables or strings across the file.
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.
- Preserve exact indentation (tabs/spaces) as it appears in the file.`;
