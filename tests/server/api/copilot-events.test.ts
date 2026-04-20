// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCopilotController } from "../../../src/server/controllers/copilot-controller";

describe("copilot event stream", () => {
  it("returns replayable SSE events after a sequence", async () => {
    const controller = createCopilotController();
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "check frontend-ui", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "6" },
    });

    expect(stream.contentType).toBe("text/event-stream");
    expect(stream.events).toHaveLength(1);
    expect(stream.events[0].type).toBe("run.status");
    expect(stream.events[0].sequence).toBe(7);
  });

  it("executes low-risk diagnostic requests and emits trace plus final message", async () => {
    const controller = createCopilotController();
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "check frontend-ui status", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "chat.trace",
      "chat.trace",
      "chat.trace",
      "chat.trace",
      "chat.message",
      "run.status",
    ]);
    expect(stream.events.at(-1)).toMatchObject({
      type: "run.status",
      data: { status: "done" },
    });
  });

  it("emits an approval lifecycle for high-risk restart requests", async () => {
    const controller = createCopilotController();
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "restart frontend-ui", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);
    expect(stream.events.at(-1)).toMatchObject({
      type: "run.status",
      data: { status: "waiting_approval" },
    });
  });
});
