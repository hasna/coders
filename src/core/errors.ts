/**
 * Error hierarchy — matching Claude Code's error classes
 * but with readable names instead of obfuscated identifiers
 */

export class CoderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoderError";
  }
}

export class GenericError extends CoderError {
  constructor(message: string) {
    super(message);
    this.name = "GenericError";
  }
}

export class AbortError extends CoderError {
  constructor(message = "Operation aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export class ConfigParseError extends CoderError {
  filePath: string;
  defaultConfig: unknown;

  constructor(message: string, filePath: string, defaultConfig?: unknown) {
    super(message);
    this.name = "ConfigParseError";
    this.filePath = filePath;
    this.defaultConfig = defaultConfig;
  }
}

export class ShellError extends CoderError {
  stdout: string;
  stderr: string;
  code: number | null;
  interrupted: boolean;

  constructor(
    message: string,
    opts: { stdout: string; stderr: string; code: number | null; interrupted?: boolean }
  ) {
    super(message);
    this.name = "ShellError";
    this.stdout = opts.stdout;
    this.stderr = opts.stderr;
    this.code = opts.code;
    this.interrupted = opts.interrupted ?? false;
  }
}

export class TeleportOperationError extends CoderError {
  constructor(message: string) {
    super(message);
    this.name = "TeleportOperationError";
  }
}

export class BridgeFatalError extends CoderError {
  status: number;
  errorType: string;

  constructor(message: string, status: number, errorType: string) {
    super(message);
    this.name = "BridgeFatalError";
    this.status = status;
    this.errorType = errorType;
  }
}

export class TelemetrySafeError extends CoderError {
  telemetryMessage: string;

  constructor(message: string, telemetryMessage?: string) {
    super(message);
    this.name = "TelemetrySafeError";
    this.telemetryMessage = telemetryMessage ?? sanitizeForTelemetry(message);
  }
}

export class RipgrepTimeoutError extends CoderError {
  partialResults: string;

  constructor(message: string, partialResults: string) {
    super(message);
    this.name = "RipgrepTimeoutError";
    this.partialResults = partialResults;
  }
}

function sanitizeForTelemetry(message: string): string {
  // Remove potential secrets, file paths, and PII
  return message
    .replace(/\/Users\/[^\s]+/g, "<path>")
    .replace(/\/home\/[^\s]+/g, "<path>")
    .replace(/[A-Za-z0-9+/=]{40,}/g, "<token>")
    .replace(/sk-[A-Za-z0-9]{20,}/g, "<api-key>")
    .slice(0, 500);
}

export function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
