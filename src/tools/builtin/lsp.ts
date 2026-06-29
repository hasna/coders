/**
 * LSP tool — Language Server Protocol integration
 *
 * Operations: goToDefinition, findReferences, hover, documentSymbol,
 * workspaceSymbol, goToImplementation, prepareCallHierarchy,
 * incomingCalls, outgoingCalls
 */
import { z } from "zod";
import type { Tool, ToolCallResult } from "../interface.js";
import { LSP_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";

const LSPOperations = [
  "goToDefinition", "findReferences", "hover", "documentSymbol",
  "workspaceSymbol", "goToImplementation", "prepareCallHierarchy",
  "incomingCalls", "outgoingCalls",
] as const;

const LSPInputSchema = z.strictObject({
  operation: z.enum(LSPOperations).describe("The LSP operation to perform"),
  filePath: z.string().describe("Absolute or relative path to the file"),
  line: z.number().int().positive().describe("Line number (1-based)"),
  character: z.number().int().positive().describe("Character offset (1-based)"),
});

type LSPInput = z.infer<typeof LSPInputSchema>;

interface LSPOutput {
  operation: string;
  result: string;
  filePath: string;
  resultCount?: number;
  fileCount?: number;
}

export const lspTool: Tool<LSPInput, LSPOutput> = {
  name: LSP_TOOL,
  searchHint: "code intelligence (definitions, references, symbols, hover)",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description() { return "Language Server Protocol — code intelligence"; },
  async prompt() { return LSP_PROMPT; },

  get inputSchema() { return LSPInputSchema; },
  get outputSchema() { return z.object({ operation: z.string(), result: z.string(), filePath: z.string(), resultCount: z.number().optional(), fileCount: z.number().optional() }); },

  userFacingName() { return "LSP"; },
  isEnabled() { return true; }, // Depends on LSP servers being configured
  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },
  toAutoClassifierInput() { return ""; },

  async validateInput(input) {
    if (!input.filePath) return { result: false, message: "filePath is required", errorCode: 1 };
    return { result: true };
  },

  async checkPermissions(input) { return { behavior: "allow", updatedInput: input }; },

  async call(input): Promise<ToolCallResult<LSPOutput>> {
    // LSP requires a running language server — for now return a helpful message
    // Full implementation will use child_process to communicate with LSP servers
    return {
      data: {
        operation: input.operation,
        result: "",
        filePath: input.filePath,
        resultCount: 0,
        fileCount: 0,
      },
      error: `LSP not available. No language server is connected. Use Grep for code search, or configure LSP via plugins.`,
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    return { type: "tool_result", tool_use_id: toolUseId, content: result.result };
  },
};

const LSP_PROMPT = `Interact with Language Server Protocol servers for code intelligence.

Operations: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol,
goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls.

All operations require filePath, line (1-based), and character (1-based).
LSP servers must be configured for the file type.`;
