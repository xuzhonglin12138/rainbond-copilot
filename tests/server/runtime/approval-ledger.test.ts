// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createApprovalLedger } from "../../../src/server/runtime/approval-ledger";
import { createSessionRecord } from "../../../src/server/stores/session-store";

describe("createApprovalLedger", () => {
  it("tracks approval by tool call id and allows partial progress", () => {
    const ledger = createApprovalLedger();

    ledger.request({
      toolName: "rainbond_operate_app",
      toolCallId: "call_start",
      risk: "high",
    });
    ledger.request({
      toolName: "rainbond_manage_component_envs",
      toolCallId: "call_env",
      risk: "medium",
    });

    ledger.approve("rainbond_operate_app", "call_start");

    expect(ledger.getDecision("rainbond_operate_app", "call_start")).toBe(
      "approved"
    );
    expect(
      ledger.getDecision("rainbond_manage_component_envs", "call_env")
    ).toBe("pending");
  });

  it("uses the first pending approval as a session compatibility view", () => {
    const ledger = createApprovalLedger();

    ledger.request({
      toolName: "rainbond_operate_app",
      toolCallId: "call_start",
      risk: "high",
      arguments: { action: "start" },
    });
    ledger.request({
      toolName: "rainbond_manage_component_envs",
      toolCallId: "call_env",
      risk: "medium",
      arguments: { attr_name: "DEBUG" },
    });

    ledger.approve("rainbond_operate_app", "call_start");

    const session = createSessionRecord({
      sessionId: "cs_1",
      tenantId: "t_1",
      userId: "u_1",
      sourceSystem: "ops-console",
      approvalLedger: ledger.toJSON(),
    });

    expect(session.pendingWorkflowAction).toMatchObject({
      toolName: "rainbond_manage_component_envs",
      toolCallId: "call_env",
      requiresApproval: true,
      arguments: { attr_name: "DEBUG" },
    });
  });
});
