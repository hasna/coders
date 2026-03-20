/**
 * API module — public API
 */
export {
  ApiClient,
  ApiError,
  getApiClient,
  resetApiClient,
  type MessageRequest,
  type MessageResponse,
  type Message,
  type SystemBlock,
  type ToolDefinition,
  type ToolChoice,
  type ThinkingConfig,
  type TokenCountResponse,
} from "./client.js";

export {
  MODEL_REGISTRY,
  resolveModelId,
  isKnownModel,
  getModelEntry,
  hasExtendedContext,
  getContextWindow,
  getDefaultModel,
  getSubAgentModel,
  type ModelEntry,
  type ModelVariants,
} from "./models.js";

export {
  parseSSEStream,
  accumulateStream,
  estimateCost,
  type StreamEvent,
  type StreamEventType,
  type ContentBlock,
  type TextBlock,
  type ThinkingBlock,
  type ToolUseBlock,
  type ServerToolUseBlock,
  type WebSearchToolResultBlock,
  type ContentDelta,
  type AccumulatedMessage,
  type TokenUsage,
  type CostEstimate,
} from "./streaming.js";
