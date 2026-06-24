import { describe, it, expect } from "vitest";
import {
  TOOL_JSON_SCHEMAS,
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

  it("advertises compact-output expansion parameters to the model", () => {
    expect(TOOL_JSON_SCHEMAS.TaskList.properties).toMatchObject({
      limit: expect.any(Object),
      offset: expect.any(Object),
      verbose: expect.any(Object),
      status: expect.any(Object),
    });
    expect(TOOL_JSON_SCHEMAS.TaskOutput.properties).toMatchObject({ limit: expect.any(Object) });
    expect(TOOL_JSON_SCHEMAS.ListMcpResourcesTool.properties).toMatchObject({
      limit: expect.any(Object),
      offset: expect.any(Object),
      verbose: expect.any(Object),
    });
    expect(TOOL_JSON_SCHEMAS.ReadMcpResourceTool.properties).toMatchObject({
      limit: expect.any(Object),
      offset: expect.any(Object),
    });
  });
});
