/**
 * API key resolution chain
 *
 * Priority (matching Claude Code's GA module):
 *   1. CODERS_OAUTH_TOKEN env var (direct OAuth override)
 *   2. ANTHROPIC_API_KEY env var
 *   3. Platform keychain (macOS security / Linux secret-tool)
 *   4. Login-managed key from stored config
 *   5. Claude.ai OAuth from persisted auth state
 *
 * Also detects conflicts (e.g., both API key and OAuth set).
 */
import { getConfig, saveConfig } from "../config/loader.js";
import { getKeychainApiKey, removeKeychainApiKey } from "./keychain.js";

export type ApiKeySource =
  | "env:CODERS_OAUTH_TOKEN"
  | "env:ANTHROPIC_API_KEY"
  | "keychain"
  | "config:primaryApiKey"
  | "config:codersOauth"
  | "none";

export interface ResolvedApiKey {
  apiKey: string;
  source: ApiKeySource;
  isOAuth: boolean;
}

/**
 * Resolve the API key from the priority chain.
 * Returns null if no key is found.
 */
export function resolveApiKey(): ResolvedApiKey | null {
  // 1. CODERS_OAUTH_TOKEN env — direct OAuth token
  const oauthToken = process.env.CODERS_OAUTH_TOKEN;
  if (oauthToken) {
    return { apiKey: oauthToken, source: "env:CODERS_OAUTH_TOKEN", isOAuth: true };
  }

  // 2. ANTHROPIC_API_KEY env — standard API key
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return { apiKey: envKey, source: "env:ANTHROPIC_API_KEY", isOAuth: false };
  }

  // 3. Platform keychain
  const keychainKey = getKeychainApiKey();
  if (keychainKey) {
    return { apiKey: keychainKey, source: "keychain", isOAuth: false };
  }

  // 4. Config: primaryApiKey (stored from `coders auth login`)
  const config = getConfig();
  const primaryKey = config.primaryApiKey as string | undefined;
  if (primaryKey) {
    return { apiKey: primaryKey, source: "config:primaryApiKey", isOAuth: false };
  }

  // 5. Config: Claude.ai OAuth tokens (check expiry)
  const codersOauth = config.codersOauth as { accessToken?: string; expiresAt?: number } | undefined;
  if (codersOauth?.accessToken) {
    if (codersOauth.expiresAt && Date.now() > codersOauth.expiresAt) {
      console.warn("[auth] OAuth token expired. Please re-authenticate with: coders auth login");
      // Fall through to return null — don't use expired token
    } else {
      return { apiKey: codersOauth.accessToken, source: "config:codersOauth", isOAuth: true };
    }
  }

  return null;
}

/**
 * Get the API key or throw if not found.
 */
export function requireApiKey(): ResolvedApiKey {
  const resolved = resolveApiKey();
  if (!resolved) {
    throw new Error(
      "No API key found. Set ANTHROPIC_API_KEY environment variable or run 'coders auth login'."
    );
  }
  return resolved;
}

/**
 * Detect conflicting auth sources (warn the user).
 */
export function detectAuthConflicts(): string[] {
  const conflicts: string[] = [];
  const sources: ApiKeySource[] = [];

  if (process.env.CODERS_OAUTH_TOKEN) sources.push("env:CODERS_OAUTH_TOKEN");
  if (process.env.ANTHROPIC_API_KEY) sources.push("env:ANTHROPIC_API_KEY");
  if (getKeychainApiKey()) sources.push("keychain");

  const config = getConfig();
  if (config.primaryApiKey) sources.push("config:primaryApiKey");
  if ((config.codersOauth as Record<string, unknown>)?.accessToken) sources.push("config:codersOauth");

  if (sources.length > 1) {
    conflicts.push(
      `Multiple auth sources detected: ${sources.join(", ")}. Using highest priority: ${sources[0]}`
    );
  }

  return conflicts;
}

/**
 * Save an API key to the config file.
 */
export function saveApiKey(apiKey: string): void {
  saveConfig("primaryApiKey", apiKey);
}

/**
 * Remove the saved API key from config and keychain.
 */
export function removeApiKey(): void {
  saveConfig("primaryApiKey", undefined);
  removeKeychainApiKey();
}

/**
 * Save OAuth tokens to config.
 */
export function saveOAuthTokens(tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}): void {
  saveConfig("codersOauth", tokens);
}

/**
 * Get saved OAuth tokens.
 */
export function getOAuthTokens(): {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
} | null {
  const config = getConfig();
  const oauth = config.codersOauth as Record<string, unknown> | undefined;
  if (!oauth?.accessToken) return null;
  return {
    accessToken: oauth.accessToken as string,
    refreshToken: oauth.refreshToken as string | undefined,
    expiresAt: oauth.expiresAt as number | undefined,
  };
}

/**
 * Check if using Claude.ai auth (subscription-based).
 */
export function isOAuthAuth(): boolean {
  const resolved = resolveApiKey();
  return resolved?.source === "config:codersOauth" || resolved?.source === "env:CODERS_OAUTH_TOKEN";
}

/**
 * Get the active API provider based on env vars.
 */
export type ApiProvider = "firstParty" | "bedrock" | "vertex" | "foundry";

export function getApiProvider(): ApiProvider {
  if (process.env.ANTHROPIC_BEDROCK_BASE_URL) {
    return "bedrock";
  }
  if (process.env.ANTHROPIC_VERTEX_PROJECT_ID || process.env.CLOUD_ML_REGION) {
    return "vertex";
  }
  if (process.env.ANTHROPIC_FOUNDRY_BASE_URL) {
    return "foundry";
  }
  return "firstParty";
}
