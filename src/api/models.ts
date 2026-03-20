/**
 * Model registry — maps aliases to provider-specific model IDs
 *
 * Mirrors Claude Code's $Y8 module but as clean typed data.
 * Each model has variants for: firstParty, bedrock, vertex, foundry.
 */

export interface ModelVariants {
  firstParty: string;
  bedrock: string;
  vertex: string;
  foundry?: string;
}

export interface ModelEntry {
  alias: string;
  variants: ModelVariants;
  contextWindow: number;
  maxOutput: number;
  supportsThinking: boolean;
  supportsVision: boolean;
}

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  haiku35: {
    alias: "haiku35",
    variants: {
      firstParty: "claude-3-5-haiku-20241022",
      bedrock: "us.anthropic.claude-3-5-haiku-20241022-v1:0",
      vertex: "claude-3-5-haiku@20241022",
    },
    contextWindow: 200_000,
    maxOutput: 8_192,
    supportsThinking: false,
    supportsVision: true,
  },
  haiku45: {
    alias: "haiku45",
    variants: {
      firstParty: "claude-haiku-4-5-20251001",
      bedrock: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      vertex: "claude-haiku-4-5@20251001",
    },
    contextWindow: 200_000,
    maxOutput: 8_192,
    supportsThinking: true,
    supportsVision: true,
  },
  sonnet37: {
    alias: "sonnet37",
    variants: {
      firstParty: "claude-3-7-sonnet-20250219",
      bedrock: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
      vertex: "claude-3-7-sonnet@20250219",
    },
    contextWindow: 200_000,
    maxOutput: 16_384,
    supportsThinking: true,
    supportsVision: true,
  },
  sonnet40: {
    alias: "sonnet40",
    variants: {
      firstParty: "claude-sonnet-4-20250514",
      bedrock: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      vertex: "claude-sonnet-4@20250514",
    },
    contextWindow: 200_000,
    maxOutput: 16_384,
    supportsThinking: true,
    supportsVision: true,
  },
  sonnet45: {
    alias: "sonnet45",
    variants: {
      firstParty: "claude-sonnet-4-5-20250929",
      bedrock: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      vertex: "claude-sonnet-4-5@20250929",
    },
    contextWindow: 200_000,
    maxOutput: 16_384,
    supportsThinking: true,
    supportsVision: true,
  },
  sonnet46: {
    alias: "sonnet46",
    variants: {
      firstParty: "claude-sonnet-4-6",
      bedrock: "us.anthropic.claude-sonnet-4-6",
      vertex: "claude-sonnet-4-6",
    },
    contextWindow: 200_000,
    maxOutput: 16_384,
    supportsThinking: true,
    supportsVision: true,
  },
  opus40: {
    alias: "opus40",
    variants: {
      firstParty: "claude-opus-4-20250514",
      bedrock: "us.anthropic.claude-opus-4-20250514-v1:0",
      vertex: "claude-opus-4@20250514",
    },
    contextWindow: 200_000,
    maxOutput: 32_768,
    supportsThinking: true,
    supportsVision: true,
  },
  opus41: {
    alias: "opus41",
    variants: {
      firstParty: "claude-opus-4-1-20250805",
      bedrock: "us.anthropic.claude-opus-4-1-20250805-v1:0",
      vertex: "claude-opus-4-1@20250805",
    },
    contextWindow: 200_000,
    maxOutput: 32_768,
    supportsThinking: true,
    supportsVision: true,
  },
  opus45: {
    alias: "opus45",
    variants: {
      firstParty: "claude-opus-4-5-20251101",
      bedrock: "us.anthropic.claude-opus-4-5-20251101-v1:0",
      vertex: "claude-opus-4-5@20251101",
    },
    contextWindow: 200_000,
    maxOutput: 32_768,
    supportsThinking: true,
    supportsVision: true,
  },
  opus46: {
    alias: "opus46",
    variants: {
      firstParty: "claude-opus-4-6",
      bedrock: "us.anthropic.claude-opus-4-6-v1",
      vertex: "claude-opus-4-6",
    },
    contextWindow: 200_000,
    maxOutput: 32_768,
    supportsThinking: true,
    supportsVision: true,
  },
};

// ── User-facing aliases ────────────────────────────────────────────

const USER_ALIASES: Record<string, string> = {
  haiku: "haiku45",
  sonnet: "sonnet46",
  opus: "opus46",
  "sonnet[1m]": "sonnet46",
  "opus[1m]": "opus46",
};

/**
 * Resolve a user-provided model string to a concrete model ID
 * for the given API provider.
 */
export function resolveModelId(
  model: string,
  provider: "firstParty" | "bedrock" | "vertex" | "foundry" = "firstParty",
): string {
  // Check if it's a user alias first
  const aliasKey = USER_ALIASES[model] ?? model;

  // Check registry
  const entry = MODEL_REGISTRY[aliasKey];
  if (entry) {
    return entry.variants[provider] ?? entry.variants.firstParty;
  }

  // If it contains [1m], strip the suffix and resolve
  if (model.endsWith("[1m]")) {
    const base = model.slice(0, -4);
    return resolveModelId(base, provider);
  }

  // Already a concrete model ID — pass through
  return model;
}

/**
 * Check if a model string is in the known registry.
 */
export function isKnownModel(model: string): boolean {
  const aliasKey = USER_ALIASES[model] ?? model;
  return aliasKey in MODEL_REGISTRY;
}

/**
 * Get model entry by alias or model ID.
 */
export function getModelEntry(model: string): ModelEntry | null {
  const aliasKey = USER_ALIASES[model] ?? model;
  if (aliasKey in MODEL_REGISTRY) return MODEL_REGISTRY[aliasKey];

  // Search by model ID across all variants
  for (const entry of Object.values(MODEL_REGISTRY)) {
    for (const id of Object.values(entry.variants)) {
      if (id === model) return entry;
    }
  }
  return null;
}

/**
 * Check if model has extended context (1M).
 */
export function hasExtendedContext(model: string): boolean {
  return model.endsWith("[1m]");
}

/**
 * Get context window size for a model.
 */
export function getContextWindow(model: string): number {
  if (hasExtendedContext(model)) return 1_000_000;
  const entry = getModelEntry(model);
  return entry?.contextWindow ?? 200_000;
}

/**
 * Get the default model for the main loop.
 */
export function getDefaultModel(): string {
  return "sonnet46";
}

/**
 * Get the default model for sub-agents (cheaper/faster).
 */
export function getSubAgentModel(): string {
  return "sonnet46";
}
