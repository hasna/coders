/**
 * @hasna/conversations native integration
 *
 * Provides real-time agent-to-agent messaging using @hasna/conversations.
 * Falls back to in-memory message queue if not installed.
 *
 * Features:
 *   - Agent registration with presence (heartbeat)
 *   - Direct messages (DMs) between agents
 *   - Space-based group channels (project > topic hierarchy)
 *   - Priority levels (normal, high)
 *   - Read tracking
 *   - Polling for incoming messages
 */

// ── Message types ──────────────────────────────────────────────────

export interface AgentMessage {
  id: string | number;
  from: string;
  to: string;
  content: string;
  space?: string;
  priority: "normal" | "high";
  createdAt: string;
  readAt?: string;
}

export interface Space {
  name: string;
  description?: string;
  projectId?: string;
  parentId?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  role?: string;
  status: "active" | "idle" | "offline";
  lastSeenAt: string;
}

// ── Integration class ──────────────────────────────────────────────

export class ConversationsIntegration {
  private hasnaConvos: HasnaConversationsClient | null = null;
  private agentName: string;
  private sessionId: string;
  private projectId?: string;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // Fallback in-memory store
  private fallbackInbox: AgentMessage[] = [];
  private fallbackSpaces: Map<string, Space> = new Map();
  private fallbackSpaceMessages: Map<string, AgentMessage[]> = new Map();
  private fallbackAgents: Map<string, AgentInfo> = new Map();
  private nextMsgId = 1;

  constructor(options: {
    agentName: string;
    sessionId: string;
    projectId?: string;
  }) {
    this.agentName = options.agentName;
    this.sessionId = options.sessionId;
    this.projectId = options.projectId;
    this.tryLoadHasnaConversations();
  }

  private tryLoadHasnaConversations(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const convos = require("@hasna/conversations");
      if (convos && typeof convos.createClient === "function") {
        this.hasnaConvos = convos.createClient({
          agentName: this.agentName,
          sessionId: this.sessionId,
          projectId: this.projectId,
        });
      }
    } catch {
      this.hasnaConvos = null;
    }
  }

  isNativeAvailable(): boolean {
    return this.hasnaConvos !== null;
  }

  // ── Agent Registration ─────────────────────────────────────────

  async registerAgent(role?: string): Promise<AgentInfo> {
    if (this.hasnaConvos) {
      const result = await this.hasnaConvos.registerAgent({
        name: this.agentName,
        session_id: this.sessionId,
        project_id: this.projectId,
        role,
      });
      return mapAgentInfo(result);
    }

    const info: AgentInfo = {
      id: this.agentName,
      name: this.agentName,
      role,
      status: "active",
      lastSeenAt: new Date().toISOString(),
    };
    this.fallbackAgents.set(this.agentName, info);
    return info;
  }

  // ── Heartbeat ──────────────────────────────────────────────────

  startHeartbeat(intervalMs = 30_000): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(async () => {
      try {
        if (this.hasnaConvos) {
          await this.hasnaConvos.heartbeat({ name: this.agentName });
        } else {
          const agent = this.fallbackAgents.get(this.agentName);
          if (agent) agent.lastSeenAt = new Date().toISOString();
        }
      } catch {
        // swallow heartbeat errors
      }
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ── Direct Messages ────────────────────────────────────────────

  async sendMessage(to: string, content: string, priority: "normal" | "high" = "normal"): Promise<AgentMessage> {
    if (this.hasnaConvos) {
      const result = await this.hasnaConvos.sendMessage({
        to,
        content,
        from: this.agentName,
        priority,
      });
      return mapMessage(result);
    }

    const msg: AgentMessage = {
      id: this.nextMsgId++,
      from: this.agentName,
      to,
      content,
      priority,
      createdAt: new Date().toISOString(),
    };
    this.fallbackInbox.push(msg);
    return msg;
  }

  async readMessages(options?: { unreadOnly?: boolean }): Promise<AgentMessage[]> {
    if (this.hasnaConvos) {
      const result = await this.hasnaConvos.readMessages({
        agent: this.agentName,
        unread_only: options?.unreadOnly,
      });
      return result.map(mapMessage);
    }

    let messages = this.fallbackInbox.filter((m) => m.to === this.agentName);
    if (options?.unreadOnly) {
      messages = messages.filter((m) => !m.readAt);
    }
    // Mark as read
    for (const msg of messages) {
      msg.readAt = new Date().toISOString();
    }
    return messages;
  }

  // ── Spaces ─────────────────────────────────────────────────────

  async createSpace(name: string, description?: string): Promise<Space> {
    if (this.hasnaConvos) {
      const result = await this.hasnaConvos.createSpace({
        name,
        description,
        project_id: this.projectId,
        from: this.agentName,
      });
      return { name: String(result.name ?? name), description: result.description as string | undefined, projectId: this.projectId };
    }

    const space: Space = { name, description, projectId: this.projectId };
    this.fallbackSpaces.set(name, space);
    this.fallbackSpaceMessages.set(name, []);
    return space;
  }

  async joinSpace(spaceName: string): Promise<void> {
    if (this.hasnaConvos) {
      await this.hasnaConvos.joinSpace?.({ space: spaceName, agent: this.agentName });
      return;
    }
    if (!this.fallbackSpaces.has(spaceName)) {
      this.fallbackSpaces.set(spaceName, { name: spaceName });
      this.fallbackSpaceMessages.set(spaceName, []);
    }
  }

  async sendToSpace(spaceName: string, content: string, priority: "normal" | "high" = "normal"): Promise<AgentMessage> {
    if (this.hasnaConvos) {
      const result = await this.hasnaConvos.sendToSpace({
        space: spaceName,
        content,
        from: this.agentName,
        priority,
      });
      return mapMessage(result);
    }

    const msg: AgentMessage = {
      id: this.nextMsgId++,
      from: this.agentName,
      to: spaceName,
      content,
      space: spaceName,
      priority,
      createdAt: new Date().toISOString(),
    };
    const msgs = this.fallbackSpaceMessages.get(spaceName) ?? [];
    msgs.push(msg);
    this.fallbackSpaceMessages.set(spaceName, msgs);
    return msg;
  }

  async readSpaceMessages(spaceName: string, limit = 20): Promise<AgentMessage[]> {
    if (this.hasnaConvos) {
      const result = await this.hasnaConvos.readSpace?.({ space: spaceName, limit }) ?? [];
      return result.map(mapMessage);
    }

    const msgs = this.fallbackSpaceMessages.get(spaceName) ?? [];
    return msgs.slice(-limit);
  }

  // ── Agent listing ──────────────────────────────────────────────

  async listAgents(): Promise<AgentInfo[]> {
    if (this.hasnaConvos) {
      const result = await this.hasnaConvos.listAgents?.() ?? [];
      return result.map(mapAgentInfo);
    }
    return [...this.fallbackAgents.values()];
  }

  // ── Cleanup ────────────────────────────────────────────────────

  destroy(): void {
    this.stopHeartbeat();
  }
}

// ── @hasna/conversations client interface (duck-typed) ─────────────

interface HasnaConversationsClient {
  registerAgent(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  heartbeat(params: Record<string, unknown>): Promise<void>;
  sendMessage(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  readMessages(params: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  createSpace(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  joinSpace?(params: Record<string, unknown>): Promise<void>;
  sendToSpace(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  readSpace?(params: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  listAgents?(): Promise<Array<Record<string, unknown>>>;
}

// ── Mapping ────────────────────────────────────────────────────────

function mapMessage(raw: Record<string, unknown>): AgentMessage {
  return {
    id: raw.id as string | number ?? 0,
    from: String(raw.from_agent ?? raw.from ?? ""),
    to: String(raw.to_agent ?? raw.to ?? ""),
    content: String(raw.content ?? raw.text ?? ""),
    space: raw.space as string | undefined,
    priority: (raw.priority as "normal" | "high") ?? "normal",
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
    readAt: raw.read_at as string | undefined,
  };
}

function mapAgentInfo(raw: Record<string, unknown>): AgentInfo {
  return {
    id: String(raw.id ?? raw.agent_id ?? ""),
    name: String(raw.name ?? raw.agent ?? ""),
    role: raw.role as string | undefined,
    status: (raw.status as AgentInfo["status"]) ?? (raw.online ? "active" : "offline"),
    lastSeenAt: String(raw.last_seen_at ?? raw.lastSeenAt ?? new Date().toISOString()),
  };
}

// ── Singleton ──────────────────────────────────────────────────────

let _instance: ConversationsIntegration | null = null;

export function getConversationsIntegration(options?: {
  agentName: string;
  sessionId: string;
  projectId?: string;
}): ConversationsIntegration {
  if (!_instance && options) {
    _instance = new ConversationsIntegration(options);
  }
  if (!_instance) {
    throw new Error("ConversationsIntegration not initialized. Call with options first.");
  }
  return _instance;
}

export async function sendMessage(to: string, content: string, priority: "normal" | "high" = "normal"): Promise<AgentMessage> {
  return getConversationsIntegration().sendMessage(to, content, priority);
}

export function resetConversationsIntegration(): void {
  _instance?.destroy();
  _instance = null;
}
