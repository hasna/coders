/**
 * @hasna/mementos native integration — persistent agent memory
 *
 * Replaces Claude Code's file-based auto-memory with @hasna/mementos
 * SQLite backend. Supports scoped memories (global/shared/private),
 * categories, importance, tags, and search.
 *
 * Falls back to in-memory Map store if @hasna/mementos not installed.
 */

// ── Memory types ───────────────────────────────────────────────────

export type MemoryScope = "global" | "shared" | "private";
export type MemoryCategory = "knowledge" | "preference" | "fact" | "history";

export interface Memory {
  id: string;
  key: string;
  value: string;
  scope: MemoryScope;
  category: MemoryCategory;
  importance: number; // 1-10
  tags: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SaveMemoryParams {
  key: string;
  value: string;
  scope?: MemoryScope;
  category?: MemoryCategory;
  importance?: number;
  tags?: string[];
}

// ── Integration class ──────────────────────────────────────────────

export class MementosIntegration {
  private hasnaMementos: HasnaMementosClient | null = null;
  private fallbackStore: Map<string, Memory> = new Map();
  private nextId = 1;
  private projectId?: string;
  private agentId?: string;

  constructor(options?: { projectId?: string; agentId?: string }) {
    this.projectId = options?.projectId;
    this.agentId = options?.agentId;
    this.tryLoad();
  }

  private tryLoad(): void {
    try {
      const mementos = require("@hasna/mementos");
      if (mementos && typeof mementos.createClient === "function") {
        this.hasnaMementos = mementos.createClient({
          projectId: this.projectId,
          agentId: this.agentId,
        });
      }
    } catch {
      this.hasnaMementos = null;
    }
  }

  isNativeAvailable(): boolean { return this.hasnaMementos !== null; }

  // ── Project & Agent Registration ───────────────────────────────

  async registerProject(name: string, path: string): Promise<string> {
    if (this.hasnaMementos) {
      const result = await this.hasnaMementos.registerProject({ name, path });
      this.projectId = String(result.id ?? result.project_id ?? "");
      return this.projectId;
    }
    this.projectId = `proj-${this.nextId++}`;
    return this.projectId;
  }

  async registerAgent(name: string, role?: string): Promise<string> {
    if (this.hasnaMementos) {
      const result = await this.hasnaMementos.registerAgent({
        name, role, project_id: this.projectId,
      });
      this.agentId = String(result.id ?? result.agent_id ?? "");
      return this.agentId;
    }
    this.agentId = name;
    return name;
  }

  // ── Memory CRUD ────────────────────────────────────────────────

  async save(params: SaveMemoryParams): Promise<Memory> {
    if (this.hasnaMementos) {
      const result = await this.hasnaMementos.memorySave({
        key: params.key,
        value: params.value,
        scope: params.scope ?? "shared",
        category: params.category ?? "knowledge",
        importance: params.importance ?? 5,
        tags: params.tags,
      });
      return mapMemory(result);
    }

    const existing = this.fallbackStore.get(params.key);
    const memory: Memory = {
      id: existing?.id ?? String(this.nextId++),
      key: params.key,
      value: params.value,
      scope: params.scope ?? "shared",
      category: params.category ?? "knowledge",
      importance: params.importance ?? 5,
      tags: params.tags ?? [],
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: (existing?.version ?? 0) + 1,
    };
    this.fallbackStore.set(params.key, memory);
    return memory;
  }

  async get(key: string): Promise<Memory | null> {
    if (this.hasnaMementos) {
      const result = await this.hasnaMementos.memoryGet?.({ key });
      return result ? mapMemory(result) : null;
    }
    return this.fallbackStore.get(key) ?? null;
  }

  async list(scope?: MemoryScope): Promise<Memory[]> {
    if (this.hasnaMementos) {
      const result = await this.hasnaMementos.memoryList?.({ scope, project_id: this.projectId }) ?? [];
      return result.map(mapMemory);
    }
    let memories = [...this.fallbackStore.values()];
    if (scope) memories = memories.filter(m => m.scope === scope);
    return memories;
  }

  async search(query: string): Promise<Memory[]> {
    if (this.hasnaMementos) {
      const result = await this.hasnaMementos.memorySearch?.({ query, project_id: this.projectId }) ?? [];
      return result.map(mapMemory);
    }
    const q = query.toLowerCase();
    return [...this.fallbackStore.values()].filter(m =>
      m.key.toLowerCase().includes(q) ||
      m.value.toLowerCase().includes(q) ||
      m.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  async forget(key: string): Promise<boolean> {
    if (this.hasnaMementos) {
      await this.hasnaMementos.memoryForget?.({ key });
      return true;
    }
    return this.fallbackStore.delete(key);
  }

  async recall(query: string, limit = 10): Promise<Memory[]> {
    if (this.hasnaMementos) {
      const result = await this.hasnaMementos.memoryRecall?.({ query, limit, project_id: this.projectId }) ?? [];
      return result.map(mapMemory);
    }
    // Fallback: search + sort by importance
    const results = await this.search(query);
    return results.sort((a, b) => b.importance - a.importance).slice(0, limit);
  }
}

// ── Client interface (duck-typed) ──────────────────────────────────

interface HasnaMementosClient {
  registerProject(p: Record<string, unknown>): Promise<Record<string, unknown>>;
  registerAgent(p: Record<string, unknown>): Promise<Record<string, unknown>>;
  memorySave(p: Record<string, unknown>): Promise<Record<string, unknown>>;
  memoryGet?(p: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  memoryList?(p: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  memorySearch?(p: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  memoryRecall?(p: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  memoryForget?(p: Record<string, unknown>): Promise<void>;
}

function mapMemory(raw: Record<string, unknown>): Memory {
  return {
    id: String(raw.id ?? ""),
    key: String(raw.key ?? ""),
    value: String(raw.value ?? ""),
    scope: (raw.scope as MemoryScope) ?? "shared",
    category: (raw.category as MemoryCategory) ?? "knowledge",
    importance: Number(raw.importance ?? 5),
    tags: (raw.tags as string[]) ?? [],
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updated_at ?? raw.updatedAt ?? new Date().toISOString()),
    version: Number(raw.version ?? 1),
  };
}

// ── Singleton ──────────────────────────────────────────────────────

let _instance: MementosIntegration | null = null;

export function getMementosIntegration(options?: { projectId?: string; agentId?: string }): MementosIntegration {
  if (!_instance) _instance = new MementosIntegration(options);
  return _instance;
}

export function resetMementosIntegration(): void { _instance = null; }
