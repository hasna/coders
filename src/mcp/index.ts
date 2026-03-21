/**
 * MCP module — public API
 */
export {
  createMcpServer,
  runMcpServer,
  type McpServerOptions,
} from "./server.js";

export {
  connectMcpServer,
  connectMcpServers,
  disconnectMcpServer,
  disconnectAllMcpServers,
  getConnectedServers,
  isServerConnected,
  type McpServerConfig,
} from "./client.js";

export {
  loadMcpConfigs,
  addMcpServerConfig,
  removeMcpServerConfig,
  type McpConfigScope,
} from "./config.js";

export {
  initMcpServers,
  type McpInitResult,
} from "./init.js";

export {
  mcpToolsToHandlers,
} from "./handlers.js";
