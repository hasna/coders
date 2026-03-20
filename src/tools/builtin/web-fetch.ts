/**
 * WebFetch tool — fetch URL content and convert to text
 */
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import { WEB_FETCH_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";

const WebFetchInputSchema = z.strictObject({
  url: z.string().url().describe("URL to fetch"),
  prompt: z.string().describe("Prompt to run on fetched content"),
});
type WebFetchInput = z.infer<typeof WebFetchInputSchema>;

interface WebFetchOutput { bytes: number; code: number; codeText: string; result: string; durationMs: number; url: string; }

export const webFetchTool: Tool<WebFetchInput, WebFetchOutput> = {
  name: WEB_FETCH_TOOL,
  searchHint: "fetch URL content and convert HTML to text",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,
  async description(input) { return `Fetch: ${input?.url ?? "URL"}`; },
  async prompt() { return "Fetch content from a URL. Converts HTML to readable text. Will fail for authenticated/private URLs."; },
  get inputSchema() { return WebFetchInputSchema; },
  get outputSchema() { return z.object({ bytes: z.number(), code: z.number(), codeText: z.string(), result: z.string(), durationMs: z.number(), url: z.string() }); },
  userFacingName() { return "WebFetch"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },
  toAutoClassifierInput(input) { return input.url; },

  async validateInput(input) {
    if (!input.url) return { result: false, message: "url is required", errorCode: 1 };
    return { result: true };
  },
  async checkPermissions(input) {
    return { behavior: "passthrough", message: `Fetch: ${input.url}` };
  },

  async call(input): Promise<ToolCallResult<WebFetchOutput>> {
    const start = performance.now();
    try {
      const response = await fetch(input.url, {
        headers: { "User-Agent": "coders/0.0.1" },
        signal: AbortSignal.timeout(30_000),
        redirect: "follow",
      });
      const text = await response.text();
      const durationMs = performance.now() - start;

      // Simple HTML stripping (full HTML-to-markdown would use marked/turndown)
      const result = stripHtml(text).slice(0, DEFAULT_MAX_RESULT_SIZE_CHARS);

      return {
        data: {
          bytes: text.length,
          code: response.status,
          codeText: response.statusText,
          result,
          durationMs,
          url: response.url,
        },
      };
    } catch (error) {
      return {
        data: {
          bytes: 0, code: 0, codeText: "Error",
          result: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
          durationMs: performance.now() - start, url: input.url,
        },
      };
    }
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    return { type: "tool_result", tool_use_id: toolUseId, content: result.result.slice(0, DEFAULT_MAX_RESULT_SIZE_CHARS) };
  },
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
