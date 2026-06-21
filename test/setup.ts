import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const isVitest = Boolean(process.env.VITEST || process.env.VITEST_WORKER_ID);
const testHooks = isVitest ? await import("vitest") : await import("bun:test");
const beforeEachHook = testHooks.beforeEach;
const afterAllHook = testHooks.afterAll;

const testRoot = mkdtempSync(join(tmpdir(), "coders-bun-test-"));
let testIndex = 0;

function patchStdinForInk(): void {
  const stdin = process.stdin as NodeJS.ReadStream & {
    ref?: () => NodeJS.ReadStream;
    unref?: () => NodeJS.ReadStream;
    setRawMode?: (mode: boolean) => NodeJS.ReadStream;
  };
  try {
    Object.defineProperty(stdin, "isTTY", { value: true, configurable: true });
  } catch { /* best effort for non-configurable streams */ }
  stdin.ref ??= () => stdin;
  stdin.unref ??= () => stdin;
  stdin.setRawMode ??= () => stdin;
}

beforeEachHook(async () => {
  patchStdinForInk();

  const testDir = join(testRoot, `case-${testIndex++}`);
  process.env.CODERS_CONFIG_DIR = join(testDir, "config");
  process.env.CODERS_DATA_DIR = join(testDir, "data");

  const [{ closeDb }, { resetConfigDir }, { clearReadHistory }, session] = await Promise.all([
    import("../src/db/index.js"),
    import("../src/config/paths.js"),
    import("../src/tools/builtin/read.js"),
    import("../src/core/session.js"),
  ]);

  closeDb();
  resetConfigDir();
  clearReadHistory();
  session.resetSessionStateForTests?.();
});

afterAllHook(() => {
  rmSync(testRoot, { recursive: true, force: true });
});
