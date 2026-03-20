/**
 * Filesystem sandbox — path-based access control
 *
 * Enforces denyRead/allowRead/allowWrite/denyWrite path patterns
 * for tool execution. Applied to Bash, Read, Edit, Write tools.
 */
import { resolve, isAbsolute } from "path";
import type { Sandbox } from "../../config/settings.js";

export interface FilesystemSandboxConfig {
  denyRead: string[];
  allowRead: string[];
  allowWrite: string[];
  denyWrite: string[];
}

export function createFilesystemSandbox(config?: Sandbox): FilesystemSandboxConfig {
  return {
    denyRead: config?.filesystem?.denyRead ?? [],
    allowRead: config?.filesystem?.allowRead ?? [],
    allowWrite: config?.filesystem?.allowWrite ?? [],
    denyWrite: config?.filesystem?.denyWrite ?? [],
  };
}

export function isPathAllowedForRead(path: string, sandbox: FilesystemSandboxConfig): boolean {
  const resolved = isAbsolute(path) ? path : resolve(process.cwd(), path);

  // Explicit deny takes priority
  for (const pattern of sandbox.denyRead) {
    if (matchesPathPattern(resolved, pattern)) return false;
  }

  // If allowRead is empty, everything not denied is allowed
  if (sandbox.allowRead.length === 0) return true;

  // Must match at least one allow pattern
  return sandbox.allowRead.some((pattern) => matchesPathPattern(resolved, pattern));
}

export function isPathAllowedForWrite(path: string, sandbox: FilesystemSandboxConfig): boolean {
  const resolved = isAbsolute(path) ? path : resolve(process.cwd(), path);

  // Explicit deny takes priority
  for (const pattern of sandbox.denyWrite) {
    if (matchesPathPattern(resolved, pattern)) return false;
  }

  // If allowWrite is empty, everything not denied is allowed
  if (sandbox.allowWrite.length === 0) return true;

  return sandbox.allowWrite.some((pattern) => matchesPathPattern(resolved, pattern));
}

function matchesPathPattern(filePath: string, pattern: string): boolean {
  const resolvedPattern = isAbsolute(pattern) ? pattern : resolve(process.cwd(), pattern);

  if (resolvedPattern.endsWith("/**")) {
    const prefix = resolvedPattern.slice(0, -3);
    return filePath.startsWith(prefix);
  }
  if (resolvedPattern.includes("*")) {
    const regex = new RegExp("^" + resolvedPattern.replace(/\*/g, "[^/]*") + "$");
    return regex.test(filePath);
  }
  return filePath === resolvedPattern || filePath.startsWith(resolvedPattern + "/");
}
