/**
 * Network sandbox — domain-based access control
 *
 * Enforces allowedDomains/deniedDomains for network requests.
 * Supports wildcard patterns (e.g., *.example.com).
 */
import type { Sandbox } from "../../config/settings.js";

export interface NetworkSandboxConfig {
  allowedDomains: string[];
  deniedDomains: string[];
  allowUnixSockets: string[];
  allowAllUnixSockets: boolean;
}

export function createNetworkSandbox(config?: Sandbox): NetworkSandboxConfig {
  return {
    allowedDomains: config?.network?.allowedDomains ?? [],
    deniedDomains: config?.network?.deniedDomains ?? [],
    allowUnixSockets: config?.network?.allowUnixSockets ?? [],
    allowAllUnixSockets: config?.network?.allowAllUnixSockets ?? false,
  };
}

export function isDomainAllowed(domain: string, sandbox: NetworkSandboxConfig): boolean {
  const domainLower = domain.toLowerCase();

  // Explicit deny takes priority
  for (const pattern of sandbox.deniedDomains) {
    if (matchesDomainPattern(domainLower, pattern.toLowerCase())) return false;
  }

  // If allowedDomains is empty, everything not denied is allowed
  if (sandbox.allowedDomains.length === 0) return true;

  return sandbox.allowedDomains.some((pattern) =>
    matchesDomainPattern(domainLower, pattern.toLowerCase())
  );
}

function matchesDomainPattern(domain: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".example.com"
    return domain.endsWith(suffix) || domain === pattern.slice(2);
  }
  return domain === pattern;
}

export function isUnixSocketAllowed(socketPath: string, sandbox: NetworkSandboxConfig): boolean {
  if (sandbox.allowAllUnixSockets) return true;
  return sandbox.allowUnixSockets.some((allowed) => socketPath === allowed || socketPath.startsWith(allowed));
}
