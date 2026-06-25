import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync(tsxBin, ["src/cli/index.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe("coders storage CLI", () => {
  test("help advertises storage sync without legacy cloud command", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("storage");
    expect(result.stdout).not.toContain("cloud");
  });

  test("storage status reports local mode as JSON", () => {
    const home = mkdtempSync(join(tmpdir(), "open-coders-storage-cli-"));
    try {
      const result = runCli(["storage", "status", "--json"], {
        HOME: home,
        CODERS_DB_PATH: join(home, "coders.db"),
        HASNA_CODERS_DATABASE_URL: "",
        CODERS_DATABASE_URL: "",
        HASNA_CODERS_STORAGE_MODE: "",
        CODERS_STORAGE_MODE: "",
      });

      expect(result.status).toBe(0);
      const status = JSON.parse(result.stdout) as { configured: boolean; mode: string; activeEnv: string | null; service: string; tables: string[] };
      expect(status.configured).toBe(false);
      expect(status.mode).toBe("local");
      expect(status.activeEnv).toBe(null);
      expect(status.service).toBe("coders");
      expect(status.tables).toContain("sessions");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
