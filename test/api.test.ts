import { describe, it, expect } from "vitest";
import {
  resolveModelId,
  isKnownModel,
  getModelEntry,
  getContextWindow,
  hasExtendedContext,
  getDefaultModel,
  MODEL_REGISTRY,
} from "../src/api/models.js";
import { estimateCost, type TokenUsage } from "../src/api/streaming.js";
import { ApiClient, ApiError } from "../src/api/client.js";

describe("api/models", () => {
  it("resolves user alias 'sonnet' to sonnet46", () => {
    const id = resolveModelId("sonnet", "firstParty");
    expect(id).toBe("claude-sonnet-4-6");
  });

  it("resolves user alias 'opus' to opus46", () => {
    const id = resolveModelId("opus", "firstParty");
    expect(id).toBe("claude-opus-4-6");
  });

  it("resolves user alias 'haiku' to haiku45", () => {
    const id = resolveModelId("haiku", "firstParty");
    expect(id).toBe("claude-haiku-4-5-20251001");
  });

  it("resolves bedrock variant", () => {
    const id = resolveModelId("sonnet", "bedrock");
    expect(id).toContain("us.anthropic");
  });

  it("resolves vertex variant", () => {
    const id = resolveModelId("opus", "vertex");
    expect(id).toBe("claude-opus-4-6");
  });

  it("passes through unknown model IDs", () => {
    expect(resolveModelId("my-custom-model")).toBe("my-custom-model");
  });

  it("identifies known models", () => {
    expect(isKnownModel("sonnet")).toBe(true);
    expect(isKnownModel("opus46")).toBe(true);
    expect(isKnownModel("unknown-model")).toBe(false);
  });

  it("gets model entry by alias", () => {
    const entry = getModelEntry("sonnet46");
    expect(entry).not.toBeNull();
    expect(entry!.supportsThinking).toBe(true);
    expect(entry!.supportsVision).toBe(true);
  });

  it("gets model entry by model ID", () => {
    const entry = getModelEntry("claude-opus-4-6");
    expect(entry).not.toBeNull();
    expect(entry!.alias).toBe("opus46");
  });

  it("detects extended context", () => {
    expect(hasExtendedContext("sonnet[1m]")).toBe(true);
    expect(hasExtendedContext("opus[1m]")).toBe(true);
    expect(hasExtendedContext("sonnet")).toBe(false);
  });

  it("returns 1M for extended context models", () => {
    expect(getContextWindow("sonnet[1m]")).toBe(1_000_000);
    expect(getContextWindow("opus[1m]")).toBe(1_000_000);
  });

  it("returns registry context for default aliases", () => {
    expect(getContextWindow("sonnet")).toBe(1_000_000);
  });

  it("returns 200K for standard non-extended models", () => {
    expect(getContextWindow("sonnet45")).toBe(200_000);
  });

  it("default model is sonnet46", () => {
    expect(getDefaultModel()).toBe("sonnet46");
  });

  it("registry has all expected model families", () => {
    const aliases = Object.keys(MODEL_REGISTRY);
    expect(aliases).toContain("haiku45");
    expect(aliases).toContain("sonnet46");
    expect(aliases).toContain("opus46");
    expect(aliases).toContain("opus40");
    expect(aliases.length).toBeGreaterThanOrEqual(10);
  });
});

describe("api/streaming", () => {
  it("estimates cost for sonnet usage", () => {
    const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 100_000 };
    const cost = estimateCost(usage, "claude-sonnet-4-6");
    expect(cost.inputCostUsd).toBe(3.0);
    expect(cost.outputCostUsd).toBe(1.5);
    expect(cost.totalCostUsd).toBe(4.5);
  });

  it("estimates cost for opus usage", () => {
    const usage: TokenUsage = { inputTokens: 500_000, outputTokens: 50_000 };
    const cost = estimateCost(usage, "claude-opus-4-6");
    expect(cost.inputCostUsd).toBe(7.5);
    expect(cost.outputCostUsd).toBe(3.75);
  });

  it("estimates cost for haiku usage", () => {
    const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const cost = estimateCost(usage, "claude-haiku-4-5");
    expect(cost.inputCostUsd).toBe(0.8);
    expect(cost.outputCostUsd).toBe(4.0);
  });
});

describe("api/client", () => {
  it("creates ApiClient instance", () => {
    const client = new ApiClient({ baseUrl: "https://api.anthropic.com" });
    expect(client).toBeInstanceOf(ApiClient);
  });

  it("ApiError parses JSON error body", () => {
    const err = new ApiError(400, '{"error":{"message":"Bad request"}}', "/v1/messages");
    expect(err.status).toBe(400);
    expect(err.message).toContain("Bad request");
  });

  it("ApiError handles non-JSON body", () => {
    const err = new ApiError(500, "Internal Server Error", "/v1/messages");
    expect(err.status).toBe(500);
    expect(err.message).toContain("Internal Server Error");
  });

  it("tracks usage stats", () => {
    const client = new ApiClient();
    const stats = client.getUsageStats();
    expect(stats.totalInputTokens).toBe(0);
    expect(stats.requestCount).toBe(0);
  });
});
