/**
 * Secret detection — prevent accidental credential exposure
 *
 * 30+ credential patterns matching Claude Code's wF1 module.
 * Used to scan tool outputs before sending to API.
 */

export interface SecretPattern {
  id: string;
  regex: RegExp;
  description: string;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // AWS
  { id: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/, description: "AWS Access Key ID" },
  { id: "aws-secret-key", regex: /\b[0-9a-zA-Z/+]{40}\b/, description: "AWS Secret Access Key" },
  { id: "aws-session-token", regex: /\bFwoGZXIvYXdzE[A-Za-z0-9/+=]{100,}/, description: "AWS Session Token" },

  // GCP
  { id: "gcp-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/, description: "Google API Key" },
  { id: "gcp-oauth-token", regex: /\bya29\.[0-9A-Za-z_-]{50,}/, description: "Google OAuth Token" },
  { id: "gcp-service-account", regex: /"type"\s*:\s*"service_account"/, description: "GCP Service Account JSON" },

  // Azure
  { id: "azure-ad-client-secret", regex: /\b[0-9a-zA-Z~._-]{34,}(?=.*azure)/i, description: "Azure AD Client Secret" },

  // Anthropic
  { id: "anthropic-api-key", regex: /\bsk-ant-[A-Za-z0-9_-]{90,}/, description: "Anthropic API Key" },

  // OpenAI
  { id: "openai-api-key", regex: /\bsk-[A-Za-z0-9]{20,}/, description: "OpenAI API Key" },
  { id: "openai-org-key", regex: /\borg-[A-Za-z0-9]{24}\b/, description: "OpenAI Organization Key" },

  // GitHub
  { id: "github-pat", regex: /\bghp_[A-Za-z0-9]{36}\b/, description: "GitHub Personal Access Token" },
  { id: "github-fine-grained", regex: /\bgithub_pat_[A-Za-z0-9_]{82}\b/, description: "GitHub Fine-Grained Token" },
  { id: "github-app-token", regex: /\bghs_[A-Za-z0-9]{36}\b/, description: "GitHub App Token" },
  { id: "github-oauth", regex: /\bgho_[A-Za-z0-9]{36}\b/, description: "GitHub OAuth Token" },
  { id: "github-refresh", regex: /\bghr_[A-Za-z0-9]{36}\b/, description: "GitHub Refresh Token" },

  // GitLab
  { id: "gitlab-pat", regex: /\bglpat-[A-Za-z0-9_-]{20,}/, description: "GitLab Personal Access Token" },
  { id: "gitlab-runner", regex: /\bGR1348941[A-Za-z0-9_-]{20,}/, description: "GitLab Runner Token" },

  // Slack
  { id: "slack-bot-token", regex: /\bxoxb-[0-9]{10,}-[A-Za-z0-9]{24,}/, description: "Slack Bot Token" },
  { id: "slack-user-token", regex: /\bxoxp-[0-9]{10,}-[A-Za-z0-9]{24,}/, description: "Slack User Token" },
  { id: "slack-webhook", regex: /hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{24}/, description: "Slack Webhook URL" },

  // Stripe
  { id: "stripe-secret", regex: /\bsk_live_[A-Za-z0-9]{24,}/, description: "Stripe Secret Key" },
  { id: "stripe-restricted", regex: /\brk_live_[A-Za-z0-9]{24,}/, description: "Stripe Restricted Key" },

  // Twilio
  { id: "twilio-api-key", regex: /\bSK[0-9a-fA-F]{32}\b/, description: "Twilio API Key" },

  // npm
  { id: "npm-token", regex: /\bnpm_[A-Za-z0-9]{36}\b/, description: "npm Access Token" },

  // PyPI
  { id: "pypi-token", regex: /\bpypi-[A-Za-z0-9_-]{100,}/, description: "PyPI API Token" },

  // SSH Private Keys
  { id: "ssh-private-key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, description: "SSH Private Key" },

  // Generic high-entropy secrets
  { id: "jwt-token", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, description: "JWT Token" },
  { id: "bearer-token", regex: /\b[Bb]earer\s+[A-Za-z0-9_-]{20,}/, description: "Bearer Token" },

  // Database
  { id: "postgres-url", regex: /postgres(?:ql)?:\/\/[^:]+:[^@]+@/, description: "PostgreSQL Connection String" },
  { id: "mysql-url", regex: /mysql:\/\/[^:]+:[^@]+@/, description: "MySQL Connection String" },
  { id: "mongodb-url", regex: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/, description: "MongoDB Connection String" },
  { id: "redis-url", regex: /redis:\/\/[^:]*:[^@]+@/, description: "Redis Connection String" },

  // Sendgrid
  { id: "sendgrid-api-key", regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/, description: "SendGrid API Key" },

  // Mailgun
  { id: "mailgun-api-key", regex: /\bkey-[A-Za-z0-9]{32}\b/, description: "Mailgun API Key" },
];

/**
 * Scan text for potential secrets.
 * Returns array of detected secret IDs.
 */
export function detectSecrets(text: string): string[] {
  const detected: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(text)) {
      detected.push(pattern.id);
    }
  }
  return detected;
}

/**
 * Check if text contains any secrets.
 */
export function containsSecrets(text: string): boolean {
  return SECRET_PATTERNS.some((p) => p.regex.test(text));
}

/**
 * Redact detected secrets from text.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern.regex, `<${pattern.id}>`);
  }
  return result;
}
