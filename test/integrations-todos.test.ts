import { describe, it, expect, beforeEach } from "vitest";
import {
  TodosIntegration,
  getTodosIntegration,
  resetTodosIntegration,
  type Task,
} from "../src/integrations/todos.js";

describe("TodosIntegration (fallback mode)", () => {
  let todos: TodosIntegration;

  beforeEach(() => {
    resetTodosIntegration();
    todos = new TodosIntegration({ taskListId: "test-list" });
  });

  it("uses fallback when @hasna/todos is not installed", () => {
    // In test env, @hasna/todos won't be installed in this project
    expect(todos.isNativeAvailable()).toBe(false);
  });

  it("creates a task", async () => {
    const task = await todos.createTask({
      subject: "Fix the login bug",
      description: "Users can't log in with SSO",
    });
    expect(task.id).toBeTruthy();
    expect(task.subject).toBe("Fix the login bug");
    expect(task.status).toBe("pending");
    expect(task.blocks).toEqual([]);
    expect(task.blockedBy).toEqual([]);
  });

  it("gets a task by id", async () => {
    const created = await todos.createTask({ subject: "Test task", description: "desc" });
    const fetched = await todos.getTask(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.subject).toBe("Test task");
  });

  it("returns null for unknown task", async () => {
    expect(await todos.getTask("nonexistent")).toBeNull();
  });

  it("lists all tasks", async () => {
    await todos.createTask({ subject: "A", description: "a" });
    await todos.createTask({ subject: "B", description: "b" });
    await todos.createTask({ subject: "C", description: "c" });
    const all = await todos.listTasks();
    expect(all.length).toBe(3);
  });

  it("filters by status", async () => {
    await todos.createTask({ subject: "Pending", description: "p" });
    await todos.createTask({ subject: "Done", description: "d", status: "completed" });
    const pending = await todos.listTasks({ status: "pending" });
    expect(pending.length).toBe(1);
    expect(pending[0].subject).toBe("Pending");
  });

  it("updates a task", async () => {
    const task = await todos.createTask({ subject: "Original", description: "desc" });
    const updated = await todos.updateTask(task.id, {
      subject: "Updated",
      status: "in_progress",
      owner: "maximus",
    });
    expect(updated).not.toBeNull();
    expect(updated!.subject).toBe("Updated");
    expect(updated!.status).toBe("in_progress");
    expect(updated!.owner).toBe("maximus");
  });

  it("completes a task", async () => {
    const task = await todos.createTask({ subject: "To complete", description: "desc" });
    const completed = await todos.completeTask(task.id, "All done");
    expect(completed!.status).toBe("completed");
  });

  it("deletes a task", async () => {
    const task = await todos.createTask({ subject: "To delete", description: "desc" });
    const deleted = await todos.deleteTask(task.id);
    expect(deleted).toBe(true);
    expect(await todos.getTask(task.id)).toBeNull();
  });

  it("adds dependencies", async () => {
    const a = await todos.createTask({ subject: "Blocker", description: "a" });
    const b = await todos.createTask({ subject: "Blocked", description: "b" });
    await todos.addDependency(a.id, b.id);

    const blockerTask = await todos.getTask(a.id);
    const blockedTask = await todos.getTask(b.id);
    expect(blockerTask!.blocks).toContain(b.id);
    expect(blockedTask!.blockedBy).toContain(a.id);
  });

  it("searches tasks", async () => {
    await todos.createTask({ subject: "Fix login", description: "SSO broken" });
    await todos.createTask({ subject: "Add feature", description: "New button" });
    const results = await todos.searchTasks("login");
    expect(results.length).toBe(1);
    expect(results[0].subject).toBe("Fix login");
  });

  it("searches in description too", async () => {
    await todos.createTask({ subject: "Bug", description: "authentication failure" });
    const results = await todos.searchTasks("authentication");
    expect(results.length).toBe(1);
  });

  it("gets stats", async () => {
    await todos.createTask({ subject: "A", description: "a" });
    await todos.createTask({ subject: "B", description: "b", status: "in_progress" });
    await todos.createTask({ subject: "C", description: "c", status: "completed" });
    const stats = await todos.getStats();
    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.completed).toBe(1);
  });

  it("singleton works", () => {
    resetTodosIntegration();
    const a = getTodosIntegration({ taskListId: "singleton-test" });
    const b = getTodosIntegration();
    expect(a).toBe(b);
  });

  it("creates tasks with metadata", async () => {
    const task = await todos.createTask({
      subject: "With meta",
      description: "desc",
      metadata: { priority: "high", sprint: 42 },
    });
    expect(task.metadata).toEqual({ priority: "high", sprint: 42 });
  });
});
