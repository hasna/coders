import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolveApiKey,
  detectAuthConflicts,
  getApiProvider,
  isClaudeAiAuth,
} from "../src/auth/api-key.js";
import {
  detectSecrets,
  containsSecrets,
  redactSecrets,
} from "../src/auth/secrets.js";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  buildAuthorizeUrl,
  DEFAULT_OAUTH_CONFIG,
} from "../src/auth/oauth.js";
import { resetConfigCache } from "../src/config/loader.js";

describe("auth/api-key", () => {
  beforeEach(() => {
    resetConfigCache();
  });

  it("resolves from ANTHROPIC_API_KEY env", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    try {
      const result = resolveApiKey();
      expect(result).not.toBeNull();
      expect(result!.source).toBe("env:ANTHROPIC_API_KEY");
      expect(result!.isOAuth).toBe(false);
    } finally {
      if (original) process.env.ANTHROPIC_API_KEY = original;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("detects firstParty provider by default", () => {
    expect(getApiProvider()).toBe("firstParty");
  });
});

describe("auth/secrets", () => {
  it("detects AWS access key", () => {
    const text = "my key is AKIAIOSFODNN7EXAMPLE";
    expect(detectSecrets(text)).toContain("aws-access-key");
    expect(containsSecrets(text)).toBe(true);
  });

  it("detects GitHub PAT", () => {
    expect(detectSecrets("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")).toContain("github-pat");
  });

  it("detects SSH private key", () => {
    expect(detectSecrets("-----BEGIN RSA PRIVATE KEY-----")).toContain("ssh-private-key");
  });

  it("detects OpenAI key", () => {
    expect(detectSecrets("sk-abcdefghijklmnopqrstuvwx")).toContain("openai-api-key");
  });

  it("redacts secrets in text", () => {
    const text = "key=AKIAIOSFODNN7EXAMPLE end";
    const redacted = redactSecrets(text);
    expect(redacted).toContain("<aws-access-key>");
    expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("returns empty for clean text", () => {
    expect(detectSecrets("hello world, this is just normal text")).toEqual([]);
  });
});

describe("auth/oauth", () => {
  it("generates PKCE code verifier of correct length", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThan(30);
  });

  it("generates code challenge from verifier", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).toBeTruthy();
    expect(challenge).not.toBe(verifier);
  });

  it("generates random state", () => {
    const s1 = generateState();
    const s2 = generateState();
    expect(s1).not.toBe(s2);
    expect(s1.length).toBe(32); // 16 bytes as hex
  });

  it("builds authorize URL with all params", () => {
    const config = { ...DEFAULT_OAUTH_CONFIG, clientId: "test-client" };
    const url = buildAuthorizeUrl(config, "challenge123", "state456");
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=test-client");
    expect(url).toContain("code_challenge=challenge123");
    expect(url).toContain("state=state456");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("scope=");
  });
});
