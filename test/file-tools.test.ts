import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readTool, clearReadHistory, hasFileBeenRead } from "../src/tools/builtin/read.js";
import { editTool } from "../src/tools/builtin/edit.js";
import { writeTool } from "../src/tools/builtin/write.js";

const TEST_DIR = join(tmpdir(), "coders-test-file-tools");
const TEST_FILE = join(TEST_DIR, "test.txt");
const TEST_CONTENT = "line 1\nline 2\nline 3\nline 4\nline 5\n";

const mockContext = {
  abortController: new AbortController(),
  getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
  setAppState: () => {},
  options: {} as any,
};

beforeEach(() => {
  clearReadHistory();
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(TEST_FILE, TEST_CONTENT, "utf-8");
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Read tool", () => {
  it("has correct name", () => expect(readTool.name).toBe("Read"));
  it("is read-only", () => expect(readTool.isReadOnly()).toBe(true));
  it("is concurrency-safe", () => expect(readTool.isConcurrencySafe()).toBe(true));

  it("reads a text file with line numbers", async () => {
    const result = await readTool.call({ file_path: TEST_FILE }, mockContext);
    expect(result.data.content).toContain("1\tline 1");
    expect(result.data.content).toContain("5\tline 5");
    expect(result.data.totalLines).toBe(6); // 5 lines + trailing newline
    expect(result.data.linesRead).toBeLessThanOrEqual(2000);
  });

  it("tracks file as read", async () => {
    expect(hasFileBeenRead(TEST_FILE)).toBe(false);
    await readTool.call({ file_path: TEST_FILE }, mockContext);
    expect(hasFileBeenRead(TEST_FILE)).toBe(true);
  });

  it("supports offset and limit", async () => {
    const result = await readTool.call({ file_path: TEST_FILE, offset: 2, limit: 2 }, mockContext);
    expect(result.data.content).toContain("2\tline 2");
    expect(result.data.content).toContain("3\tline 3");
    expect(result.data.content).not.toContain("1\tline 1");
    expect(result.data.linesRead).toBe(2);
  });

  it("validates missing file", async () => {
    const result = await readTool.validateInput({ file_path: "/nonexistent/file.txt" });
    expect(result.result).toBe(false);
  });

  it("validates directory", async () => {
    const result = await readTool.validateInput({ file_path: TEST_DIR });
    expect(result.result).toBe(false);
    expect(result.message).toContain("directory");
  });
});

describe("Edit tool", () => {
  it("has correct name", () => expect(editTool.name).toBe("Edit"));
  it("is not read-only", () => expect(editTool.isReadOnly()).toBe(false));

  it("requires file to be read first", async () => {
    const result = await editTool.validateInput({
      file_path: TEST_FILE, old_string: "line 1", new_string: "LINE ONE",
    });
    expect(result.result).toBe(false);
    expect(result.message).toContain("Read");
  });

  it("replaces text in file", async () => {
    // Read first
    await readTool.call({ file_path: TEST_FILE }, mockContext);

    // Edit
    const result = await editTool.call(
      { file_path: TEST_FILE, old_string: "line 2", new_string: "LINE TWO" },
      mockContext,
    );
    expect(result.data.replacements).toBe(1);

    // Verify
    const readResult = await readTool.call({ file_path: TEST_FILE }, mockContext);
    expect(readResult.data.content).toContain("LINE TWO");
    expect(readResult.data.content).not.toContain("\tline 2");
  });

  it("validates non-unique old_string", async () => {
    // Create file with duplicate text
    writeFileSync(TEST_FILE, "hello\nhello\nhello\n");
    await readTool.call({ file_path: TEST_FILE }, mockContext);

    const result = await editTool.validateInput({
      file_path: TEST_FILE, old_string: "hello", new_string: "world",
    });
    expect(result.result).toBe(false);
    expect(result.message).toContain("3 times");
  });

  it("replace_all replaces all occurrences", async () => {
    writeFileSync(TEST_FILE, "hello\nhello\nhello\n");
    await readTool.call({ file_path: TEST_FILE }, mockContext);

    const result = await editTool.call(
      { file_path: TEST_FILE, old_string: "hello", new_string: "world", replace_all: true },
      mockContext,
    );
    expect(result.data.replacements).toBe(3);
  });

  it("validates old_string equals new_string", async () => {
    const result = await editTool.validateInput({
      file_path: TEST_FILE, old_string: "same", new_string: "same",
    });
    expect(result.result).toBe(false);
  });
});

describe("Write tool", () => {
  it("has correct name", () => expect(writeTool.name).toBe("Write"));
  it("is not read-only", () => expect(writeTool.isReadOnly()).toBe(false));

  it("creates new file", async () => {
    const newFile = join(TEST_DIR, "new.txt");
    const result = await writeTool.call(
      { file_path: newFile, content: "new content" },
      mockContext,
    );
    expect(result.data.created).toBe(true);
    expect(existsSync(newFile)).toBe(true);
  });

  it("creates parent directories", async () => {
    const deepFile = join(TEST_DIR, "deep", "nested", "file.txt");
    await writeTool.call({ file_path: deepFile, content: "deep" }, mockContext);
    expect(existsSync(deepFile)).toBe(true);
  });

  it("requires read before overwrite", async () => {
    const result = await writeTool.validateInput({ file_path: TEST_FILE, content: "new" });
    expect(result.result).toBe(false);
    expect(result.message).toContain("Read it first");
  });

  it("allows overwrite after read", async () => {
    await readTool.call({ file_path: TEST_FILE }, mockContext);
    const result = await writeTool.validateInput({ file_path: TEST_FILE, content: "new" });
    expect(result.result).toBe(true);
  });
});
