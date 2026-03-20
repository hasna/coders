import { describe, it, expect, vi } from "vitest";
import {
  ContextManager,
  estimateMessageTokens,
  estimateStringTokens,
} from "../src/core/context.js";
import type { Message } from "../src/api/client.js";

function makeMessages(count: number, charsEach = 400): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: "x".repeat(charsEach),
  }));
}

describe("ContextManager", () => {
  it("creates with correct window size", () => {
    const cm = new ContextManager({ model: "sonnet" });
    const state = cm.getState([]);
    expect(state.contextWindowSize).toBe(200_000);
    expect(state.estimatedTokens).toBe(0);
    expect(state.utilization).toBe(0);
    expect(state.needsCompaction).toBe(false);
  });

  it("uses 1M context for extended models", () => {
    const cm = new ContextManager({ model: "opus[1m]" });
    expect(cm.getState([]).contextWindowSize).toBe(1_000_000);
  });

  it("tracks token utilization", () => {
    const cm = new ContextManager({ model: "sonnet" });
    const msgs = makeMessages(10, 4000); // ~10 * 1000 tokens = 10K
    const state = cm.getState(msgs);
    expect(state.estimatedTokens).toBeGreaterThan(0);
    expect(state.utilization).toBeGreaterThan(0);
    expect(state.utilization).toBeLessThan(1);
  });

  it("triggers compaction at threshold", () => {
    const cm = new ContextManager({
      model: "sonnet",
      contextWindowOverride: 1000, // small window for testing
      compactionThreshold: 0.5,
    });
    // Create messages that exceed 50% of 1000 tokens
    const msgs = makeMessages(20, 400); // ~20 * 105 = 2100 tokens >> 500
    const state = cm.getState(msgs);
    expect(state.needsCompaction).toBe(true);
  });

  it("does not compact when below threshold", () => {
    const cm = new ContextManager({
      model: "sonnet",
      compactionThreshold: 0.99, // very high threshold
    });
    const msgs = makeMessages(5, 100);
    const state = cm.getState(msgs);
    expect(state.needsCompaction).toBe(false);
  });

  it("compacts messages preserving recent turns", () => {
    const cm = new ContextManager({
      model: "sonnet",
      preserveRecentTurns: 3, // keep last 6 messages (3 turns * 2)
    });
    const msgs = makeMessages(20, 200);
    const compacted = cm.compact(msgs);

    // Should have: 1 summary + 6 recent = 7
    expect(compacted.length).toBe(7);
    expect(compacted[0].content).toContain("Context Summary");
    // Last 6 should be the original last 6
    expect(compacted[compacted.length - 1]).toBe(msgs[msgs.length - 1]);
  });

  it("does not compact if too few messages", () => {
    const cm = new ContextManager({
      model: "sonnet",
      preserveRecentTurns: 10,
    });
    const msgs = makeMessages(5);
    const compacted = cm.compact(msgs);
    expect(compacted).toBe(msgs); // same reference = no compaction
  });

  it("maybeCompact only compacts when needed", () => {
    const cm = new ContextManager({
      model: "sonnet",
      contextWindowOverride: 100_000,
      preserveRecentTurns: 3,
    });
    const smallMsgs = makeMessages(4, 100);
    expect(cm.maybeCompact(smallMsgs)).toBe(smallMsgs); // no compaction
  });

  it("calls onCompaction callback", () => {
    const callback = vi.fn();
    const cm = new ContextManager({
      model: "sonnet",
      preserveRecentTurns: 2,
      onCompaction: callback,
    });
    const msgs = makeMessages(20, 200);
    cm.compact(msgs);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0].messagesRemoved).toBe(16); // 20 - 4 preserved
  });

  it("tracks compaction stats", () => {
    const cm = new ContextManager({ model: "sonnet", preserveRecentTurns: 2 });
    expect(cm.getStats().compactionCount).toBe(0);

    cm.compact(makeMessages(20, 200));
    expect(cm.getStats().compactionCount).toBe(1);
    expect(cm.getStats().tokensSavedByCompaction).toBeGreaterThan(0);

    cm.compact(makeMessages(20, 200));
    expect(cm.getStats().compactionCount).toBe(2);
  });

  it("setModel updates context window", () => {
    const cm = new ContextManager({ model: "sonnet" });
    expect(cm.getState([]).contextWindowSize).toBe(200_000);

    cm.setModel("opus[1m]");
    expect(cm.getState([]).contextWindowSize).toBe(1_000_000);
  });

  it("disables auto-compaction when configured", () => {
    const cm = new ContextManager({
      model: "sonnet",
      contextWindowOverride: 100,
      autoCompactEnabled: false,
    });
    const msgs = makeMessages(50, 400); // way over limit
    const state = cm.getState(msgs);
    expect(state.needsCompaction).toBe(false); // disabled
  });
});

describe("token estimation", () => {
  it("estimates string tokens", () => {
    expect(estimateStringTokens("hello")).toBe(2); // 5 chars / 4 = 1.25 -> ceil = 2
    expect(estimateStringTokens("")).toBe(0);
    expect(estimateStringTokens("a".repeat(400))).toBe(100);
  });

  it("estimates message tokens with overhead", () => {
    const msgs: Message[] = [{ role: "user", content: "a".repeat(400) }];
    const tokens = estimateMessageTokens(msgs);
    // 400 chars + 20 overhead = 420 chars / 4 = 105 tokens
    expect(tokens).toBe(105);
  });

  it("handles array content blocks", () => {
    const msgs: Message[] = [{
      role: "assistant",
      content: [
        { type: "text", text: "a".repeat(200) },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ] as any,
    }];
    const tokens = estimateMessageTokens(msgs);
    expect(tokens).toBeGreaterThan(50);
  });
});
