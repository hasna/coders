import { describe, it, expect, beforeEach } from "vitest";
import {
  startSpeculation, stopSpeculation, getSpeculationState,
  canSpeculateOnTool, getSpeculationTimeSavedMs,
} from "../src/core/speculation.js";
import {
  classifyToolUse, isAutoModeEnabled, setAutoModeEnabled,
  isCircuitBroken, setCircuitBroken, getClassifierConfig,
} from "../src/core/classifier.js";
import { createTeam, getTeam, addTeamMember, listTeams } from "../src/core/team.js";
import {
  registerHook, clearHooks, getHooksForEvent, getRegisteredHookCount,
} from "../src/hooks/registry.js";
import { emitEvent, getEventCount, clearEvents, isTelemetryEnabled } from "../src/telemetry/events.js";
import { detectDeploymentEnvironment } from "../src/utils/env.js";
import { detectGitRepo, parseGitRemote, isAtGitRoot } from "../src/git/repo.js";
import { getInstructionsContent, getGlobalInstructions, clearInstructionsCache } from "../src/memory/files.js";
import { isBridgeEnabled } from "../src/remote/bridge.js";

describe("Speculation engine", () => {
  beforeEach(() => stopSpeculation());

  it("starts inactive", () => {
    expect(getSpeculationState().active).toBe(false);
  });

  it("starts and stops speculation", () => {
    startSpeculation();
    expect(getSpeculationState().active).toBe(true);
    expect(getSpeculationState().overlayDir).toBeTruthy();

    stopSpeculation();
    expect(getSpeculationState().active).toBe(false);
  });

  it("allows read-only tools for speculation", () => {
    const ctx = { mode: "default" as const, allowRules: [], denyRules: [] };
    expect(canSpeculateOnTool("Read", ctx)).toBe(true);
    expect(canSpeculateOnTool("Glob", ctx)).toBe(true);
    expect(canSpeculateOnTool("Grep", ctx)).toBe(true);
    expect(canSpeculateOnTool("Bash", ctx)).toBe(false);
  });

  it("allows write tools only in permissive modes", () => {
    expect(canSpeculateOnTool("Edit", { mode: "default" as any, allowRules: [], denyRules: [] })).toBe(false);
    expect(canSpeculateOnTool("Edit", { mode: "acceptEdits" as any, allowRules: [], denyRules: [] })).toBe(true);
    expect(canSpeculateOnTool("Edit", { mode: "bypassPermissions" as any, allowRules: [], denyRules: [] })).toBe(true);
  });
});

describe("Auto-mode classifier", () => {
  it("starts disabled", () => expect(isAutoModeEnabled()).toBe(false));

  it("toggles enabled state", () => {
    setAutoModeEnabled(true);
    expect(isAutoModeEnabled()).toBe(true);
    setAutoModeEnabled(false);
  });

  it("allows read-only tools by default", () => {
    const result = classifyToolUse("Read", {});
    expect(result.behavior).toBe("allow");
  });

  it("asks for unknown tools", () => {
    const result = classifyToolUse("CustomTool", {});
    expect(result.behavior).toBe("ask");
  });

  it("denies dangerous bash patterns", () => {
    const result = classifyToolUse("Bash", { command: "sudo rm -rf /" });
    expect(result.behavior).toBe("deny");
  });

  it("circuit breaker forces ask", () => {
    setCircuitBroken(true);
    const result = classifyToolUse("Read", {});
    expect(result.behavior).toBe("ask");
    setCircuitBroken(false);
  });

  it("has default config with rules", () => {
    const config = getClassifierConfig();
    expect(config.allowRules.length).toBeGreaterThan(0);
    expect(config.denyRules.length).toBeGreaterThan(0);
  });
});

describe("Team coordination", () => {
  it("creates a team", () => {
    const team = createTeam("test-team", "Test team");
    expect(team.name).toBe("test-team");
    expect(team.members).toEqual([]);
    expect(team.taskListId).toBe("test-team");
  });

  it("retrieves a team", () => {
    createTeam("retrieve-test");
    const team = getTeam("retrieve-test");
    expect(team).not.toBeNull();
    expect(team!.name).toBe("retrieve-test");
  });

  it("adds team members", () => {
    createTeam("member-test");
    addTeamMember("member-test", { name: "maximus", role: "architect", status: "active" });
    addTeamMember("member-test", { name: "cassius", role: "developer", status: "idle" });
    const team = getTeam("member-test");
    expect(team!.members.length).toBe(2);
  });
});

describe("Hook system", () => {
  beforeEach(() => clearHooks());

  it("starts with no hooks", () => {
    expect(getRegisteredHookCount()).toBe(0);
  });

  it("registers hooks", () => {
    registerHook({ event: "SessionStart", commands: [{ type: "command", command: "echo start" }], source: "settings" });
    expect(getRegisteredHookCount()).toBe(1);
  });

  it("gets hooks for event", () => {
    registerHook({ event: "PreToolUse", commands: [{ type: "command", command: "echo pre" }], source: "settings" });
    registerHook({ event: "PostToolUse", commands: [{ type: "command", command: "echo post" }], source: "settings" });
    expect(getHooksForEvent("PreToolUse").length).toBe(1);
    expect(getHooksForEvent("PostToolUse").length).toBe(1);
    expect(getHooksForEvent("SessionStart").length).toBe(0);
  });
});

describe("Telemetry", () => {
  beforeEach(() => clearEvents());

  it("is enabled by default", () => expect(isTelemetryEnabled()).toBe(true));

  it("emits events", () => {
    emitEvent("test_event", { key: "value" });
    expect(getEventCount()).toBe(1);
  });

  it("clears events", () => {
    emitEvent("a"); emitEvent("b");
    expect(getEventCount()).toBe(2);
    clearEvents();
    expect(getEventCount()).toBe(0);
  });
});

describe("Environment detection", () => {
  it("detects deployment environment", () => {
    const env = detectDeploymentEnvironment();
    expect(typeof env).toBe("string");
    // In local dev, should be "local" or "ci"
    expect(["local", "ci", "github-actions"]).toContain(env);
  });
});

describe("Git integration", () => {
  it("detects git repo in this project", () => {
    // open-coders may or may not be a git repo
    const repo = detectGitRepo();
    // Just verify it doesn't crash
    expect(repo === null || typeof repo.root === "string").toBe(true);
  });

  it("parses SSH remote URLs", () => {
    const result = parseGitRemote("git@github.com:hasnaxyz/open-coders.git");
    expect(result).toEqual({ owner: "hasnaxyz", name: "open-coders" });
  });

  it("parses HTTPS remote URLs", () => {
    const result = parseGitRemote("https://github.com/hasnaxyz/open-coders.git");
    expect(result).toEqual({ owner: "hasnaxyz", name: "open-coders" });
  });

  it("returns null for invalid URLs", () => {
    expect(parseGitRemote("not-a-url")).toBeNull();
  });
});

describe("Memory/instructions files", () => {
  beforeEach(() => clearInstructionsCache());

  it("reads CODERS.md from this project", () => {
    const content = getInstructionsContent(process.cwd());
    // We created CODERS.md in the scaffold task
    expect(content).not.toBeNull();
    expect(content).toContain("@hasna/coders");
  });

  it("returns null for nonexistent project", () => {
    expect(getInstructionsContent("/tmp/nonexistent-project-xyz")).toBeNull();
  });
});

describe("Remote bridge", () => {
  it("bridge is disabled by default", () => {
    expect(isBridgeEnabled()).toBe(false);
  });
});
