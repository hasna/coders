/**
 * Tools module — public API
 */
export type {
  Tool,
  ToolContext,
  ToolOptions,
  AppState,
  Notification,
  ValidationResult,
  ToolCallResult,
  ToolResultBlockParam,
} from "./interface.js";

export {
  registerTool,
  registerTools,
  registerDeferredTool,
  registerMcpTool,
  unregisterMcpTool,
  clearMcpTools,
  getTool,
  loadDeferredTool,
  hasTool,
  getEnabledTools,
  getAllToolNames,
  getDeferredToolInfos,
  buildToolDefinitions,
  disableTool,
  enableTool,
  isToolDisabled,
  searchTools,
  isReadOnlyTool,
  isWriteTool,
  resetRegistry,
  setDeferredToolSchema,
  setDeferredToolSchemas,
  getDeferredToolSchema,
  getAllDeferredToolSchemas,
  searchDeferredToolSchemas,
  type DeferredToolInfo,
  type DeferredToolSchema,
} from "./registry.js";

export {
  checkPermissions,
  isToolAutoAllowed,
  getPermissionDeniedReason,
} from "./permissions.js";
