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
  xai?: string;
  together?: string;
  gemini?: string;
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

  // ── xAI Grok models ──────────────────────────────────────────────

  grok3: {
    alias: "grok3",
    variants: {
      firstParty: "grok-3",
      bedrock: "grok-3",
      vertex: "grok-3",
      xai: "grok-3",
    },
    contextWindow: 131_072,
    maxOutput: 16_384,
    supportsThinking: true,
    supportsVision: false,
  },
  grok3mini: {
    alias: "grok3mini",
    variants: {
      firstParty: "grok-3-mini",
      bedrock: "grok-3-mini",
      vertex: "grok-3-mini",
      xai: "grok-3-mini",
    },
    contextWindow: 131_072,
    maxOutput: 16_384,
    supportsThinking: true,
    supportsVision: false,
  },
  grok2: {
    alias: "grok2",
    variants: {
      firstParty: "grok-2",
      bedrock: "grok-2",
      vertex: "grok-2",
      xai: "grok-2",
    },
    contextWindow: 131_072,
    maxOutput: 8_192,
    supportsThinking: false,
    supportsVision: true,
  },

  // ── Google Gemini models ──────────────────────────────────────────

  gemini25pro: {
    alias: "gemini25pro",
    variants: {
      firstParty: "gemini-2.5-pro",
      bedrock: "gemini-2.5-pro",
      vertex: "gemini-2.5-pro",
      gemini: "gemini-2.5-pro",
    },
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    supportsThinking: true,
    supportsVision: true,
  },
  gemini25flash: {
    alias: "gemini25flash",
    variants: {
      firstParty: "gemini-2.5-flash",
      bedrock: "gemini-2.5-flash",
      vertex: "gemini-2.5-flash",
      gemini: "gemini-2.5-flash",
    },
    contextWindow: 1_000_000,
    maxOutput: 65_536,
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
  // xAI Grok aliases
  grok: "grok3",
  "grok-3": "grok3",
  "grok-3-mini": "grok3mini",
  "grok-2": "grok2",
  // Gemini aliases
  gemini: "gemini25pro",
  "gemini-pro": "gemini25pro",
  "gemini-flash": "gemini25flash",
  "gemini-2.5-pro": "gemini25pro",
  "gemini-2.5-flash": "gemini25flash",
};

/**
 * Resolve a user-provided model string to a concrete model ID
 * for the given API provider.
 */
export function resolveModelId(
  model: string,
  provider: "firstParty" | "bedrock" | "vertex" | "foundry" | "xai" | "together" | "gemini" = "firstParty",
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
