/**
 * CLI argument parsing helpers
 */

export function parseBoolEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return undefined;
}

export interface CliOptions {
  print?: boolean;
  verbose?: boolean;
  debug?: boolean;
  model?: string;
  permissionMode?: string;
  worktree?: string | boolean;
  mcpConfig?: string;
  settings?: string;
  dangerouslySkipPermissions?: boolean;
  agentId?: string;
  agentName?: string;
  teamName?: string;
  parentSessionId?: string;
  resume?: string | boolean;
  inputFormat?: "text" | "stream-json";
  outputFormat?: "text" | "json" | "stream-json";
}

export function resolveOptions(raw: Record<string, unknown>): CliOptions {
  return {
    print: raw.print as boolean | undefined,
    verbose: raw.verbose as boolean | undefined,
    debug: raw.debug as boolean | undefined,
    model: raw.model as string | undefined,
    permissionMode: raw.permissionMode as string | undefined,
    worktree: raw.worktree as string | boolean | undefined,
    mcpConfig: raw.mcpConfig as string | undefined,
    settings: raw.settings as string | undefined,
    dangerouslySkipPermissions: raw.dangerouslySkipPermissions as boolean | undefined,
    agentId: raw.agentId as string | undefined,
    agentName: raw.agentName as string | undefined,
    teamName: raw.teamName as string | undefined,
    parentSessionId: raw.parentSessionId as string | undefined,
    resume: raw.resume as string | boolean | undefined,
    inputFormat: raw.inputFormat as CliOptions["inputFormat"],
    outputFormat: raw.outputFormat as CliOptions["outputFormat"],
  };
}
