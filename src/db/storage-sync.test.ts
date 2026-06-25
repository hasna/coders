import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getStorageDatabaseUrl, getStorageMode, resolveTables, STORAGE_TABLES } from "./storage-sync.js";

const envKeys = [
  "HASNA_CODERS_DATABASE_URL",
  "CODERS_DATABASE_URL",
  "HASNA_CODERS_STORAGE_MODE",
  "CODERS_STORAGE_MODE",
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  savedEnv.clear();
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("coders storage sync config", () => {
  test("canonical storage database env wins over fallback env", () => {
    process.env.HASNA_CODERS_DATABASE_URL = "postgres://new.example/coders";
    process.env.CODERS_DATABASE_URL = "postgres://fallback.example/coders";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/coders");
    expect(getStorageMode()).toBe("hybrid");
  });

  test("fallback storage database env is accepted", () => {
    process.env.CODERS_DATABASE_URL = "postgres://fallback.example/coders";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback.example/coders");
    expect(getStorageMode()).toBe("hybrid");
  });

  test("canonical storage mode wins over fallback mode", () => {
    process.env.HASNA_CODERS_STORAGE_MODE = "remote";
    process.env.CODERS_STORAGE_MODE = "hybrid";

    expect(getStorageMode()).toBe("remote");
  });

  test("resolves storage tables", () => {
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(resolveTables(["feedback"])).toEqual(["feedback"]);
    expect(() => resolveTables(["missing"])).toThrow("Unknown coders sync table");
  });

  test("exports storage helpers from the storage subpath source", async () => {
    const storage = await import("../storage.js");

    expect(storage.STORAGE_TABLES).toEqual(STORAGE_TABLES);
    expect(storage.getStorageDatabaseUrl()).toBeNull();
    expect(storage.getStorageMode()).toBe("local");
    expect(storage.PG_MIGRATIONS.length).toBeGreaterThan(0);
    expect(typeof storage.PgAdapterAsync).toBe("function");
  });
});
