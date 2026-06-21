import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

describe("CLI entrypoint", () => {
  it("can be imported for metadata without bootstrapping the interactive CLI", async () => {
    const mod = await import("../src/cli/index.js");

    expect(mod.PACKAGE_NAME).toBe("@hasna/coders");
    expect(mod.VERSION).toBe(packageJson.version);
    expect(typeof mod.bootstrap).toBe("function");
  });
});
