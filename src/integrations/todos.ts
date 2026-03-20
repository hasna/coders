/**
 * @hasna/todos native integration
 *
 * Provides native task management using @hasna/todos SQLite backend
 * instead of file-based task lists. Falls back to a simple in-memory
 * task store if @hasna/todos is not installed.
 *
 * This replaces Claude Code's file-based task system with a proper
 * database-backed task manager that supports:
 *   - Task prefixes (e.g., OPE23-00001)
 *   - Project scoping
 *   - Agent assignment
 *   - Dependencies (blocks/blockedBy)
 *   - Sync to Claude Code task list format
 *   - MCP server exposure
 */

// ── Task types (independent of @hasna/todos) ───────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  activeForm?: string;
  owner?: string;
  blocks: string[];
  blockedBy: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskParams {
  subject: string;
  description: string;
  activeForm?: string;
  status?: TaskStatus;
  owner?: string;
  blocks?: string[];
  blockedBy?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskParams {
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  owner?: string;
  metadata?: Record<string, unknown>;
}

// ── Integration class ──────────────────────────────────────────────

export class TodosIntegration {
  private hasnaTodos: HasnaTodosClient | null = null;
  private fallbackStore: Map<string, Task> = new Map();
  private nextId = 1;
  private taskListId: string;
  private projectId: string | undefined;

  constructor(options: { taskListId?: string; projectId?: string } = {}) {
    this.taskListId = options.taskListId ?? "default";
    this.projectId = options.projectId;
    this.tryLoadHasnaTodos();
  }

  /**
   * Try to import @hasna/todos. If not installed, fallback to in-memory.
   */
  private tryLoadHasnaTodos(): void {
    try {
      // Dynamic import — @hasna/todos is an optional dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const todos = require("@hasna/todos");
      if (todos && typeof todos.createClient === "function") {
        this.hasnaTodos = todos.createClient({
          taskListId: this.taskListId,
          projectId: this.projectId,
        });
      }
    } catch {
      // @hasna/todos not installed — using fallback
      this.hasnaTodos = null;
    }
  }

  /**
   * Check if @hasna/todos is available.
   */
  isNativeAvailable(): boolean {
    return this.hasnaTodos !== null;
  }

  // ── CRUD Operations ────────────────────────────────────────────

  async createTask(params: CreateTaskParams): Promise<Task> {
    if (this.hasnaTodos) {
      const result = await this.hasnaTodos.createTask({
        title: params.subject,
        description: params.description,
        status: params.status ?? "pending",
        assigned_to: params.owner,
        metadata: params.metadata,
      });
      return mapFromHasna(result);
    }

    // Fallback: in-memory store
    const id = String(this.nextId++);
    const task: Task = {
      id,
      subject: params.subject,
      description: params.description,
      status: params.status ?? "pending",
      activeForm: params.activeForm,
      owner: params.owner,
      blocks: params.blocks ?? [],
      blockedBy: params.blockedBy ?? [],
      metadata: params.metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.fallbackStore.set(id, task);
    return task;
  }

  async getTask(id: string): Promise<Task | null> {
    if (this.hasnaTodos) {
      const result = await this.hasnaTodos.getTask(id);
      return result ? mapFromHasna(result) : null;
    }
    return this.fallbackStore.get(id) ?? null;
  }

  async listTasks(filter?: { status?: TaskStatus }): Promise<Task[]> {
    if (this.hasnaTodos) {
      const result = await this.hasnaTodos.listTasks({
        status: filter?.status,
        project_id: this.projectId,
      });
      return result.map(mapFromHasna);
    }

    let tasks = [...this.fallbackStore.values()];
    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    return tasks;
  }

  async updateTask(id: string, params: UpdateTaskParams): Promise<Task | null> {
    if (this.hasnaTodos) {
      const update: Record<string, unknown> = {};
      if (params.subject !== undefined) update.title = params.subject;
      if (params.description !== undefined) update.description = params.description;
      if (params.status !== undefined) update.status = params.status;
      if (params.owner !== undefined) update.assigned_to = params.owner;
      if (params.metadata !== undefined) update.metadata = params.metadata;

      const result = await this.hasnaTodos.updateTask(id, update);
      return result ? mapFromHasna(result) : null;
    }

    const task = this.fallbackStore.get(id);
    if (!task) return null;

    if (params.subject !== undefined) task.subject = params.subject;
    if (params.description !== undefined) task.description = params.description;
    if (params.status !== undefined) task.status = params.status;
    if (params.activeForm !== undefined) task.activeForm = params.activeForm;
    if (params.owner !== undefined) task.owner = params.owner;
    if (params.metadata !== undefined) task.metadata = { ...task.metadata, ...params.metadata };
    task.updatedAt = new Date().toISOString();

    return task;
  }

  async deleteTask(id: string): Promise<boolean> {
    if (this.hasnaTodos) {
      await this.hasnaTodos.deleteTask(id);
      return true;
    }
    return this.fallbackStore.delete(id);
  }

  async completeTask(id: string, notes?: string): Promise<Task | null> {
    return this.updateTask(id, {
      status: "completed",
      metadata: notes ? { completionNotes: notes } : undefined,
    });
  }

  // ── Dependencies ───────────────────────────────────────────────

  async addDependency(blockerId: string, blockedId: string): Promise<void> {
    if (this.hasnaTodos) {
      await this.hasnaTodos.addDependency?.(blockerId, blockedId);
      return;
    }

    const blocker = this.fallbackStore.get(blockerId);
    const blocked = this.fallbackStore.get(blockedId);
    if (blocker && !blocker.blocks.includes(blockedId)) {
      blocker.blocks.push(blockedId);
    }
    if (blocked && !blocked.blockedBy.includes(blockerId)) {
      blocked.blockedBy.push(blockerId);
    }
  }

  // ── Search ─────────────────────────────────────────────────────

  async searchTasks(query: string): Promise<Task[]> {
    if (this.hasnaTodos) {
      const result = await this.hasnaTodos.searchTasks?.(query) ?? [];
      return result.map(mapFromHasna);
    }

    const queryLower = query.toLowerCase();
    return [...this.fallbackStore.values()].filter(
      (t) =>
        t.subject.toLowerCase().includes(queryLower) ||
        t.description.toLowerCase().includes(queryLower),
    );
  }

  // ── Sync ───────────────────────────────────────────────────────

  /**
   * Sync tasks to a Claude Code task list directory format.
   * This enables backwards compatibility with Claude Code's task system.
   */
  async syncToTaskListDir(dir: string): Promise<void> {
    if (this.hasnaTodos && typeof this.hasnaTodos.sync === "function") {
      await this.hasnaTodos.sync({ taskListId: this.taskListId, direction: "push" });
      return;
    }
    // Fallback: write task files to the directory
    const { writeFileSync, mkdirSync, existsSync } = await import("fs");
    const { join } = await import("path");

    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tasks = await this.listTasks();
    for (const task of tasks) {
      const filePath = join(dir, `${task.id}.json`);
      writeFileSync(filePath, JSON.stringify(task, null, 2), "utf-8");
    }
  }

  // ── Stats ──────────────────────────────────────────────────────

  async getStats(): Promise<{
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
  }> {
    const tasks = await this.listTasks();
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === "pending").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      completed: tasks.filter((t) => t.status === "completed").length,
    };
  }
}

// ── @hasna/todos client interface (duck-typed) ─────────────────────

interface HasnaTodosClient {
  createTask(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  getTask(id: string): Promise<Record<string, unknown> | null>;
  listTasks(filter?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  updateTask(id: string, params: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  deleteTask(id: string): Promise<void>;
  addDependency?(blockerId: string, blockedId: string): Promise<void>;
  searchTasks?(query: string): Promise<Array<Record<string, unknown>>>;
  sync?(params: { taskListId: string; direction: string }): Promise<void>;
}

// ── Mapping from @hasna/todos format ───────────────────────────────

function mapFromHasna(raw: Record<string, unknown>): Task {
  return {
    id: String(raw.id ?? raw.task_id ?? ""),
    subject: String(raw.title ?? raw.subject ?? ""),
    description: String(raw.description ?? ""),
    status: (raw.status as TaskStatus) ?? "pending",
    activeForm: raw.active_form as string | undefined,
    owner: raw.assigned_to as string | undefined,
    blocks: (raw.blocks as string[]) ?? [],
    blockedBy: (raw.blocked_by as string[]) ?? (raw.blockedBy as string[]) ?? [],
    metadata: raw.metadata as Record<string, unknown> | undefined,
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updated_at ?? raw.updatedAt ?? new Date().toISOString()),
  };
}

// ── Singleton ──────────────────────────────────────────────────────

let _instance: TodosIntegration | null = null;

export function getTodosIntegration(options?: { taskListId?: string; projectId?: string }): TodosIntegration {
  if (!_instance) {
    _instance = new TodosIntegration(options);
  }
  return _instance;
}

export function resetTodosIntegration(): void {
  _instance = null;
}
