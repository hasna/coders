/**
 * Settings schema — Zod-validated configuration
 *
 * Matches Claude Code's settings structure (03-config-settings.js)
 * but defined cleanly with proper types.
 */
import { z } from "zod";
import type { PermissionMode } from "../core/constants.js";

// ── Hook schema ────────────────────────────────────────────────────

export const HookEventSchema = z.enum([
  "SessionStart",
  "Setup",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "WorktreeCreate",
  "InstructionsLoaded",
  "UserPromptSubmit",
]);

export const HookCommandSchema = z.object({
  type: z.literal("command"),
  command: z.string(),
  timeout: z.number().optional(),
});

export const HookSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.record(HookEventSchema, z.array(HookCommandSchema)).optional(),
});

export type HookEvent = z.infer<typeof HookEventSchema>;
export type HookCommand = z.infer<typeof HookCommandSchema>;
export type Hook = z.infer<typeof HookSchema>;

// ── Permission rule schema ─────────────────────────────────────────

export const PermissionRuleSchema = z.object({
  toolName: z.string().optional(),
  command: z.string().optional(),
  path: z.string().optional(),
  behavior: z.enum(["allow", "deny"]),
  destination: z.enum(["localSettings", "userSettings", "projectSettings"]).optional(),
});

export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

// ── Sandbox schema ─────────────────────────────────────────────────

export const NetworkSandboxSchema = z.object({
  allowedDomains: z.array(z.string()).optional(),
  deniedDomains: z.array(z.string()).optional(),
  allowUnixSockets: z.array(z.string()).optional(),
  allowAllUnixSockets: z.boolean().optional(),
  allowLocalBinding: z.boolean().optional(),
  httpProxyPort: z.number().optional(),
  socksProxyPort: z.number().optional(),
});

export const FilesystemSandboxSchema = z.object({
  denyRead: z.array(z.string()).optional(),
  allowRead: z.array(z.string()).optional(),
  allowWrite: z.array(z.string()).optional(),
  denyWrite: z.array(z.string()).optional(),
  allowGitConfig: z.boolean().optional(),
});

export const SandboxSchema = z.object({
  network: NetworkSandboxSchema.optional(),
  filesystem: FilesystemSandboxSchema.optional(),
});

export type Sandbox = z.infer<typeof SandboxSchema>;

// ── Main settings schema ───────────────────────────────────────────

export const SettingsSchema = z.object({
  // Model
  model: z.string().nullable().optional(),
  alwaysThinkingEnabled: z.boolean().optional(),

  // Permissions
  permissions: z.object({
    defaultMode: z.enum(["default", "plan", "acceptEdits", "dontAsk", "auto", "bypassPermissions"]).optional(),
    allow: z.array(PermissionRuleSchema).optional(),
    deny: z.array(PermissionRuleSchema).optional(),
  }).optional(),

  // Hooks
  hooks: z.record(z.string(), z.array(HookCommandSchema)).optional(),

  // Sandbox
  sandbox: SandboxSchema.optional(),

  // UI
  theme: z.string().optional(),
  editorMode: z.enum(["default", "vim", "emacs"]).optional(),
  verbose: z.boolean().optional(),
  showTurnDuration: z.boolean().optional(),

  // Thinking
  thinking: z.object({
    enabled: z.boolean(),
    budgetTokens: z.number().optional(),
  }).optional(),

  // Features
  autoCompactEnabled: z.boolean().optional(),
  autoMemoryEnabled: z.boolean().optional(),
  fileCheckpointingEnabled: z.boolean().optional(),
  todoFeatureEnabled: z.boolean().optional(),
  terminalProgressBarEnabled: z.boolean().optional(),

  // Language
  language: z.string().optional(),

  // Voice
  voiceEnabled: z.boolean().optional(),

  // Attribution
  attribution: z.object({
    includeCoAuthoredBy: z.boolean().optional(),
    includePrAttribution: z.boolean().optional(),
  }).optional(),

  // Auto-updates
  autoUpdatesChannel: z.enum(["stable", "latest"]).optional(),

  // MCP
  mcpServers: z.record(z.string(), z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    transport: z.enum(["stdio", "sse", "streamable-http"]).optional(),
    url: z.string().optional(),
  })).optional(),

  // Task list
  checkTasksConfig: z.object({
    taskListId: z.string().optional(),
  }).optional(),

  // Teammate mode
  teammateMode: z.enum(["auto", "tmux", "in-process"]).optional(),

  // Remote control
  remoteControlAtStartup: z.boolean().optional(),

  // Custom status line — run an external command to render the status bar
  statusLine: z.object({
    type: z.literal("command"),
    command: z.string(),
    padding: z.number().optional(),
  }).optional(),
}).passthrough(); // Allow unknown keys for forward compat

export type Settings = z.infer<typeof SettingsSchema>;

// ── Defaults ───────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Settings = {
  model: null,
  alwaysThinkingEnabled: undefined,
  permissions: {
    defaultMode: "bypassPermissions",
    allow: [],
    deny: [],
  },
  hooks: {},
  sandbox: undefined,
  theme: "default",
  editorMode: "default",
  verbose: false,
  showTurnDuration: false,
  thinking: undefined,
  autoCompactEnabled: true,
  autoMemoryEnabled: true,
  fileCheckpointingEnabled: true,
  todoFeatureEnabled: true,
  terminalProgressBarEnabled: false,
  autoUpdatesChannel: "latest",
};
