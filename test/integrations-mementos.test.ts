import { describe, it, expect, beforeEach } from "vitest";
import { MementosIntegration, resetMementosIntegration } from "../src/integrations/mementos.js";

describe("MementosIntegration (fallback)", () => {
  let mem: MementosIntegration;

  beforeEach(() => {
    resetMementosIntegration();
    mem = new MementosIntegration();
  });

  it("uses fallback", () => expect(mem.isNativeAvailable()).toBe(false));

  it("registers project", async () => {
    const id = await mem.registerProject("test", "/tmp");
    expect(id).toBeTruthy();
  });

  it("registers agent", async () => {
    const id = await mem.registerAgent("maximus", "architect");
    expect(id).toBe("maximus");
  });

  it("saves and retrieves memory", async () => {
    await mem.save({ key: "db-convention", value: "Use snake_case for columns", importance: 8, tags: ["database"] });
    const result = await mem.get("db-convention");
    expect(result).not.toBeNull();
    expect(result!.value).toBe("Use snake_case for columns");
    expect(result!.importance).toBe(8);
    expect(result!.tags).toContain("database");
  });

  it("updates existing memory", async () => {
    await mem.save({ key: "test", value: "v1" });
    await mem.save({ key: "test", value: "v2" });
    const result = await mem.get("test");
    expect(result!.value).toBe("v2");
    expect(result!.version).toBe(2);
  });

  it("lists memories", async () => {
    await mem.save({ key: "a", value: "1", scope: "shared" });
    await mem.save({ key: "b", value: "2", scope: "global" });
    await mem.save({ key: "c", value: "3", scope: "shared" });

    const all = await mem.list();
    expect(all.length).toBe(3);

    const shared = await mem.list("shared");
    expect(shared.length).toBe(2);
  });

  it("searches by key and value", async () => {
    await mem.save({ key: "api-pattern", value: "Always use REST" });
    await mem.save({ key: "db-pattern", value: "Use PostgreSQL" });

    const results = await mem.search("api");
    expect(results.length).toBe(1);
    expect(results[0].key).toBe("api-pattern");
  });

  it("searches by tags", async () => {
    await mem.save({ key: "rule1", value: "test", tags: ["important", "architecture"] });
    await mem.save({ key: "rule2", value: "test", tags: ["minor"] });

    const results = await mem.search("architecture");
    expect(results.length).toBe(1);
  });

  it("forgets memory", async () => {
    await mem.save({ key: "to-forget", value: "temp" });
    expect(await mem.get("to-forget")).not.toBeNull();

    await mem.forget("to-forget");
    expect(await mem.get("to-forget")).toBeNull();
  });

  it("recalls sorted by importance", async () => {
    await mem.save({ key: "low", value: "low priority", importance: 2 });
    await mem.save({ key: "high", value: "high priority", importance: 9 });
    await mem.save({ key: "mid", value: "mid priority", importance: 5 });

    const results = await mem.recall("priority", 2);
    expect(results.length).toBe(2);
    expect(results[0].key).toBe("high");
    expect(results[1].key).toBe("mid");
  });

  it("returns null for unknown key", async () => {
    expect(await mem.get("nonexistent")).toBeNull();
  });
});
