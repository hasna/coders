import { describe, it, expect } from "vitest";
import { globTool } from "../src/tools/builtin/glob.js";
import { grepTool } from "../src/tools/builtin/grep.js";

describe("Glob tool", () => {
  it("has correct name", () => expect(globTool.name).toBe("Glob"));
  it("is read-only", () => expect(globTool.isReadOnly()).toBe(true));
  it("is concurrency-safe", () => expect(globTool.isConcurrencySafe()).toBe(true));

  it("validates empty pattern", async () => {
    const r = await globTool.validateInput({ pattern: "" });
    expect(r.result).toBe(false);
  });

  it("finds TypeScript files in this project", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await globTool.call({ pattern: "src/**/*.ts" }, ctx);
    expect(result.data.files.length).toBeGreaterThan(0);
    expect(result.data.files.some(f => f.endsWith(".ts"))).toBe(true);
  });

  it("finds files in specific directory", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await globTool.call({ pattern: "*.ts", path: "src/cli" }, ctx);
    expect(result.data.files.length).toBeGreaterThan(0);
  });

  it("returns empty for non-matching pattern", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await globTool.call({ pattern: "**/*.nonexistent_extension_xyz" }, ctx);
    expect(result.data.files.length).toBe(0);
  });

  it("maps result to API format", () => {
    const block = globTool.mapToolResultToToolResultBlockParam(
      { files: ["/a/b.ts", "/c/d.ts"], totalMatches: 2, truncated: false },
      "tool-1",
    );
    expect(block.content).toContain("/a/b.ts");
    expect(block.content).toContain("/c/d.ts");
  });

  it("maps empty result", () => {
    const block = globTool.mapToolResultToToolResultBlockParam(
      { files: [], totalMatches: 0, truncated: false },
      "tool-2",
    );
    expect(block.content).toContain("No files found");
  });
});

describe("Grep tool", () => {
  it("has correct name", () => expect(grepTool.name).toBe("Grep"));
  it("is read-only", () => expect(grepTool.isReadOnly()).toBe(true));
  it("is concurrency-safe", () => expect(grepTool.isConcurrencySafe()).toBe(true));

  it("validates empty pattern", async () => {
    const r = await grepTool.validateInput({ pattern: "" });
    expect(r.result).toBe(false);
  });

  it("searches for a known string in this project", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    const result = await grepTool.call({ pattern: "BASH_TOOL", path: "src/" }, ctx);
    expect(result.data.matchCount).toBeGreaterThan(0);
  });

  it("returns no matches for nonexistent pattern", async () => {
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: "default" as const, allowRules: [], denyRules: [] }, verbose: false }),
      setAppState: () => {},
      options: {} as any,
    };
    // Search in a single known file to avoid matching the test file itself
    const result = await grepTool.call({ pattern: "xyzzy_will_never_match_99", path: "src/cli/index.ts" }, ctx);
    expect(result.data.matchCount).toBe(0);
  });

  it("maps result to API format", () => {
    const block = grepTool.mapToolResultToToolResultBlockParam(
      { content: "src/foo.ts:10:hello", matchCount: 1, fileCount: 1, truncated: false },
      "tool-3",
    );
    expect(block.content).toContain("src/foo.ts");
  });
});
