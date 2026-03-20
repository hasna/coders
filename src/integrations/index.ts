/**
 * @hasna/* integrations — unified entry point
 *
 * Each integration is an optional dependency with graceful fallback.
 * Import the specific integration you need, or use this module to
 * initialize all available integrations at once.
 */

// Priority integrations (full implementations)
export { TodosIntegration, getTodosIntegration, resetTodosIntegration } from "./todos.js";
export { ConversationsIntegration, getConversationsIntegration, resetConversationsIntegration } from "./conversations.js";
export { ConnectorsIntegration, getConnectorsIntegration, resetConnectorsIntegration } from "./connectors.js";
export { MementosIntegration, getMementosIntegration, resetMementosIntegration } from "./mementos.js";

// Remaining integrations (unified lightweight wrappers)
export { getIntegration, initializeAllIntegrations, type IntegrationStatus } from "./ecosystem.js";
