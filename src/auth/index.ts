/**
 * Auth module — public API
 */
export {
  resolveApiKey,
  requireApiKey,
  detectAuthConflicts,
  saveApiKey,
  removeApiKey,
  saveOAuthTokens,
  getOAuthTokens,
  isClaudeAiAuth,
  getApiProvider,
  type ResolvedApiKey,
  type ApiKeySource,
  type ApiProvider,
} from "./api-key.js";

export {
  performOAuthLogin,
  refreshAccessToken,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  startCallbackServer,
  DEFAULT_OAUTH_CONFIG,
  CLAUDE_AI_OAUTH_CONFIG,
  type OAuthConfig,
  type TokenResponse,
  type OAuthCallbackResult,
} from "./oauth.js";

export {
  detectSecrets,
  containsSecrets,
  redactSecrets,
  SECRET_PATTERNS,
  type SecretPattern,
} from "./secrets.js";

export {
  getKeychainApiKey,
  setKeychainApiKey,
  removeKeychainApiKey,
} from "./keychain.js";
