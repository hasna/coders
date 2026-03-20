/**
 * OAuth PKCE authorization code flow
 *
 * Implements the same OAuth flow as Claude Code:
 *   1. Generate PKCE code_verifier + code_challenge
 *   2. Open browser to authorize URL
 *   3. Start local HTTP server to receive callback
 *   4. Exchange authorization code for tokens
 *   5. Store tokens in config
 *
 * OAuth config (matching Claude Code's oK module):
 *   - Authorize URL: https://console.anthropic.com/oauth/authorize (or claude.ai)
 *   - Token URL: https://console.anthropic.com/v1/oauth/token
 *   - Scopes: user:inference, user:profile
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { randomBytes, createHash } from "crypto";
import { URL, URLSearchParams } from "url";
import { saveOAuthTokens } from "./api-key.js";

// ── OAuth configuration ────────────────────────────────────────────

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string[];
  redirectPort: number;
}

export const DEFAULT_OAUTH_CONFIG: OAuthConfig = {
  authorizeUrl: "https://console.anthropic.com/oauth/authorize",
  tokenUrl: "https://console.anthropic.com/v1/oauth/token",
  clientId: "", // set by the user or from config
  scopes: ["user:inference", "user:profile"],
  redirectPort: 19485,
};

export const CLAUDE_AI_OAUTH_CONFIG: OAuthConfig = {
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://console.anthropic.com/v1/oauth/token",
  clientId: "", // set from platform config
  scopes: [
    "user:inference",
    "user:profile",
    "user:sessions:claude_code",
    "user:mcp_servers",
  ],
  redirectPort: 19485,
};

// ── PKCE helpers ───────────────────────────────────────────────────

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

// ── Build authorize URL ────────────────────────────────────────────

export function buildAuthorizeUrl(
  config: OAuthConfig,
  codeChallenge: string,
  state: string,
): string {
  const redirectUri = `http://localhost:${config.redirectPort}/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scopes.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${config.authorizeUrl}?${params.toString()}`;
}

// ── Token exchange ─────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope?: string;
}

export async function exchangeCodeForTokens(
  config: OAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const redirectUri = `http://localhost:${config.redirectPort}/callback`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${error}`);
  }

  return (await response.json()) as TokenResponse;
}

// ── Token refresh ──────────────────────────────────────────────────

export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${error}`);
  }

  return (await response.json()) as TokenResponse;
}

// ── Local callback server ──────────────────────────────────────────

export interface OAuthCallbackResult {
  code: string;
  state: string;
}

/**
 * Start a temporary local HTTP server to receive the OAuth callback.
 * Returns a promise that resolves with the authorization code.
 */
export function startCallbackServer(
  port: number,
  expectedState: string,
  timeoutMs = 300_000,
): Promise<OAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<html><body><h1>Authentication failed</h1><p>${error}</p><p>You can close this window.</p></body></html>`);
          cleanup();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code || !state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h1>Missing parameters</h1><p>You can close this window.</p></body></html>");
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h1>State mismatch</h1><p>You can close this window.</p></body></html>");
          cleanup();
          reject(new Error("OAuth state mismatch — possible CSRF attack"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h1>Authentication successful!</h1><p>You can close this window and return to the terminal.</p></body></html>");
        cleanup();
        resolve({ code, state });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("OAuth callback timeout — no response received"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      server.close();
    }

    server.listen(port, "127.0.0.1", () => {
      // Server ready
    });

    server.on("error", (err) => {
      cleanup();
      reject(new Error(`OAuth callback server error: ${err.message}`));
    });
  });
}

// ── Full login flow ────────────────────────────────────────────────

export async function performOAuthLogin(
  config: OAuthConfig,
  openBrowser: (url: string) => void,
): Promise<void> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const authorizeUrl = buildAuthorizeUrl(config, codeChallenge, state);

  // Start callback server
  const callbackPromise = startCallbackServer(config.redirectPort, state);

  // Open browser
  openBrowser(authorizeUrl);

  console.log("Waiting for authentication in browser...");
  console.log(`If the browser didn't open, visit: ${authorizeUrl}`);

  // Wait for callback
  const { code } = await callbackPromise;

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(config, code, codeVerifier);

  // Save tokens
  saveOAuthTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : undefined,
  });

  console.log("Authentication successful!");
}
