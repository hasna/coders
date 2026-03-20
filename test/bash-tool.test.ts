import { describe, it, expect } from "vitest";
import { bashTool, isReadOnlyCommand } from "../src/tools/builtin/bash.js";

describe("bash tool", () => {
  it("has correct name", () => {
    expect(bashTool.name).toBe("Bash");
  });

  it("is not read-only", () => {
    expect(bashTool.isReadOnly()).toBe(false);
  });

  it("is not concurrency-safe", () => {
    expect(bashTool.isConcurrencySafe()).toBe(false);
  });

  it("validates empty command", async () => {
    const result = await bashTool.validateInput({ command: "" });
    expect(result.result).toBe(false);
  });

  it("validates excessive timeout", async () => {
    const result = await bashTool.validateInput({ command: "ls", timeout: 999_999_999 });
    expect(result.result).toBe(false);
  });

  it("validates good command", async () => {
    const result = await bashTool.validateInput({ command: "echo hello" });
    expect(result.result).toBe(true);
  });

  it("executes simple command", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await bashTool.call({ command: "echo hello_world" }, ctx);
    expect(result.data.stdout.trim()).toBe("hello_world");
    expect(result.data.exitCode).toBe(0);
    expect(result.data.interrupted).toBe(false);
  });

  it("captures stderr", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await bashTool.call({ command: "echo err >&2" }, ctx);
    expect(result.data.stderr.trim()).toBe("err");
  });

  it("returns non-zero exit code", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await bashTool.call({ command: "exit 42" }, ctx);
    expect(result.data.exitCode).toBe(42);
  });

  it("maps result to API format", () => {
    const block = bashTool.mapToolResultToToolResultBlockParam(
      { stdout: "hello", stderr: "", exitCode: 0, interrupted: false, durationMs: 100 },
      "tool-123",
    );
    expect(block.tool_use_id).toBe("tool-123");
    expect(block.content).toBe("hello");
    expect(block.is_error).toBe(false);
  });

  it("maps error result with exit code", () => {
    const block = bashTool.mapToolResultToToolResultBlockParam(
      { stdout: "", stderr: "not found", exitCode: 1, interrupted: false, durationMs: 50 },
      "tool-456",
    );
    expect(block.is_error).toBe(true);
    expect(block.content).toContain("not found");
    expect(block.content).toContain("Exit code: 1");
  });
});

describe("isReadOnlyCommand", () => {
  // Basic read-only commands
  it("detects ls as read-only", () => expect(isReadOnlyCommand("ls")).toBe(true));
  it("detects ls -la as read-only", () => expect(isReadOnlyCommand("ls -la")).toBe(true));
  it("detects cat file as read-only", () => expect(isReadOnlyCommand("cat foo.txt")).toBe(true));
  it("detects grep as read-only", () => expect(isReadOnlyCommand("grep -r pattern .")).toBe(true));
  it("detects find as read-only", () => expect(isReadOnlyCommand("find . -name '*.ts'")).toBe(true));
  it("detects wc as read-only", () => expect(isReadOnlyCommand("wc -l file.txt")).toBe(true));
  it("detects tree as read-only", () => expect(isReadOnlyCommand("tree src/")).toBe(true));
  it("detects ps as read-only", () => expect(isReadOnlyCommand("ps aux")).toBe(true));
  it("detects date as read-only", () => expect(isReadOnlyCommand("date")).toBe(true));
  it("detects pwd as read-only", () => expect(isReadOnlyCommand("pwd")).toBe(true));

  // Git read-only
  it("detects git status as read-only", () => expect(isReadOnlyCommand("git status")).toBe(true));
  it("detects git diff as read-only", () => expect(isReadOnlyCommand("git diff")).toBe(true));
  it("detects git log as read-only", () => expect(isReadOnlyCommand("git log --oneline -5")).toBe(true));
  it("detects git show as read-only", () => expect(isReadOnlyCommand("git show HEAD")).toBe(true));

  // Git write — NOT read-only
  it("detects git commit as NOT read-only", () => expect(isReadOnlyCommand("git commit -m 'test'")).toBe(false));
  it("detects git push as NOT read-only", () => expect(isReadOnlyCommand("git push")).toBe(false));
  it("detects git checkout as NOT read-only", () => expect(isReadOnlyCommand("git checkout main")).toBe(false));

  // npm read-only
  it("detects npm ls as read-only", () => expect(isReadOnlyCommand("npm ls")).toBe(true));
  it("detects npm info as read-only", () => expect(isReadOnlyCommand("npm info react")).toBe(true));
  it("detects npm install as NOT read-only", () => expect(isReadOnlyCommand("npm install")).toBe(false));

  // Dangerous commands
  it("detects rm as NOT read-only", () => expect(isReadOnlyCommand("rm -rf /")).toBe(false));
  it("detects mkdir as NOT read-only", () => expect(isReadOnlyCommand("mkdir foo")).toBe(false));
  it("detects mv as NOT read-only", () => expect(isReadOnlyCommand("mv a b")).toBe(false));
  it("detects chmod as NOT read-only", () => expect(isReadOnlyCommand("chmod 755 file")).toBe(false));

  // Pipes — all parts must be read-only
  it("detects pipe of read-only commands", () => expect(isReadOnlyCommand("ls | grep foo")).toBe(true));
  it("detects pipe with write command", () => expect(isReadOnlyCommand("ls | tee output.txt")).toBe(false));

  // Chained with &&
  it("detects chain of read-only commands", () => expect(isReadOnlyCommand("git status && git diff")).toBe(true));
  it("detects chain with write command", () => expect(isReadOnlyCommand("git status && git push")).toBe(false));

  // Empty
  it("detects empty command as NOT read-only", () => expect(isReadOnlyCommand("")).toBe(false));

  // Read-only keywords
  it("detects 'terraform plan' via keyword", () => expect(isReadOnlyCommand("terraform plan")).toBe(true));
  it("detects 'helm list' via keyword", () => expect(isReadOnlyCommand("helm list")).toBe(true));
});
