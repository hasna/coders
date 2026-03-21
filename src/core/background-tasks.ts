/**
 * Background task manager — tracks bash commands and agents running in the background.
 *
 * When a Bash command is run with run_in_background:true or an Agent with run_in_background:true,
 * the task is registered here. The UI polls this for status updates.
 *
 * Claude Code spills large output to disk files. We do the same — write output to
 * ~/.coders/tasks/<taskId>.output so TaskOutput can read it.
 */
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type TaskType = "bash" | "agent";
export type TaskStatus = "running" | "completed" | "failed" | "killed";

export interface BackgroundTask {
  id: string;
  type: TaskType;
  description: string;
  status: TaskStatus;
  startTime: number;
  endTime?: number;
  exitCode?: number | null;
  output: string;
  error?: string;
  outputPath?: string;
  /** For agents: token count, last activity */
  progress?: {
    tokenCount?: number;
    lastActivity?: string;
  };
}

// ── Module-level state ──────────────────────────────────────────────

const tasks = new Map<string, BackgroundTask>();
let nextBashId = 1;
let nextAgentId = 1;

// ── Output directory ────────────────────────────────────────────────

const TASKS_DIR = join(homedir(), ".coders", "tasks");

function ensureTasksDir(): void {
  try {
    mkdirSync(TASKS_DIR, { recursive: true });
  } catch {
    // Directory may already exist
  }
}

// ── Public API ──────────────────────────────────────────────────────

export function createTask(type: TaskType, description: string): BackgroundTask {
  const id = type === "bash" ? `bg-${nextBashId++}` : `agent-${nextAgentId++}`;

  ensureTasksDir();
  const outputPath = getOutputPath(id);

  const task: BackgroundTask = {
    id,
    type,
    description,
    status: "running",
    startTime: Date.now(),
    output: "",
    outputPath,
  };

  if (type === "agent") {
    task.progress = { tokenCount: 0 };
  }

  tasks.set(id, task);

  // Initialize the output file
  try {
    writeFileSync(outputPath, "", "utf-8");
  } catch {
    // Non-critical — in-memory buffer is the fallback
  }

  return task;
}

export function updateTask(id: string, updates: Partial<BackgroundTask>): void {
  const task = tasks.get(id);
  if (!task) return;
  Object.assign(task, updates);
}

export function completeTask(id: string, output: string, exitCode?: number): void {
  const task = tasks.get(id);
  if (!task) return;

  task.status = "completed";
  task.output = output;
  task.exitCode = exitCode ?? null;
  task.endTime = Date.now();

  // Write final output to disk
  if (task.outputPath) {
    try {
      writeFileSync(task.outputPath, output, "utf-8");
    } catch {
      // Non-critical
    }
  }
}

export function failTask(id: string, error: string): void {
  const task = tasks.get(id);
  if (!task) return;

  task.status = "failed";
  task.error = error;
  task.endTime = Date.now();

  // Append error to output file
  if (task.outputPath) {
    try {
      appendFileSync(task.outputPath, `\n\n--- ERROR ---\n${error}\n`, "utf-8");
    } catch {
      // Non-critical
    }
  }
}

export function killTask(id: string): void {
  const task = tasks.get(id);
  if (!task) return;

  task.status = "killed";
  task.endTime = Date.now();
}

export function getTask(id: string): BackgroundTask | undefined {
  return tasks.get(id);
}

export function getAllTasks(): BackgroundTask[] {
  return [...tasks.values()];
}

export function getRunningTasks(): BackgroundTask[] {
  return [...tasks.values()].filter((t) => t.status === "running");
}

export function getRecentlyCompletedTasks(withinMs = 60_000): BackgroundTask[] {
  const cutoff = Date.now() - withinMs;
  return [...tasks.values()].filter(
    (t) => t.status !== "running" && t.endTime != null && t.endTime >= cutoff,
  );
}

// ── Output file management ──────────────────────────────────────────

export function getOutputPath(taskId: string): string {
  return join(TASKS_DIR, `${taskId}.output`);
}

export function writeTaskOutput(taskId: string, chunk: string): void {
  const task = tasks.get(taskId);
  if (!task) return;

  // Append to in-memory buffer
  task.output += chunk;

  // Append to disk file
  if (task.outputPath) {
    try {
      appendFileSync(task.outputPath, chunk, "utf-8");
    } catch {
      // Non-critical — in-memory buffer is the primary store
    }
  }
}

export function readTaskOutput(taskId: string): string {
  const task = tasks.get(taskId);

  // Try in-memory first (always fresh)
  if (task?.output) {
    return task.output;
  }

  // Fall back to disk
  const path = getOutputPath(taskId);
  if (existsSync(path)) {
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return "";
    }
  }

  return "";
}
