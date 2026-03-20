import { describe, it, expect, beforeEach } from "vitest";
import {
  getSettings,
  resetConfigCache,
  createDefaultPermissionContext,
  checkToolPermission,
  enterPlanMode,
  exitPlanMode,
} from "../src/config/index.js";

describe("config system", () => {
  beforeEach(() => {
    resetConfigCache();
  });

  it("returns merged settings with defaults", () => {
    const settings = getSettings();
    // model may be set from ~/.claude/settings.json (compat mode) or null from defaults
    expect(typeof settings.model === "string" || settings.model === null).toBe(true);
    expect(typeof settings.verbose === "boolean" || settings.verbose === undefined).toBe(true);
    expect(settings.autoCompactEnabled).toBe(true);
  });

  it("creates default permission context", () => {
    const ctx = createDefaultPermissionContext();
    expect(ctx.mode).toBe("default");
    expect(ctx.allowRules).toEqual([]);
    expect(ctx.denyRules).toEqual([]);
  });

  it("allows Read tool in default mode via passthrough", () => {
    const ctx = createDefaultPermissionContext();
    const result = checkToolPermission("Read", { file_path: "/tmp/test" }, ctx);
    expect(result.behavior).toBe("passthrough");
  });

  it("allows everything in bypass mode", () => {
    const ctx = { ...createDefaultPermissionContext(), mode: "bypassPermissions" as const };
    const result = checkToolPermission("Bash", { command: "rm -rf /" }, ctx);
    expect(result.behavior).toBe("allow");
  });

  it("denies by explicit deny rule", () => {
    const ctx = createDefaultPermissionContext();
    ctx.denyRules = [{ toolName: "Bash", behavior: "deny" }];
    const result = checkToolPermission("Bash", { command: "ls" }, ctx);
    expect(result.behavior).toBe("deny");
  });

  it("allows by explicit allow rule", () => {
    const ctx = createDefaultPermissionContext();
    ctx.allowRules = [{ toolName: "Bash", command: "ls", behavior: "allow" }];
    const result = checkToolPermission("Bash", { command: "ls -la" }, ctx);
    expect(result.behavior).toBe("allow");
  });

  it("enters and exits plan mode correctly", () => {
    const ctx = createDefaultPermissionContext();
    expect(ctx.mode).toBe("default");

    const planCtx = enterPlanMode(ctx);
    expect(planCtx.mode).toBe("plan");
    expect(planCtx.prePlanMode).toBe("default");

    const restored = exitPlanMode(planCtx);
    expect(restored.mode).toBe("default");
    expect(restored.prePlanMode).toBeUndefined();
  });

  it("auto-allows file edits in acceptEdits mode", () => {
    const ctx = { ...createDefaultPermissionContext(), mode: "acceptEdits" as const };
    const editResult = checkToolPermission("Edit", { file_path: "/tmp/test" }, ctx);
    expect(editResult.behavior).toBe("allow");

    const writeResult = checkToolPermission("Write", { file_path: "/tmp/test" }, ctx);
    expect(writeResult.behavior).toBe("allow");
  });
});
