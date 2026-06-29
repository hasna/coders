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
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { resolve, isAbsolute } from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { Tool, ToolCallResult } from "../interface.js";
import { EDIT_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";
import { hasFileBeenRead, markFileAsRead } from "./read.js";
import { dbRun } from "../../db/index.js";

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

  async checkPermissions(_input) {
    return { behavior: "passthrough" };
  },

  async call(input, _context): Promise<ToolCallResult<EditOutput>> {
    if (!input.file_path || typeof input.file_path !== "string") {
      return { data: { filePath: "", oldString: "", newString: "", replacements: 0, originalFile: "" } };
    }
    if (!input.old_string || typeof input.old_string !== "string") {
      return { data: { filePath: input.file_path, oldString: "", newString: "", replacements: 0, originalFile: "" } };
    }
    const resolved = resolvePath(input.file_path);

    // Guard against reading extremely large files (>50MB)
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    try {
      const fileSize = statSync(resolved).size;
      if (fileSize > MAX_FILE_SIZE) {
        return {
          data: {
            filePath: resolved,
            oldString: input.old_string,
            newString: input.new_string,
            replacements: 0,
            originalFile: "",
            gitDiff: undefined,
          },
          error: `File too large (${(fileSize / 1024 / 1024).toFixed(1)}MB > 50MB limit). Split the file or use Bash tool for large file edits.`,
        };
      }
    } catch { /* statSync failure will be caught by readFileSync below */ }

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

    // Save checkpoint BEFORE writing (for /rewind support)
    try {
      const cpId = randomUUID();
      dbRun(
        "INSERT INTO checkpoints (id, session_id, file_path, original_content, edit_operation) VALUES (?, ?, ?, ?, ?)",
        [cpId, "current", resolved, originalContent, JSON.stringify({ old_string: input.old_string, new_string: input.new_string })],
      );
    } catch { /* checkpoint failures shouldn't block edit */ }

    // Write the file
    writeFileSync(resolved, newContent, "utf-8");

    // Mark as read (so subsequent edits work)
    markFileAsRead(resolved);

    // Generate proper unified diff
    const gitDiff = generateUnifiedDiff(originalContent, newContent, input.file_path);

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

/**
 * Generate a proper unified diff between two strings.
 * Shows context lines around changes, matching `diff -u` format.
 */
function generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const CONTEXT = 3; // lines of context around changes
  const result: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  // Find changed regions
  const hunks = findDiffHunks(oldLines, newLines, CONTEXT);

  for (const hunk of hunks) {
    const { oldStart, oldCount, newStart, newCount, lines } = hunk;
    result.push(`@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@`);
    result.push(...lines);
  }

  return result.length > 2 ? result.join("\n") : "";
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

function findDiffHunks(oldLines: string[], newLines: string[], context: number): DiffHunk[] {
  // Find changed line ranges by comparing old vs new line-by-line
  const hunks: DiffHunk[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  let i = 0;

  while (i < maxLen) {
    // Skip matching lines
    if (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) {
      i++;
      continue;
    }

    // Found a change — find the end of the differing region
    const changeStart = i;
    // Scan forward in both to find where they resync
    let oi = i, ni = i;
    while (oi < oldLines.length || ni < newLines.length) {
      // Check if we've resynced (next N lines match)
      let synced = true;
      for (let k = 0; k < 3 && synced; k++) {
        if (oi + k >= oldLines.length || ni + k >= newLines.length || oldLines[oi + k] !== newLines[ni + k]) synced = false;
      }
      if (synced && oi > changeStart) break;

      // Advance the shorter side, or both
      if (oi < oldLines.length && ni < newLines.length) { oi++; ni++; }
      else if (oi < oldLines.length) oi++;
      else ni++;
    }

    // Build hunk with context
    const ctxBefore = Math.max(0, changeStart - context);
    const ctxAfterOld = Math.min(oi + context, oldLines.length);
    const ctxAfterNew = Math.min(ni + context, newLines.length);
    const hunkLines: string[] = [];

    for (let c = ctxBefore; c < changeStart; c++) hunkLines.push(` ${oldLines[c]}`);
    for (let c = changeStart; c < oi; c++) hunkLines.push(`-${oldLines[c]}`);
    for (let c = changeStart; c < ni; c++) hunkLines.push(`+${newLines[c]}`);
    for (let c = oi; c < ctxAfterOld && c < oldLines.length; c++) {
      if (c < newLines.length && oldLines[c] === newLines[c + (ni - oi)]) hunkLines.push(` ${oldLines[c]}`);
    }

    hunks.push({
      oldStart: ctxBefore,
      oldCount: ctxAfterOld - ctxBefore,
      newStart: ctxBefore,
      newCount: ctxAfterNew - ctxBefore,
      lines: hunkLines,
    });

    i = Math.max(oi, ni);
    if (hunks.length > 20) break;
  }

  return hunks;
}

// ── Prompt ─────────────────────────────────────────────────────────

const EDIT_PROMPT = `Performs exact string replacements in files.

Usage:
- You must use the Read tool at least once before editing. This tool will error if you attempt an edit without reading the file.
- The edit will FAIL if old_string is not unique in the file. Provide more surrounding context to make it unique, or use replace_all.
- Use replace_all for renaming variables or strings across the file.
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.
- Preserve exact indentation (tabs/spaces) as it appears in the file.`;
