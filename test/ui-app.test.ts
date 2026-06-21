import { describe, it, expect } from "vitest";
import {
  isPermissionHandlerReadOnly,
  launchInkApp,
  runHeadless,
} from "../src/ui/app.js";

describe("UI App", () => {
  it("exports launch and headless entrypoints", () => {
    expect(typeof launchInkApp).toBe("function");
    expect(typeof runHeadless).toBe("function");
  });

  it("checks read-only permission handlers by boolean or method shape", () => {
    expect(isPermissionHandlerReadOnly({ isReadOnly: true })).toBe(true);
    expect(isPermissionHandlerReadOnly({ isReadOnly: false })).toBe(false);
    expect(isPermissionHandlerReadOnly({ isReadOnly: () => true })).toBe(true);
    expect(isPermissionHandlerReadOnly({ isReadOnly: () => false })).toBe(false);
  });
});
