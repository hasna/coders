/**
 * WebFetch tool — fetch URL content and convert to text
 */
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import { WEB_FETCH_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";
import { DEFAULT_TEXT_LIMIT, compactLongText } from "../../utils/output.js";

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
    // Block private/internal network URLs (SSRF protection)
    try {
      const parsed = new URL(input.url);
      const host = parsed.hostname.toLowerCase();
      const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "metadata.google.internal"];
      if (blockedHosts.includes(host)) return { result: false, message: "Cannot fetch internal/localhost URLs", errorCode: 2 };
      // Block private IP ranges
      if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host)) {
        return { result: false, message: "Cannot fetch private network URLs", errorCode: 3 };
      }
      // Block non-http(s) schemes
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return { result: false, message: "Only http and https URLs are allowed", errorCode: 4 };
      }
    } catch {
      return { result: false, message: "Invalid URL", errorCode: 5 };
    }
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
      const text = await Promise.race([
        response.text(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Response body read timed out after 30s")), 30_000)),
      ]);
      const durationMs = performance.now() - start;

      // Simple HTML stripping (full HTML-to-markdown would use marked/turndown)
      let result = stripHtml(text).slice(0, DEFAULT_MAX_RESULT_SIZE_CHARS);
      // Prepend the prompt so the model knows how to process the content
      if (input.prompt) {
        result = `[User prompt: ${input.prompt}]\n\n${result}`;
      }

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
    const content = compactLongText(
      result.result,
      DEFAULT_TEXT_LIMIT,
      "Use a more specific prompt or fetch a narrower URL for more focused content.",
    );
    return { type: "tool_result", tool_use_id: toolUseId, content };
  },
};

function stripHtml(html: string): string {
  return html
    // Remove non-content elements
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Preserve structure with newlines
    .replace(/<\/?(h[1-6]|p|div|section|article|br|tr|li|blockquote)[^>]*>/gi, "\n")
    .replace(/<\/?(ul|ol|table|thead|tbody)[^>]*>/gi, "\n")
    .replace(/<td[^>]*>/gi, "\t")
    // Preserve link text: <a href="url">text</a> → text (url)
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    // Strip remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    // Clean up whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
