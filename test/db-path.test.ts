import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Module from "module";
import { resetConfigDir } from "../src/config/paths.js";
import { closeDb, getDb, getDbFallbackPath } from "../src/db/index.js";

describe("database path overrides", () => {
  it("stores SQLite data under CODERS_DATA_DIR when set", () => {
    const previousDataDir = process.env.CODERS_DATA_DIR;
    const dataDir = mkdtempSync(join(tmpdir(), "coders-db-path-test-"));

    try {
      closeDb();
      process.env.CODERS_DATA_DIR = dataDir;
      resetConfigDir();
      getDb();
      closeDb();

      expect(existsSync(join(dataDir, "coders.db"))).toBe(true);
    } finally {
      closeDb();
      if (previousDataDir === undefined) delete process.env.CODERS_DATA_DIR;
      else process.env.CODERS_DATA_DIR = previousDataDir;
      resetConfigDir();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("stores JSON fallback data under CODERS_DATA_DIR when set", () => {
    const previousDataDir = process.env.CODERS_DATA_DIR;
    const dataDir = mkdtempSync(join(tmpdir(), "coders-db-fallback-path-test-"));

    try {
      closeDb();
      process.env.CODERS_DATA_DIR = dataDir;
      resetConfigDir();

      expect(getDbFallbackPath()).toBe(join(dataDir, "coders-fallback.json"));
    } finally {
      closeDb();
      if (previousDataDir === undefined) delete process.env.CODERS_DATA_DIR;
      else process.env.CODERS_DATA_DIR = previousDataDir;
      resetConfigDir();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("flushes JSON fallback data synchronously on close", () => {
    const previousDataDir = process.env.CODERS_DATA_DIR;
    const previousBunVersion = process.versions.bun;
    const originalLoad = (Module as any)._load;
    const dataDir = mkdtempSync(join(tmpdir(), "coders-db-fallback-close-test-"));

    try {
      closeDb();
      process.env.CODERS_DATA_DIR = dataDir;
      Object.defineProperty(process.versions, "bun", { value: undefined, configurable: true });
      (Module as any)._load = function load(request: string, ...rest: unknown[]) {
        if (request === "better-sqlite3" || request === "bun:sqlite") {
          throw new Error("forced sqlite unavailable");
        }
        return originalLoad.call(this, request, ...rest);
      };
      resetConfigDir();

      const db = getDb();
      db.prepare("INSERT INTO config (key, value) VALUES (?, ?)").run("fallback-close", "ok");
      closeDb();

      const fallbackPath = join(dataDir, "coders-fallback.json");
      expect(existsSync(fallbackPath)).toBe(true);
      expect(readFileSync(fallbackPath, "utf-8")).toContain("fallback-close");
    } finally {
      closeDb();
      (Module as any)._load = originalLoad;
      Object.defineProperty(process.versions, "bun", { value: previousBunVersion, configurable: true });
      if (previousDataDir === undefined) delete process.env.CODERS_DATA_DIR;
      else process.env.CODERS_DATA_DIR = previousDataDir;
      resetConfigDir();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
