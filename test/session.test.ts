import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createSession,
  saveSession,
  loadSession,
  updateSession,
  addMessage,
  createFingerprint,
  setCurrentSessionId,
  getCurrentSessionId,
} from "../src/core/session.js";

const TEST_DIR = join(tmpdir(), "coders-test-sessions");

describe("session management", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates a session with unique ID", () => {
    const s1 = createSession("/tmp/project-a");
    const s2 = createSession("/tmp/project-b");
    expect(s1.id).toBeTruthy();
    expect(s2.id).toBeTruthy();
    expect(s1.id).not.toBe(s2.id);
  });

  it("creates session with correct metadata", () => {
    const session = createSession("/tmp/project", { model: "opus" });
    expect(session.projectDir).toBe("/tmp/project");
    expect(session.appVersion).toBeTruthy();
    expect(session.metadata.model).toBe("opus");
    expect(session.metadata.completedTurns).toBe(0);
    expect(session.messages).toEqual([]);
  });

  it("has device ID", () => {
    const session = createSession("/tmp");
    expect(session.deviceId).toBeTruthy();
    expect(session.deviceId.length).toBeGreaterThan(10);
  });

  it("device ID is consistent across sessions", () => {
    const s1 = createSession("/tmp/a");
    const s2 = createSession("/tmp/b");
    expect(s1.deviceId).toBe(s2.deviceId);
  });

  it("saves and loads a session", () => {
    const session = createSession("/tmp/project");
    addMessage(session.id, "user", "Hello");
    saveSession(session);

    const loaded = loadSession(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.projectDir).toBe("/tmp/project");
    expect(loaded!.messages).toHaveLength(1);
    expect(loaded!.messages[0].content).toBe("Hello");
  });

  it("returns null for nonexistent session", () => {
    expect(loadSession("nonexistent-id")).toBeNull();
  });

  it("updates session metadata", () => {
    const session = createSession("/tmp/project");
    expect(session.metadata.completedTurns).toBe(0);

    addMessage(session.id, "user", "Hi");
    updateSession(session, [{ role: "user", content: "Hi" }], { model: "sonnet" });
    expect(session.metadata.completedTurns).toBe(1);
    expect(session.metadata.model).toBe("sonnet");

    // Verify persisted
    const loaded = loadSession(session.id);
    expect(loaded!.messages).toHaveLength(1);
  });

  it("tracks current session ID", () => {
    expect(getCurrentSessionId()).toBeNull();
    setCurrentSessionId("test-123");
    expect(getCurrentSessionId()).toBe("test-123");
    setCurrentSessionId("test-456");
    expect(getCurrentSessionId()).toBe("test-456");
  });
});

describe("environment fingerprint", () => {
  it("creates a fingerprint with all required fields", () => {
    const fp = createFingerprint();
    expect(fp.platform).toBeTruthy();
    expect(fp.arch).toBeTruthy();
    expect(fp.nodeVersion).toMatch(/^v\d+/);
    expect(fp.shell).toBeTruthy();
    expect(fp.hostname).toBeTruthy();
    expect(typeof fp.isCi).toBe("boolean");
    expect(typeof fp.isWsl).toBe("boolean");
    expect(typeof fp.isRemote).toBe("boolean");
    expect(Array.isArray(fp.packageManagers)).toBe(true);
    expect(Array.isArray(fp.runtimes)).toBe(true);
    expect(fp.runtimes).toContain("node");
    expect(fp.vcs).toBeTruthy();
  });

  it("detects platform correctly", () => {
    const fp = createFingerprint();
    expect(["darwin", "linux", "win32"]).toContain(fp.platform);
  });
});
