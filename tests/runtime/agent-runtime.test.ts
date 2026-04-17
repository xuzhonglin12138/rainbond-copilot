import { AgentRuntime } from "../../src/runtime/agent-runtime";

it("runs in fallback mode without API key", async () => {
  // Clear API key to force fallback mode
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    // Create runtime AFTER clearing env var
    const runtime = new AgentRuntime();
    const events = await runtime.run("check frontend-ui status");

    // In fallback mode, should emit run.status and chat.message
    expect(events.some((event) => event.type === "run.status")).toBe(true);
    expect(events.some((event) => event.type === "chat.message")).toBe(true);

    // Should contain fallback mode message
    const messages = events.filter((e) => e.type === "chat.message");
    expect(messages.some((m: any) => m.content?.includes("降级模式"))).toBe(true);
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

it("emits tool trace events for low-risk operations", async () => {
  // Clear API key to force fallback mode
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    // Create runtime AFTER clearing env var
    const runtime = new AgentRuntime();
    const events = await runtime.run("check frontend-ui status");

    // Should execute get-component-status in fallback mode
    const traceEvents = events.filter((e) => e.type === "chat.trace");
    expect(traceEvents.length).toBeGreaterThan(0);
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
