/**
 * Platform keychain integration
 *
 * macOS: security find-generic-password / add-generic-password
 * Linux: secret-tool (libsecret)
 * Windows: not yet supported
 */
import { execSync } from "child_process";
import { platform } from "os";

const SERVICE_NAME = "hasna-coders";
const ACCOUNT_NAME = "api-key";

/**
 * Get API key from platform keychain.
 */
export function getKeychainApiKey(): string | null {
  const os = platform();

  try {
    switch (os) {
      case "darwin":
        return getMacOSKeychainKey();
      case "linux":
        return getLinuxKeychainKey();
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Store API key in platform keychain.
 */
export function setKeychainApiKey(apiKey: string): boolean {
  const os = platform();

  try {
    switch (os) {
      case "darwin":
        return setMacOSKeychainKey(apiKey);
      case "linux":
        return setLinuxKeychainKey(apiKey);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Remove API key from platform keychain.
 */
export function removeKeychainApiKey(): boolean {
  const os = platform();

  try {
    switch (os) {
      case "darwin":
        execSync(
          `security delete-generic-password -s "${SERVICE_NAME}" -a "${ACCOUNT_NAME}" 2>/dev/null`,
          { stdio: "pipe" }
        );
        return true;
      case "linux":
        execSync(
          `secret-tool clear service "${SERVICE_NAME}" account "${ACCOUNT_NAME}" 2>/dev/null`,
          { stdio: "pipe" }
        );
        return true;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

// ── macOS ──────────────────────────────────────────────────────────

function getMacOSKeychainKey(): string | null {
  try {
    const result = execSync(
      `security find-generic-password -s "${SERVICE_NAME}" -a "${ACCOUNT_NAME}" -w 2>/dev/null`,
      { stdio: "pipe", encoding: "utf-8" }
    );
    const key = result.trim();
    return key || null;
  } catch {
    return null;
  }
}

function setMacOSKeychainKey(apiKey: string): boolean {
  try {
    // Delete existing entry first (ignore errors)
    try {
      execSync(
        `security delete-generic-password -s "${SERVICE_NAME}" -a "${ACCOUNT_NAME}" 2>/dev/null`,
        { stdio: "pipe" }
      );
    } catch {
      // ignore
    }
    execSync(
      `security add-generic-password -s "${SERVICE_NAME}" -a "${ACCOUNT_NAME}" -w "${apiKey}"`,
      { stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

// ── Linux ──────────────────────────────────────────────────────────

function getLinuxKeychainKey(): string | null {
  try {
    const result = execSync(
      `secret-tool lookup service "${SERVICE_NAME}" account "${ACCOUNT_NAME}" 2>/dev/null`,
      { stdio: "pipe", encoding: "utf-8" }
    );
    const key = result.trim();
    return key || null;
  } catch {
    return null;
  }
}

function setLinuxKeychainKey(apiKey: string): boolean {
  try {
    execSync(
      `echo -n "${apiKey}" | secret-tool store --label="Coders API Key" service "${SERVICE_NAME}" account "${ACCOUNT_NAME}"`,
      { stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}
