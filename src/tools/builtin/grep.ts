/**
 * Grep tool — content search powered by ripgrep
 *
 * Features (matching Claude Code's Grep tool / 19-tools-grep.js):
 *   - Ripgrep wrapper with regex support
 *   - Glob and type filters
 *   - Output modes: content, files_with_matches, count
 *   - Context lines (-A/-B/-C)
 *   - Case insensitive, line numbers, multiline
 *   - head_limit and offset
 *   - Timeout with partial results
 *   - Default ignore patterns (.git, node_modules, etc.)
 */
import { execFileSync, execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
import { resolve, isAbsolute } from "path";
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import { RipgrepTimeoutError } from "../../core/errors.js";
import { GREP_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";

// ── Schemas ────────────────────────────────────────────────────────

const GrepInputSchema = z.strictObject({
  pattern: z.string().describe("The regular expression pattern to search for"),
  path: z.string().optional().describe("File or directory to search in. Defaults to cwd."),
  glob: z.string().optional().describe('Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")'),
  type: z.string().optional().describe("File type filter (js, py, rust, go, etc.)"),
  output_mode: z.enum(["content", "files_with_matches", "count"]).optional()
    .describe('Output mode. Defaults to "files_with_matches".'),
  "-A": z.number().optional().describe("Lines to show after each match"),
  "-B": z.number().optional().describe("Lines to show before each match"),
  "-C": z.number().optional().describe("Alias for context"),
  context: z.number().optional().describe("Lines to show before and after each match"),
  "-i": z.boolean().optional().describe("Case insensitive search"),
  "-n": z.boolean().optional().describe("Show line numbers (default true)"),
  multiline: z.boolean().optional().describe("Enable multiline mode"),
  head_limit: z.number().optional().describe("Limit output to first N entries"),
  offset: z.number().optional().describe("Skip first N entries"),
});

type GrepInput = z.infer<typeof GrepInputSchema>;

interface GrepOutput {
  content: string;
  matchCount: number;
  fileCount: number;
  truncated: boolean;
}

const GrepOutputSchema = z.object({
  content: z.string(),
  matchCount: z.number(),
  fileCount: z.number(),
  truncated: z.boolean(),
});

// ── Default ignore patterns ────────────────────────────────────────

const DEFAULT_GLOBS_IGNORE = [
  "!.git",
  "!node_modules",
  "!.vscode",
  "!.idea",
  "!dist",
  "!build",
  "!coverage",
  "!__pycache__",
  "!.next",
  "!*.min.js",
  "!*.min.css",
  "!*.map",
  "!package-lock.json",
  "!yarn.lock",
  "!bun.lock",
  "!pnpm-lock.yaml",
];

const DEFAULT_FILE_IGNORE = [
  ".gitconfig",
  ".gitmodules",
  ".bashrc",
  ".bash_history",
  ".zsh_history",
];

// ── Resolve ripgrep binary ─────────────────────────────────────────

function resolveRipgrepBinary(): string {
  // Check env override
  if (process.env.RIPGREP_PATH) return process.env.RIPGREP_PATH;

  // Try system rg — use "where" on Windows, "which" elsewhere
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    execFileSync(whichCmd, ["rg"], { stdio: "pipe" });
    return "rg";
  } catch {
    // Fallback: try common paths
    const paths = ["/usr/local/bin/rg", "/usr/bin/rg", "/opt/homebrew/bin/rg"];
    for (const p of paths) {
      try {
        execFileSync(p, ["--version"], { stdio: "pipe" });
        return p;
      } catch { /* continue */ }
    }
  }
  return "rg"; // hope for the best
}

let _rgPath: string | null = null;
function getRg(): string {
  if (!_rgPath) _rgPath = resolveRipgrepBinary();
  return _rgPath;
}

// ── Grep Tool ──────────────────────────────────────────────────────

export const grepTool: Tool<GrepInput, GrepOutput> = {
  name: GREP_TOOL,
  searchHint: "search file contents using regex (ripgrep)",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: false,

  async description(input) {
    return input?.pattern ? `Search for: ${input.pattern}` : "Search file contents";
  },

  async prompt() {
    return GREP_PROMPT;
  },

  get inputSchema() { return GrepInputSchema; },
  get outputSchema() { return GrepOutputSchema; },

  userFacingName() { return "Grep"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },

  toAutoClassifierInput(input) {
    return input.pattern;
  },

  async validateInput(input) {
    if (!input.pattern || !input.pattern.trim()) {
      return { result: false, message: "pattern is required", errorCode: 1 };
    }
    return { result: true };
  },

  async checkPermissions(input) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, context): Promise<ToolCallResult<GrepOutput>> {
    const rg = getRg();
    const searchPath = input.path ? resolvePath(input.path) : process.cwd();
    const outputMode = input.output_mode ?? "files_with_matches";

    // Build ripgrep args
    const args: string[] = [];

    // Output mode
    if (outputMode === "files_with_matches") {
      args.push("--files-with-matches");
    } else if (outputMode === "count") {
      args.push("--count");
    }
    // "content" mode: default rg output

    // Options
    if (input["-i"]) args.push("--ignore-case");
    if (input["-n"] !== false && outputMode === "content") args.push("--line-number");
    if (input.multiline) args.push("--multiline", "--multiline-dotall");

    // Context
    const contextLines = input["-C"] ?? input.context;
    if (contextLines !== undefined && outputMode === "content") {
      args.push("-C", String(contextLines));
    } else {
      if (input["-A"] !== undefined && outputMode === "content") args.push("-A", String(input["-A"]));
      if (input["-B"] !== undefined && outputMode === "content") args.push("-B", String(input["-B"]));
    }

    // Glob filter
    if (input.glob) {
      args.push("--glob", input.glob);
    }

    // Type filter
    if (input.type) {
      args.push("--type", input.type);
    }

    // Ignore patterns
    for (const pattern of DEFAULT_GLOBS_IGNORE) {
      args.push("--glob", pattern);
    }
    for (const file of DEFAULT_FILE_IGNORE) {
      args.push("--glob", `!${file}`);
    }

    // Pattern and path
    args.push("--", input.pattern, searchPath);

    try {
      const { stdout: result } = await execFileAsync(rg, args, {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: 30_000,
      });

      return processOutput(result, input);
    } catch (error: unknown) {
      const err = error as { code?: number; stdout?: string; stderr?: string; killed?: boolean };

      // Exit code 1 = no matches (not an error), but only if stderr is empty.
      if (err.code === 1 && (!err.stderr || err.stderr.trim() === "")) {
        return {
          data: { content: "No matches found.", matchCount: 0, fileCount: 0, truncated: false },
        };
      }

      // Timeout with partial results
      if (err.killed && err.stdout) {
        return processOutput(err.stdout, input, true);
      }

      // Real error
      const stderr = err.stderr ?? "";
      return {
        data: {
          content: `Grep error: ${stderr || "unknown error"}`,
          matchCount: 0,
          fileCount: 0,
          truncated: false,
        },
      };
    }
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    let content = result.content;
    if (result.truncated) {
      content += "\n(results truncated due to timeout or limit)";
    }
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: content || "No matches found.",
    };
  },
};

// ── Output processing ──────────────────────────────────────────────

function processOutput(
  raw: string,
  input: GrepInput,
  truncated = false,
): ToolCallResult<GrepOutput> {
  let lines = raw.split("\n").filter((l) => l.length > 0);
  const totalLines = lines.length;

  // Apply offset
  if (input.offset && input.offset > 0) {
    lines = lines.slice(input.offset);
  }

  // Apply head_limit
  if (input.head_limit && input.head_limit > 0) {
    if (lines.length > input.head_limit) {
      lines = lines.slice(0, input.head_limit);
      truncated = true;
    }
  }

  // Count unique files — handle content mode (file:line:text) vs files_with_matches (file)
  const fileSet = new Set<string>();
  const isContentMode = (input.output_mode ?? "files_with_matches") === "content";
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isContentMode) {
      // Content mode: "file:line:text" — match rg output format
      const match = line.match(/^(.+?):(\d+):/);
      if (match) fileSet.add(match[1]);
      else fileSet.add(line.split(":")[0] || line);
    } else {
      // files_with_matches or count mode: line is the file path
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) fileSet.add(line.slice(0, colonIdx));
      else fileSet.add(line);
    }
  }

  return {
    data: {
      content: lines.join("\n"),
      matchCount: totalLines,
      fileCount: fileSet.size,
      truncated,
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function resolvePath(p: string): string {
  if (isAbsolute(p)) return p;
  return resolve(process.cwd(), p);
}

// ── Prompt ─────────────────────────────────────────────────────────

const GREP_PROMPT = `A powerful search tool built on ripgrep.

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke grep or rg as a Bash command.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py")
- Output modes: "content" shows matching lines, "files_with_matches" shows file paths (default), "count" shows match counts
- Use Agent tool for open-ended searches requiring multiple rounds
- Multiline matching: use multiline: true for cross-line patterns`;
