// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSseBroker } from "../../../src/server/events/sse-broker";
import { createEventRecord } from "../../../src/server/stores/event-store";

describe("SSE broker", () => {
  it("replays only events after the requested sequence", async () => {
    const broker = createSseBroker();

    await broker.publish(
      createEventRecord({
        tenantId: "t_123",
        sessionId: "cs_123",
        runId: "run_1",
        sequence: 1,
        eventType: "run.status",
        payload: { status: "thinking" },
      })
    );
    await broker.publish(
      createEventRecord({
        tenantId: "t_123",
        sessionId: "cs_123",
        runId: "run_1",
        sequence: 2,
        eventType: "chat.message",
        payload: { role: "assistant", content: "done" },
      })
    );

    const events = await broker.replay("run_1", "t_123", { afterSequence: 1 });

    expect(events).toHaveLength(1);
    expect(events[0].sequence).toBe(2);
    expect(events[0].eventType).toBe("chat.message");
  });
});
