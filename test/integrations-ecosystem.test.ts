import { describe, it, expect } from "vitest";
import {
  getIntegration,
  getAllIntegrationStatuses,
  initializeAllIntegrations,
  callIntegration,
  countAvailableIntegrations,
} from "../src/integrations/ecosystem.js";

describe("Ecosystem integrations", () => {
  it("has 10 registered integrations", () => {
    const statuses = getAllIntegrationStatuses();
    expect(statuses.length).toBe(10);
  });

  it("all integrations have correct package names", () => {
    const statuses = getAllIntegrationStatuses();
    const names = statuses.map(s => s.name);
    expect(names).toContain("sessions");
    expect(names).toContain("skills");
    expect(names).toContain("configs");
    expect(names).toContain("prompts");
    expect(names).toContain("recordings");
    expect(names).toContain("sandboxes");
    expect(names).toContain("economy");
    expect(names).toContain("wallets");
    expect(names).toContain("brains");
    expect(names).toContain("attachments");
  });

  it("gets specific integration", () => {
    const sessions = getIntegration("sessions");
    expect(sessions).not.toBeNull();
    expect(sessions!.packageName).toBe("@hasna/sessions");
  });

  it("returns null for unknown integration", () => {
    expect(getIntegration("nonexistent")).toBeNull();
  });

  it("initializes all integrations", () => {
    const statuses = initializeAllIntegrations();
    expect(statuses.length).toBe(10);
    // In test env, none should be available (not installed)
    for (const s of statuses) {
      expect(typeof s.available).toBe("boolean");
    }
  });

  it("counts available integrations", () => {
    const { total, available } = countAvailableIntegrations();
    expect(total).toBe(10);
    expect(available).toBeGreaterThanOrEqual(0);
  });

  it("callIntegration handles missing integration", async () => {
    const result = await callIntegration("nonexistent", "method");
    expect(result).toEqual({ error: "Unknown integration: nonexistent" });
  });

  it("callIntegration handles unavailable package", async () => {
    const result = await callIntegration("sessions", "listSessions");
    const r = result as Record<string, unknown>;
    // Should return error since @hasna/sessions isn't installed in test
    expect(r.error || r.available === false).toBeTruthy();
  });
});
