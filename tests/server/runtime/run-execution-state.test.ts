// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRunExecutionState } from "../../../src/server/runtime/run-execution-state";

describe("createRunExecutionState", () => {
  it("stores run-scoped next step, approvals, and continuation messages", () => {
    const state = createRunExecutionState({
      runId: "run_1",
      sessionId: "cs_1",
      tenantId: "t_1",
      initialMessage: "start app and then snapshot",
    });

    state.nextStep = { type: "run_again" };
    state.pendingApprovals = [
      {
        toolName: "rainbond_operate_app",
        toolCallId: "call_1",
        risk: "high",
        arguments: { action: "start" },
      },
    ];

    expect(state.messages).toEqual([
      {
        role: "user",
        content: "start app and then snapshot",
      },
    ]);
    expect(state.iteration).toBe(0);
    expect(state.status).toBe("running");
    expect(state.completedToolCallIds).toEqual([]);
    expect(state.pendingApprovals[0].toolCallId).toBe("call_1");
    expect(state.nextStep.type).toBe("run_again");
  });
});
