// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
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

  it("uses llm-generated assistant content for general chat when an llm client is provided", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "你好！我是 Rainbond Copilot，我可以帮你检查组件状态、查看日志和处理审批操作。",
        finish_reason: "stop",
      })),
    };
    const controller = createCopilotController({
      llmClient,
    });
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
      body: { message: "你好", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(llmClient.chat).toHaveBeenCalled();
    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "chat.message",
      "run.status",
    ]);
    expect(stream.events[1].data).toMatchObject({
      role: "assistant",
      content: "你好！我是 Rainbond Copilot，我可以帮你检查组件状态、查看日志和处理审批操作。",
    });
  });

  it("supports llm tool-calling for low-risk diagnosis", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_1",
              type: "function",
              function: {
                name: "get-component-status",
                arguments: JSON.stringify({ name: "backend-api" }),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "backend-api 当前运行正常，没有发现明显异常。",
          finish_reason: "stop",
        }),
    };
    const controller = createCopilotController({
      llmClient,
    });
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
      body: { message: "请帮我检查 backend-api 状态", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(llmClient.chat).toHaveBeenCalledTimes(2);
    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "chat.trace",
      "chat.trace",
      "chat.message",
      "run.status",
    ]);
    expect(stream.events[3].data).toMatchObject({
      role: "assistant",
      content: "backend-api 当前运行正常，没有发现明显异常。",
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
