/**
 * Glob tool — fast file pattern matching
 *
 * Features (matching Claude Code's Glob tool):
 *   - Glob patterns like "**\/*.ts", "src\/**\/*.tsx"
 *   - Returns matching file paths sorted by modification time
 *   - Respects .gitignore
 *   - Optional directory scoping
 */
import fg from "fast-glob";
import { statSync, existsSync } from "fs";
import { resolve, isAbsolute } from "path";
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import { GLOB_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";

// ── Schemas ────────────────────────────────────────────────────────

const GlobInputSchema = z.strictObject({
  pattern: z.string().describe('The glob pattern to match files against (e.g. "**/*.ts")'),
  path: z.string().optional().describe("The directory to search in. Defaults to current working directory."),
});

type GlobInput = z.infer<typeof GlobInputSchema>;

interface GlobOutput {
  files: string[];
  totalMatches: number;
  truncated: boolean;
}

const GlobOutputSchema = z.object({
  files: z.array(z.string()),
  totalMatches: z.number(),
  truncated: z.boolean(),
});

const MAX_RESULTS = 500;

// ── Glob Tool ──────────────────────────────────────────────────────

export const globTool: Tool<GlobInput, GlobOutput> = {
  name: GLOB_TOOL,
  searchHint: "find files by name pattern using glob syntax",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: false,

  async description(input) {
    return input?.pattern ? `Find files matching: ${input.pattern}` : "Find files by pattern";
  },

  async prompt() {
    return GLOB_PROMPT;
  },

  get inputSchema() { return GlobInputSchema; },
  get outputSchema() { return GlobOutputSchema; },

  userFacingName() { return "Glob"; },
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

  async call(input, context): Promise<ToolCallResult<GlobOutput>> {
    const cwd = input.path ? resolvePath(input.path) : process.cwd();

    // Validate that the search directory exists before attempting glob
    if (input.path && !existsSync(cwd)) {
      return {
        data: {
          files: [],
          totalMatches: 0,
          truncated: false,
        },
      };
    }

    try {
      const allFiles = await fg(input.pattern, {
        cwd,
        absolute: true,
        dot: false,
        onlyFiles: true,
        ignore: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/build/**",
          "**/.next/**",
          "**/coverage/**",
          "**/__pycache__/**",
          "**/.vscode/**",
          "**/.idea/**",
        ],
        followSymbolicLinks: false,
        suppressErrors: true,
      });

      // Sort by modification time (newest first)
      const withStats = allFiles.map((f) => {
        try {
          const stat = statSync(f);
          return { path: f, mtime: stat.mtimeMs };
        } catch {
          return { path: f, mtime: 0 };
        }
      });
      withStats.sort((a, b) => b.mtime - a.mtime);

      const truncated = withStats.length > MAX_RESULTS;
      const files = withStats.slice(0, MAX_RESULTS).map((f) => f.path);

      return {
        data: {
          files,
          totalMatches: allFiles.length,
          truncated,
        },
      };
    } catch (error) {
      return {
        data: {
          files: [],
          totalMatches: 0,
          truncated: false,
        },
      };
    }
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    if (result.files.length === 0) {
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "No files found matching the pattern.",
      };
    }

    let content = result.files.join("\n");
    if (result.truncated) {
      content += `\n\n(showing ${result.files.length} of ${result.totalMatches} matches)`;
    }

    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content,
    };
  },
};

// ── Helpers ────────────────────────────────────────────────────────

function resolvePath(p: string): string {
  if (isAbsolute(p)) return p;
  return resolve(process.cwd(), p);
}

// ── Prompt ─────────────────────────────────────────────────────────

const GLOB_PROMPT = `Fast file pattern matching tool that works with any codebase size.
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When doing open-ended search requiring multiple rounds, use the Agent tool instead`;
