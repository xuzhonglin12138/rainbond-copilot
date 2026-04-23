// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createApprovalRecord } from "../../../src/server/stores/approval-store";
import { createEventRecord } from "../../../src/server/stores/event-store";
import { createRunRecord } from "../../../src/server/stores/run-store";
import { createSessionRecord } from "../../../src/server/stores/session-store";

describe("server store contracts", () => {
  it("creates a tenant-scoped session record", () => {
    const session = createSessionRecord({
      sessionId: "cs_123",
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      authMode: "user_jwt",
      teamName: "team-a",
      contextSignature: "team-a|region-a|app-a|component-a|candidate",
    });

    expect(session.sessionId).toBe("cs_123");
    expect(session.tenantId).toBe("t_123");
    expect(session.userId).toBe("u_456");
    expect(session.username).toBe("alice");
    expect(session.authMode).toBe("user_jwt");
    expect(session.teamName).toBe("team-a");
    expect(session.contextSignature).toBe(
      "team-a|region-a|app-a|component-a|candidate"
    );
    expect(session.status).toBe("active");
  });

  it("creates a run and event record linked to the same tenant and session", () => {
    const run = createRunRecord({
      runId: "run_123",
      tenantId: "t_123",
      sessionId: "cs_123",
      messageText: "check frontend-ui",
    });
    const event = createEventRecord({
      tenantId: "t_123",
      sessionId: "cs_123",
      runId: "run_123",
      sequence: 1,
      eventType: "run.status",
      payload: { status: "thinking" },
    });

    expect(run.status).toBe("pending");
    expect(event.runId).toBe("run_123");
    expect(event.sequence).toBe(1);
    expect(event.payload).toEqual({ status: "thinking" });
  });

  it("creates an approval record with a pending status by default", () => {
    const approval = createApprovalRecord({
      approvalId: "ap_123",
      tenantId: "t_123",
      sessionId: "cs_123",
      runId: "run_123",
      skillId: "restart-component",
      description: "重启 frontend-ui",
      requestedBy: "u_456",
      risk: "high",
    });

    expect(approval.status).toBe("pending");
    expect(approval.requestedBy).toBe("u_456");
    expect(approval.resolvedBy).toBeUndefined();
  });
});
