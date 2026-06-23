import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { fileURLToPath } from "url";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

const cliBin = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const cliBundle = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));
const mcpBin = fileURLToPath(new URL("../dist/coders-mcp.js", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, COREPACK_ENABLE_AUTO_PIN: "0" },
    stdio: "pipe",
    timeout: 20_000,
  }).trim();
}

function hasCommand(command: string): boolean {
  try {
    execFileSync(command, ["--version"], { cwd: repoRoot, stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

describe("packaged CLI bin", () => {
  beforeAll(() => {
    run("npm", ["run", "build"]);
  });

  it("emits an executable Node bin wrapper", () => {
    expect(existsSync(cliBin)).toBe(true);
    expect(existsSync(mcpBin)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(cliBin).mode & 0o111).not.toBe(0);
      expect(statSync(mcpBin).mode & 0o111).not.toBe(0);
    }
    expect(readFileSync(cliBin, "utf-8")).toContain("#!/usr/bin/env node");
    expect(readFileSync(mcpBin, "utf-8")).toContain("#!/usr/bin/env node");
  });

  it("runs help through the Node bundle without dynamic require failures", () => {
    const helpFromBundle = run("node", [cliBundle, "--help"]);
    const helpFromBin = run("node", [cliBin, "--help"]);

    expect(helpFromBundle).toContain("Usage: coders");
    expect(helpFromBin).toContain("Usage: coders");
  });

  it("reports the package version from the generated bin", () => {
    const version =
      process.platform === "win32"
        ? run("node", [cliBin, "--version"])
        : run(cliBin, ["--version"]);
    expect(version).toBe(`${packageJson.version} (Coders)`);
  });

  it("reports the package version under Bun when Bun is available", () => {
    if (!hasCommand("bun")) return;

    const version = run("bun", [cliBin, "--version"]);
    expect(version).toBe(`${packageJson.version} (Coders)`);
  });

  it("starts the MCP bin under Node without dynamic require failures", () => {
    const result = spawnSync("node", [mcpBin, "--http", "--port", "0"], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, COREPACK_ENABLE_AUTO_PIN: "0" },
      stdio: "pipe",
      timeout: 1_000,
    });

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(output).not.toContain("Dynamic require");
    expect(output).not.toContain("Usage: coders");
    expect(result.error && "code" in result.error ? result.error.code : undefined).toBe("ETIMEDOUT");
  });
});
