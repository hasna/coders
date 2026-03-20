import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AnthropicAdapter,
  BedrockAdapter,
  VertexAdapter,
  OpenAIAdapter,
  OllamaAdapter,
  detectProvider,
  getProvider,
  getAvailableProviders,
} from "../src/api/providers/index.js";

describe("Anthropic adapter", () => {
  it("uses correct base URL", () => {
    const adapter = new AnthropicAdapter();
    expect(adapter.baseUrl).toBe("https://api.anthropic.com");
  });

  it("builds headers with API key", () => {
    const headers = new AnthropicAdapter().buildHeaders("sk-test", false);
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-beta"]).toContain("claude-code");
  });

  it("builds headers with OAuth", () => {
    const headers = new AnthropicAdapter().buildHeaders("oauth-token", true);
    expect(headers["Authorization"]).toBe("Bearer oauth-token");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("resolves model aliases", () => {
    expect(new AnthropicAdapter().resolveModel("sonnet")).toContain("claude");
    expect(new AnthropicAdapter().resolveModel("opus")).toContain("claude");
  });

  it("passes through request body unchanged", () => {
    const body = { model: "test", messages: [], max_tokens: 100 };
    expect(new AnthropicAdapter().buildRequestBody(body)).toEqual(body);
  });

  it("returns correct endpoint", () => {
    expect(new AnthropicAdapter().getMessagesEndpoint()).toBe("/v1/messages");
  });

  it("has beta headers", () => {
    expect(new AnthropicAdapter().getBetaHeaders().length).toBeGreaterThan(0);
  });
});

describe("Bedrock adapter", () => {
  it("uses AWS region in base URL", () => {
    const adapter = new BedrockAdapter();
    expect(adapter.baseUrl).toContain("bedrock-runtime");
  });

  it("resolves Bedrock model IDs", () => {
    const model = new BedrockAdapter().resolveModel("sonnet");
    expect(model).toContain("anthropic");
  });

  it("adds anthropic_version to body", () => {
    const body = new BedrockAdapter().buildRequestBody({ model: "test", messages: [] });
    expect(body.anthropic_version).toBe("bedrock-2023-05-31");
    expect(body.model).toBeUndefined(); // stripped from body
  });
});

describe("Vertex adapter", () => {
  it("uses Vertex endpoint format", () => {
    const adapter = new VertexAdapter();
    expect(adapter.baseUrl).toContain("aiplatform.googleapis.com");
  });

  it("resolves Vertex model IDs", () => {
    const model = new VertexAdapter().resolveModel("opus");
    expect(model).toContain("claude");
  });

  it("uses Bearer auth", () => {
    const headers = new VertexAdapter().buildHeaders("gcp-token", false);
    expect(headers["Authorization"]).toBe("Bearer gcp-token");
  });
});

describe("OpenAI adapter", () => {
  it("uses OpenAI base URL", () => {
    const adapter = new OpenAIAdapter();
    expect(adapter.baseUrl).toBe("https://api.openai.com");
  });

  it("builds Bearer auth headers", () => {
    const headers = new OpenAIAdapter().buildHeaders("sk-openai-key", false);
    expect(headers["Authorization"]).toBe("Bearer sk-openai-key");
  });

  it("transforms messages to OpenAI format", () => {
    const body = new OpenAIAdapter().buildRequestBody({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
      system: "You are helpful",
      max_tokens: 100,
    });
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "system", content: "You are helpful" });
    expect(messages[1]).toEqual({ role: "user", content: "Hello" });
    expect(body.model).toBe("gpt-4o");
  });

  it("transforms tools to OpenAI function format", () => {
    const body = new OpenAIAdapter().buildRequestBody({
      model: "gpt-4o",
      messages: [],
      tools: [{ name: "Bash", description: "Run commands", input_schema: { type: "object" } }],
    });
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools[0]).toEqual({
      type: "function",
      function: { name: "Bash", description: "Run commands", parameters: { type: "object" } },
    });
  });

  it("uses chat completions endpoint", () => {
    expect(new OpenAIAdapter().getMessagesEndpoint()).toBe("/v1/chat/completions");
  });

  it("supports any model", () => {
    expect(new OpenAIAdapter().supportsModel("gpt-4o")).toBe(true);
    expect(new OpenAIAdapter().supportsModel("anything")).toBe(true);
  });

  it("resolves aliases to OpenAI models", () => {
    expect(new OpenAIAdapter().resolveModel("sonnet")).toBe("gpt-4o");
    expect(new OpenAIAdapter().resolveModel("haiku")).toBe("gpt-4o-mini");
  });
});

describe("Ollama adapter", () => {
  it("uses localhost by default", () => {
    const adapter = new OllamaAdapter();
    expect(adapter.baseUrl).toBe("http://localhost:11434");
  });

  it("requires no auth headers", () => {
    const headers = new OllamaAdapter().buildHeaders("", false);
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("resolves aliases to Ollama models", () => {
    expect(new OllamaAdapter().resolveModel("sonnet")).toBe("llama3.1:70b");
    expect(new OllamaAdapter().resolveModel("haiku")).toBe("llama3.1:8b");
  });

  it("passes through custom model names", () => {
    expect(new OllamaAdapter().resolveModel("codestral:latest")).toBe("codestral:latest");
  });
});

describe("detectProvider", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("defaults to Anthropic", () => {
    delete process.env.CODERS_PROVIDER;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.ANTHROPIC_BEDROCK_BASE_URL;
    delete process.env.ANTHROPIC_VERTEX_PROJECT_ID;
    const adapter = detectProvider();
    expect(adapter.name).toBe("anthropic");
  });

  it("detects Ollama from env", () => {
    process.env.CODERS_PROVIDER = "ollama";
    expect(detectProvider().name).toBe("ollama");
    delete process.env.CODERS_PROVIDER;
  });

  it("detects OpenAI from env", () => {
    process.env.CODERS_PROVIDER = "openai";
    expect(detectProvider().name).toBe("openai");
    delete process.env.CODERS_PROVIDER;
  });
});

describe("getProvider", () => {
  it("returns correct adapter by name", () => {
    expect(getProvider("anthropic").name).toBe("anthropic");
    expect(getProvider("bedrock").name).toBe("bedrock");
    expect(getProvider("vertex").name).toBe("vertex");
    expect(getProvider("openai").name).toBe("openai");
    expect(getProvider("ollama").name).toBe("ollama");
  });
});

describe("getAvailableProviders", () => {
  it("returns all 6 providers", () => {
    const providers = getAvailableProviders();
    expect(providers).toContain("anthropic");
    expect(providers).toContain("bedrock");
    expect(providers).toContain("vertex");
    expect(providers).toContain("openai");
    expect(providers).toContain("ollama");
    expect(providers).toContain("foundry");
    expect(providers.length).toBe(6);
  });
});
