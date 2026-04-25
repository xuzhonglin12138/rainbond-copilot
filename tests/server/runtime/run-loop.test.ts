// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRunExecutionState } from "../../../src/server/runtime/run-execution-state";
import { advanceRunLoop } from "../../../src/server/runtime/run-loop";

describe("advanceRunLoop", () => {
  it("returns interruption when a tool call requires approval and resumes the same loop later", async () => {
    const state = createRunExecutionState({
      runId: "run_1",
      sessionId: "cs_1",
      tenantId: "t_1",
      initialMessage: "start app then snapshot",
    });

    const interrupted = await advanceRunLoop({
      state,
      llmResponses: [
        {
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "rainbond_operate_app",
                arguments: "{\"action\":\"start\"}",
              },
            },
          ],
          finish_reason: "tool_calls",
        },
      ],
    });

    expect(interrupted.nextStep.type).toBe("interruption");
    expect(interrupted.pendingApprovals[0].toolCallId).toBe("call_1");
    expect(interrupted.messages.at(-1)).toMatchObject({
      role: "assistant",
      tool_calls: [
        expect.objectContaining({
          id: "call_1",
        }),
      ],
    });

    interrupted.nextStep = { type: "run_again" };
    interrupted.status = "running";
    interrupted.pendingApprovals = [];
    interrupted.messages.push({
      role: "tool",
      content: "{\"ok\":true}",
      name: "rainbond_operate_app",
      tool_call_id: "call_1",
    });

    const resumed = await advanceRunLoop({
      state: interrupted,
      llmResponses: [
        {
          content: "done",
          finish_reason: "stop",
        },
      ],
    });

    expect(resumed.nextStep.type).toBe("final_output");
    expect(resumed.finalOutput).toBe("done");
  });
});
