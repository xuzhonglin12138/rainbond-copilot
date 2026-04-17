import { InProcessGateway } from "../../src/gateway/in-process-gateway";

it("runs the frontend-ui diagnosis flow in fallback mode", async () => {
  // Clear API key to force fallback mode
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const gateway = new InProcessGateway();

    // Step 1: User sends diagnosis request
    const events = await gateway.handleMessage("session-1", "check frontend-ui status");

    // Step 2: Expect run.status events
    const statusEvents = events.filter((e) => e.type === "run.status");
    expect(statusEvents.length).toBeGreaterThan(0);

    // Step 3: Expect tool trace events (in fallback mode)
    const traceEvents = events.filter((e) => e.type === "chat.trace");
    expect(traceEvents.length).toBeGreaterThan(0);

    // Step 4: Expect final message
    const messageEvents = events.filter((e) => e.type === "chat.message");
    expect(messageEvents.length).toBeGreaterThan(0);

    // Note: With API key configured, this test would show full LLM reasoning
    // and approval flow for high-risk operations
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
