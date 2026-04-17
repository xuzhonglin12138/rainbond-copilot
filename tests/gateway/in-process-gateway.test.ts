import { InProcessGateway } from "../../src/gateway/in-process-gateway";

it("normalizes runtime tool.call events into drawer trace events", async () => {
  // Clear API key to force fallback mode
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const gateway = new InProcessGateway();
    const drawerEvents = await gateway.handleMessage("session-1", "check frontend-ui");

    expect(drawerEvents.some((event) => event.type === "chat.trace")).toBe(true);
  } finally {
    // Restore API key
    if (originalOpenAIKey) {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
    if (originalAnthropicKey) {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
  }
});

it("surfaces active memory recall on repeated troubleshooting", async () => {
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const gateway = new InProcessGateway();
    await gateway.handleMessage("session-2", "check frontend-ui status");
    const drawerEvents = await gateway.handleMessage(
      "session-2",
      "check frontend-ui status again"
    );

    expect(
      drawerEvents.some((event) => event.type === "memory.recalled")
    ).toBe(true);
  } finally {
    if (originalOpenAIKey) {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
    if (originalAnthropicKey) {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
  }
});
