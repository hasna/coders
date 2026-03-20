/**
 * Config module — public API
 */
export {
  getSettings,
  getUserSettings,
  getProjectSettings,
  setProjectRoot,
  getProjectRoot,
  getConfig,
  saveConfig,
  saveUserSettings,
  saveProjectSettings,
  applyCliOverrides,
  resetConfigCache,
} from "./loader.js";

export {
  SettingsSchema,
  DEFAULT_SETTINGS,
  type Settings,
  type Hook,
  type HookCommand,
  type HookEvent,
  type PermissionRule,
  type Sandbox,
  HookEventSchema,
  HookCommandSchema,
  HookSchema,
  PermissionRuleSchema,
  SandboxSchema,
  NetworkSandboxSchema,
  FilesystemSandboxSchema,
} from "./settings.js";

export {
  checkToolPermission,
  enterPlanMode,
  exitPlanMode,
  createDefaultPermissionContext,
  type PermissionResult,
  type PermissionBehavior,
  type PermissionSuggestion,
  type ToolPermissionContext,
} from "./permissions.js";

export {
  getConfigDir,
  getUserSettingsPath,
  getUserConfigPath,
  getSessionsDir,
  getTeamsDir,
  getTasksDir,
  getPluginsDir,
  getPluginDataDir,
  getMarketplacesConfigPath,
  getMcpLogsDir,
  getPlansDir,
  getScheduledTasksPath,
  getProjectConfigDir,
  getProjectSettingsPath,
  getProjectMcpConfigPath,
  getProjectAgentsDir,
  getProjectSkillsDir,
  getInstructionsFilePath,
  resetConfigDir,
} from "./paths.js";
