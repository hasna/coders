import { describe, it, expect, beforeEach } from "vitest";
import { taskCreateTool, taskGetTool, taskListTool, taskUpdateTool } from "../src/tools/builtin/tasks.js";
import { resetTodosIntegration } from "../src/integrations/todos.js";

const mockContext = {
  abortController: new AbortController(),
  getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
  setAppState: () => {},
  options: {} as any,
};

describe("Task tools", () => {
  beforeEach(() => {
    resetTodosIntegration();
  });

  it("TaskCreate has correct name", () => expect(taskCreateTool.name).toBe("TaskCreate"));
  it("TaskGet has correct name", () => expect(taskGetTool.name).toBe("TaskGet"));
  it("TaskList has correct name", () => expect(taskListTool.name).toBe("TaskList"));
  it("TaskUpdate has correct name", () => expect(taskUpdateTool.name).toBe("TaskUpdate"));

  it("TaskGet is read-only", () => expect(taskGetTool.isReadOnly()).toBe(true));
  it("TaskList is read-only", () => expect(taskListTool.isReadOnly()).toBe(true));
  it("TaskCreate is not read-only", () => expect(taskCreateTool.isReadOnly()).toBe(false));

  it("creates a task", async () => {
    const result = await taskCreateTool.call(
      { subject: "Fix bug", description: "Fix the login bug" },
      mockContext,
    );
    expect(result.data.task.id).toBeTruthy();
    expect(result.data.task.subject).toBe("Fix bug");
  });

  it("gets a created task", async () => {
    const created = await taskCreateTool.call(
      { subject: "Test task", description: "desc" },
      mockContext,
    );
    const result = await taskGetTool.call(
      { taskId: created.data.task.id },
      mockContext,
    );
    expect(result.data.task).not.toBeNull();
    expect(result.data.task!.subject).toBe("Test task");
  });

  it("returns null for unknown task", async () => {
    const result = await taskGetTool.call({ taskId: "999" }, mockContext);
    expect(result.data.task).toBeNull();
  });

  it("lists tasks", async () => {
    await taskCreateTool.call({ subject: "A", description: "a" }, mockContext);
    await taskCreateTool.call({ subject: "B", description: "b" }, mockContext);
    const result = await taskListTool.call({} as any, mockContext);
    expect(result.data.tasks.length).toBe(2);
  });

  it("updates task status", async () => {
    const created = await taskCreateTool.call(
      { subject: "To update", description: "desc" },
      mockContext,
    );
    const result = await taskUpdateTool.call(
      { taskId: created.data.task.id, status: "in_progress" },
      mockContext,
    );
    expect(result.data.success).toBe(true);
    expect(result.data.statusChange?.to).toBe("in_progress");
  });

  it("deletes a task", async () => {
    const created = await taskCreateTool.call(
      { subject: "To delete", description: "desc" },
      mockContext,
    );
    const result = await taskUpdateTool.call(
      { taskId: created.data.task.id, status: "deleted" },
      mockContext,
    );
    expect(result.data.success).toBe(true);

    const get = await taskGetTool.call({ taskId: created.data.task.id }, mockContext);
    expect(get.data.task).toBeNull();
  });

  it("maps TaskCreate result", () => {
    const block = taskCreateTool.mapToolResultToToolResultBlockParam(
      { task: { id: "42", subject: "Fix bug" } }, "t1",
    );
    expect(block.content).toContain("#42");
    expect(block.content).toContain("Fix bug");
  });

  it("maps TaskList empty result", () => {
    const block = taskListTool.mapToolResultToToolResultBlockParam(
      { tasks: [] }, "t2",
    );
    expect(block.content).toContain("No tasks");
  });

  it("maps TaskUpdate result", () => {
    const block = taskUpdateTool.mapToolResultToToolResultBlockParam(
      { success: true, taskId: "5", updatedFields: ["status", "owner"] }, "t3",
    );
    expect(block.content).toContain("#5");
    expect(block.content).toContain("status, owner");
  });
});
