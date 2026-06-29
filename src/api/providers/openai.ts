/**
 * OpenAI-compatible provider adapter (NEW — improvement over Claude Code)
 *
 * Supports any OpenAI-compatible API (OpenAI, Azure OpenAI, Together AI,
 * Fireworks, Groq, Mistral, etc.)
 *
 * API: POST {baseUrl}/v1/chat/completions
 * Auth: Bearer token
 *
 * Transforms Anthropic message format to OpenAI chat format.
 */
import type { ProviderAdapter } from "./interface.js";

export class OpenAIAdapter implements ProviderAdapter {
  readonly name: string = "openai";
  readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl
      ?? process.env.OPENAI_BASE_URL
      ?? process.env.OPENAI_API_BASE
      ?? "https://api.openai.com";
  }

  buildHeaders(apiKey: string, _isOAuth: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
    const org = process.env.OPENAI_ORG_ID;
    if (org) headers["OpenAI-Organization"] = org;
    return headers;
  }

  resolveModel(model: string): string {
    // OpenAI uses its own model names — pass through
    // Common mappings for convenience
    const aliases: Record<string, string> = {
      sonnet: "gpt-4o",
      opus: "gpt-4o",
      haiku: "gpt-4o-mini",
    };
    return aliases[model] ?? model;
  }

  buildRequestBody(body: Record<string, unknown>): Record<string, unknown> {
    // Transform Anthropic format to OpenAI chat format
    const messages = transformMessagesToOpenAI(body.messages as Array<Record<string, unknown>> ?? []);
    const systemPrompt = body.system ?? body.systemPrompt;

    const openaiBody: Record<string, unknown> = {
      model: body.model,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: typeof systemPrompt === "string" ? systemPrompt : JSON.stringify(systemPrompt) }] : []),
        ...messages,
      ],
      stream: body.stream ?? false,
    };

    if (body.max_tokens) openaiBody.max_tokens = body.max_tokens;
    if (body.tools) openaiBody.tools = transformToolsToOpenAI(body.tools as Array<Record<string, unknown>>);

    return openaiBody;
  }

  parseStreamEvent(raw: Record<string, unknown>): Record<string, unknown> {
    // Transform OpenAI streaming format to Anthropic-like events
    const choices = raw.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) return raw;

    const choice = choices[0];
    const delta = choice.delta as Record<string, unknown> | undefined;

    if (delta?.content) {
      return {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: delta.content },
      };
    }

    if (choice.finish_reason) {
      return {
        type: "message_stop",
      };
    }

    return raw;
  }

  getBetaHeaders(): string[] {
    return [];
  }

  supportsModel(_model: string): boolean {
    return true; // OpenAI-compatible endpoints accept any model string
  }

  getMessagesEndpoint(): string {
    return "/v1/chat/completions";
  }
}

// ── Format transformers ────────────────────────────────────────────

function transformMessagesToOpenAI(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    const role = msg.role as string;
    const content = msg.content;

    if (typeof content === "string") {
      return { role, content };
    }

    // Array of content blocks — transform to OpenAI format
    if (Array.isArray(content)) {
      const parts = content.map((block: Record<string, unknown>) => {
        if (block.type === "text") return { type: "text", text: block.text };
        if (block.type === "tool_use") {
          return {
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.input) },
          };
        }
        if (block.type === "tool_result") {
          return { role: "tool", content: block.content, tool_call_id: block.tool_use_id };
        }
        return { type: "text", text: JSON.stringify(block) };
      });

      // Check for tool_result blocks — these become separate messages in OpenAI
      const toolResults = parts.filter((p: Record<string, unknown>) => p.role === "tool");
      const otherParts = parts.filter((p: Record<string, unknown>) => p.role !== "tool");

      if (toolResults.length > 0 && otherParts.length === 0) {
        // Return tool results as individual messages
        return toolResults[0]; // OpenAI expects one tool result per message
      }

      return { role, content: otherParts.length === 1 && otherParts[0].type === "text" ? otherParts[0].text : otherParts };
    }

    return { role, content: String(content) };
  });
}

function transformToolsToOpenAI(
  tools: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}
