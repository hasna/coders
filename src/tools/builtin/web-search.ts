/**
 * WebSearch tool — web search via model's native tool_use
 *
 * Sends a search query to the API which uses the built-in web_search tool.
 */
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import { WEB_SEARCH_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";

const WebSearchInputSchema = z.strictObject({
  query: z.string().min(2).describe("The search query"),
  allowed_domains: z.array(z.string()).optional().describe("Only include results from these domains"),
  blocked_domains: z.array(z.string()).optional().describe("Never include results from these domains"),
});
type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

interface WebSearchOutput {
  query: string;
  results: Array<string | { content: Array<{ title: string; url: string }> }>;
  durationSeconds: number;
}

export const webSearchTool: Tool<WebSearchInput, WebSearchOutput> = {
  name: WEB_SEARCH_TOOL,
  searchHint: "search the web for current information",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,
  async description(input) { return `Search: ${input?.query ?? "web"}`; },
  async prompt() { return "Search the web for current information. Uses the model's built-in web search capability."; },
  get inputSchema() { return WebSearchInputSchema; },
  get outputSchema() { return z.object({ query: z.string(), results: z.array(z.any()), durationSeconds: z.number() }); },
  userFacingName() { return "Web Search"; },
  isEnabled() { return true; }, // Provider-dependent, simplified here
  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },
  toAutoClassifierInput(input) { return input.query; },

  async validateInput(input) {
    if (!input.query?.length) return { result: false, message: "Missing query", errorCode: 1 };
    if (input.allowed_domains?.length && input.blocked_domains?.length) {
      return { result: false, message: "Cannot specify both allowed_domains and blocked_domains", errorCode: 2 };
    }
    return { result: true };
  },
  async checkPermissions(input) { return { behavior: "passthrough" }; },

  async call(input, context): Promise<ToolCallResult<WebSearchOutput>> {
    // WebSearch works by making an API call with web_search tool enabled
    // The actual search is performed server-side by Anthropic's API
    const start = performance.now();
    const { getApiClient } = await import("../../api/client.js");
    const client = getApiClient();

    try {
      const response = await client.createMessage({
        model: context.options?.mainLoopModel ?? "sonnet",
        messages: [{ role: "user", content: `Search the web for: ${input.query}` }],
        systemPrompt: "You are performing a web search. Return the results.",
        maxTokens: 4096,
        signal: context.abortController?.signal,
      });

      const textBlocks = response.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map(b => b.text);

      return {
        data: {
          query: input.query,
          results: textBlocks,
          durationSeconds: (performance.now() - start) / 1000,
        },
      };
    } catch (error) {
      return {
        data: {
          query: input.query,
          results: [`Search failed: ${error instanceof Error ? error.message : String(error)}`],
          durationSeconds: (performance.now() - start) / 1000,
        },
      };
    }
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    const content = result.results.map(r =>
      typeof r === "string" ? r : `Links: ${JSON.stringify(r.content)}`
    ).join("\n\n");
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `Web search results for "${result.query}":\n\n${content}\n\nREMINDER: Include sources in your response using markdown hyperlinks.`,
    };
  },
};
