/**
 * @hasna/connectors native integration
 *
 * Auto-discovers installed API connectors and exposes them as tools
 * in the tool registry. Each connector action becomes a callable tool.
 *
 * Falls back to empty (no connectors) if @hasna/connectors is not installed.
 *
 * Features:
 *   - Auto-discover installed connectors
 *   - Expose connector actions as tools
 *   - Support connector authentication, rate limiting
 *   - Install new connectors
 */
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../tools/interface.js";
import { DEFAULT_MAX_RESULT_SIZE_CHARS } from "../core/constants.js";
import { DEFAULT_TEXT_LIMIT, compactJson, compactLongText } from "../utils/output.js";

// ── Connector types ────────────────────────────────────────────────

export interface Connector {
  name: string;
  description: string;
  version: string;
  actions: ConnectorAction[];
  authenticated: boolean;
}

export interface ConnectorAction {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface ConnectorExecResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

// ── Integration class ──────────────────────────────────────────────

export class ConnectorsIntegration {
  private hasnaConnectors: HasnaConnectorsClient | null = null;
  private cachedConnectors: Connector[] | null = null;

  constructor() {
    this.tryLoadHasnaConnectors();
  }

  private tryLoadHasnaConnectors(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const connectors = require("@hasna/connectors");
      if (connectors && typeof connectors.createClient === "function") {
        this.hasnaConnectors = connectors.createClient();
      }
    } catch {
      this.hasnaConnectors = null;
    }
  }

  isNativeAvailable(): boolean {
    return this.hasnaConnectors !== null;
  }

  // ── Discovery ──────────────────────────────────────────────────

  async getAvailableConnectors(): Promise<Connector[]> {
    if (this.cachedConnectors) return this.cachedConnectors;

    if (this.hasnaConnectors) {
      const result = await this.hasnaConnectors.listConnectors();
      this.cachedConnectors = result.map(mapConnector);
      return this.cachedConnectors;
    }

    return [];
  }

  async getConnector(name: string): Promise<Connector | null> {
    const connectors = await this.getAvailableConnectors();
    return connectors.find((c) => c.name === name) ?? null;
  }

  // ── Execution ──────────────────────────────────────────────────

  async executeConnector(
    connectorName: string,
    actionName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorExecResult> {
    const startTime = performance.now();

    if (this.hasnaConnectors) {
      try {
        const result = await this.hasnaConnectors.execute({
          connector: connectorName,
          action: actionName,
          params,
        });
        return {
          success: true,
          data: result,
          durationMs: performance.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: performance.now() - startTime,
        };
      }
    }

    return {
      success: false,
      error: `Connector "${connectorName}" not available. Install @hasna/connectors to use API connectors.`,
      durationMs: performance.now() - startTime,
    };
  }

  // ── Install ────────────────────────────────────────────────────

  async installConnector(name: string): Promise<boolean> {
    if (this.hasnaConnectors) {
      await this.hasnaConnectors.install?.(name);
      this.cachedConnectors = null; // invalidate cache
      return true;
    }
    return false;
  }

  // ── Tool generation ────────────────────────────────────────────

  /**
   * Convert all discovered connectors into Tool objects
   * that can be registered in the tool registry.
   */
  async asTools(): Promise<Tool[]> {
    const connectors = await this.getAvailableConnectors();
    const tools: Tool[] = [];

    for (const connector of connectors) {
      for (const action of connector.actions) {
        tools.push(createConnectorTool(connector, action, this));
      }
    }

    return tools;
  }

  /**
   * Invalidate cached connector list (e.g., after install).
   */
  invalidateCache(): void {
    this.cachedConnectors = null;
  }
}

// ── Create a Tool from a connector action ──────────────────────────

function createConnectorTool(
  connector: Connector,
  action: ConnectorAction,
  integration: ConnectorsIntegration,
): Tool {
  const toolName = `connector__${connector.name}__${action.name}`;

  return {
    name: toolName,
    searchHint: `${connector.name} ${action.name} ${action.description}`,
    maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
    shouldDefer: true,

    async description() {
      return `[${connector.name}] ${action.description}`;
    },

    async prompt() {
      return `Use the ${connector.name} connector to ${action.description}.\n\nConnector: ${connector.name} v${connector.version}\nAction: ${action.name}`;
    },

    get inputSchema() {
      return z.record(z.unknown()) as any;
    },

    get outputSchema() {
      return z.record(z.unknown()) as any;
    },

    userFacingName() {
      return `${connector.name}.${action.name}`;
    },

    isEnabled() { return true; },
    isConcurrencySafe() { return true; },
    isReadOnly() { return false; },

    toAutoClassifierInput(input: Record<string, unknown>) {
      return `${connector.name} ${action.name} ${JSON.stringify(input).slice(0, 100)}`;
    },

    async checkPermissions(input: Record<string, unknown>) {
      return { behavior: "ask" as const, message: `Execute ${connector.name}.${action.name}?` };
    },

    async validateInput() {
      return { result: true };
    },

    async call(input: Record<string, unknown>): Promise<ToolCallResult> {
      const result = await integration.executeConnector(connector.name, action.name, input);
      if (!result.success) {
        return { data: { error: result.error, success: false } };
      }
      return { data: result.data };
    },

    mapToolResultToToolResultBlockParam(result: unknown, toolUseId: string): ToolResultBlockParam {
      const rawContent = typeof result === "string" ? result : compactJson(result, DEFAULT_TEXT_LIMIT * 2);
      const content = compactLongText(
        rawContent,
        DEFAULT_TEXT_LIMIT * 2,
        "Use connector filters, pagination, or a narrower request for more detail.",
      );
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content,
      };
    },
  };
}

// ── @hasna/connectors client interface (duck-typed) ────────────────

interface HasnaConnectorsClient {
  listConnectors(): Promise<Array<Record<string, unknown>>>;
  execute(params: Record<string, unknown>): Promise<unknown>;
  install?(name: string): Promise<void>;
}

function mapConnector(raw: Record<string, unknown>): Connector {
  return {
    name: String(raw.name ?? ""),
    description: String(raw.description ?? ""),
    version: String(raw.version ?? "0.0.0"),
    actions: Array.isArray(raw.actions)
      ? raw.actions.map((a: Record<string, unknown>) => ({
          name: String(a.name ?? ""),
          description: String(a.description ?? ""),
          inputSchema: (a.input_schema ?? a.inputSchema ?? {}) as Record<string, unknown>,
          outputSchema: (a.output_schema ?? a.outputSchema) as Record<string, unknown> | undefined,
        }))
      : [],
    authenticated: Boolean(raw.authenticated),
  };
}

// ── Singleton ──────────────────────────────────────────────────────

let _instance: ConnectorsIntegration | null = null;

export function getConnectorsIntegration(): ConnectorsIntegration {
  if (!_instance) {
    _instance = new ConnectorsIntegration();
  }
  return _instance;
}

export function resetConnectorsIntegration(): void {
  _instance = null;
}
