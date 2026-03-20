import { describe, it, expect, beforeEach } from "vitest";
import {
  ConversationsIntegration,
  resetConversationsIntegration,
} from "../src/integrations/conversations.js";

describe("ConversationsIntegration (fallback mode)", () => {
  let convos: ConversationsIntegration;

  beforeEach(() => {
    resetConversationsIntegration();
    convos = new ConversationsIntegration({
      agentName: "maximus",
      sessionId: "test-session-001",
      projectId: "test-project",
    });
  });

  it("uses fallback when @hasna/conversations is not installed", () => {
    expect(convos.isNativeAvailable()).toBe(false);
  });

  it("registers agent", async () => {
    const agent = await convos.registerAgent("architect");
    expect(agent.name).toBe("maximus");
    expect(agent.role).toBe("architect");
    expect(agent.status).toBe("active");
  });

  it("sends and reads DMs", async () => {
    await convos.sendMessage("cassius", "Hello teammate!");
    await convos.sendMessage("cassius", "Second message");

    // Create another integration to read as cassius
    const cassius = new ConversationsIntegration({
      agentName: "cassius",
      sessionId: "test-session-002",
    });

    // In fallback mode, messages are per-instance, so cassius won't see maximus's messages
    // This tests the maximus side
    const maxMsgs = await convos.readMessages();
    // maximus sent TO cassius, so maximus's inbox is empty
    expect(maxMsgs.length).toBe(0);
  });

  it("sends message with priority", async () => {
    const msg = await convos.sendMessage("brutus", "Urgent!", "high");
    expect(msg.from).toBe("maximus");
    expect(msg.to).toBe("brutus");
    expect(msg.priority).toBe("high");
    expect(msg.content).toBe("Urgent!");
  });

  it("creates and joins spaces", async () => {
    const space = await convos.createSpace("open-coders-test", "Test space");
    expect(space.name).toBe("open-coders-test");
    expect(space.description).toBe("Test space");

    // Join is idempotent
    await convos.joinSpace("open-coders-test");
  });

  it("sends and reads space messages", async () => {
    await convos.createSpace("dev-chat");
    await convos.sendToSpace("dev-chat", "Started working on the API");
    await convos.sendToSpace("dev-chat", "API is done");

    const msgs = await convos.readSpaceMessages("dev-chat");
    expect(msgs.length).toBe(2);
    expect(msgs[0].content).toBe("Started working on the API");
    expect(msgs[1].content).toBe("API is done");
    expect(msgs[0].space).toBe("dev-chat");
  });

  it("limits space messages", async () => {
    await convos.createSpace("busy-chat");
    for (let i = 0; i < 30; i++) {
      await convos.sendToSpace("busy-chat", `Message ${i}`);
    }
    const msgs = await convos.readSpaceMessages("busy-chat", 5);
    expect(msgs.length).toBe(5);
    // Should be the last 5
    expect(msgs[0].content).toBe("Message 25");
  });

  it("lists agents", async () => {
    await convos.registerAgent("architect");
    const agents = await convos.listAgents();
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe("maximus");
  });

  it("handles heartbeat without error", () => {
    // Should not throw
    convos.startHeartbeat(60_000);
    convos.stopHeartbeat();
  });

  it("destroy cleans up", () => {
    convos.startHeartbeat(1000);
    convos.destroy();
    // No error means success
  });

  it("read unread only", async () => {
    // Send messages to self for testing
    const selfConvo = new ConversationsIntegration({
      agentName: "self",
      sessionId: "self-session",
    });
    // In fallback, send to self
    await selfConvo.sendMessage("self", "msg 1");
    await selfConvo.sendMessage("self", "msg 2");

    const unread = await selfConvo.readMessages({ unreadOnly: true });
    expect(unread.length).toBe(2);

    // Read again — should be empty (all marked as read)
    const unread2 = await selfConvo.readMessages({ unreadOnly: true });
    expect(unread2.length).toBe(0);

    // But all messages still there
    const all = await selfConvo.readMessages();
    expect(all.length).toBe(2);
  });
});
