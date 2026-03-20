import { describe, it, expect, beforeEach } from "vitest";
import {
  ConnectorsIntegration,
  resetConnectorsIntegration,
  getConnectorsIntegration,
} from "../src/integrations/connectors.js";

describe("ConnectorsIntegration (fallback mode)", () => {
  let connectors: ConnectorsIntegration;

  beforeEach(() => {
    resetConnectorsIntegration();
    connectors = new ConnectorsIntegration();
  });

  it("uses fallback when @hasna/connectors is not installed", () => {
    expect(connectors.isNativeAvailable()).toBe(false);
  });

  it("returns empty connectors list in fallback", async () => {
    const list = await connectors.getAvailableConnectors();
    expect(list).toEqual([]);
  });

  it("returns null for unknown connector", async () => {
    const c = await connectors.getConnector("github");
    expect(c).toBeNull();
  });

  it("executeConnector returns error in fallback", async () => {
    const result = await connectors.executeConnector("github", "list-repos", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("not available");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("installConnector returns false in fallback", async () => {
    const result = await connectors.installConnector("slack");
    expect(result).toBe(false);
  });

  it("asTools returns empty in fallback", async () => {
    const tools = await connectors.asTools();
    expect(tools).toEqual([]);
  });

  it("singleton works", () => {
    resetConnectorsIntegration();
    const a = getConnectorsIntegration();
    const b = getConnectorsIntegration();
    expect(a).toBe(b);
  });

  it("invalidateCache resets", async () => {
    // Should not throw
    connectors.invalidateCache();
    const list = await connectors.getAvailableConnectors();
    expect(list).toEqual([]);
  });
});
