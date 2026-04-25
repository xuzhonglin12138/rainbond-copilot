// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCopilotController } from "../../../src/server/controllers/copilot-controller";
import { PersistedEventPublisher } from "../../../src/server/events/persisted-event-publisher";
import { createSseBroker } from "../../../src/server/events/sse-broker";
import { InMemoryRunResumer } from "../../../src/server/runtime/run-resumer";
import { CopilotApprovalService } from "../../../src/server/services/copilot-approval-service";
import { createInMemoryApprovalStore } from "../../../src/server/stores/approval-store";
import { createInMemoryRunStore, createRunRecord } from "../../../src/server/stores/run-store";
import {
  createInMemorySessionStore,
  createSessionRecord,
} from "../../../src/server/stores/session-store";

describe("copilot approval flow", () => {
  it("approves a pending approval and resumes the waiting run", async () => {
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };
    const sessionStore = createInMemorySessionStore();
    const runStore = createInMemoryRunStore();
    const approvalStore = createInMemoryApprovalStore();
    const broker = createSseBroker();
    const eventPublisher = new PersistedEventPublisher(broker);
    const runResumer = new InMemoryRunResumer();
    const approvalService = new CopilotApprovalService({
      approvalStore,
      runStore,
      sessionStore,
      eventPublisher,
      broker,
      runResumer,
    });
    const controller = createCopilotController({
      sessionStore,
      runStore,
      approvalStore,
      broker,
      runResumer,
    });

    await sessionStore.create(
      createSessionRecord({
        sessionId: "cs_123",
        tenantId: actor.tenantId,
        userId: actor.userId,
        sourceSystem: actor.sourceSystem,
      })
    );
    await runStore.create(
      createRunRecord({
        runId: "run_123",
        tenantId: actor.tenantId,
        sessionId: "cs_123",
        messageText: "restart frontend-ui",
        status: "pending",
      })
    );

    runResumer.register(actor.tenantId, "run_123", async ({ runId }) => {
      const currentRun = await runStore.getById(runId, actor.tenantId);
      if (!currentRun) {
        throw new Error("Run not found");
      }

      await runStore.update({
        ...currentRun,
        status: "completed",
        finishedAt: "2026-04-20T12:00:00.000Z",
      });

      await eventPublisher.publish({
        type: "run.status",
        tenantId: actor.tenantId,
        sessionId: currentRun.sessionId,
        runId,
        sequence: 4,
        timestamp: "2026-04-20T12:00:00.000Z",
        data: { status: "done" },
      });
    });

    const approval = await approvalService.createPendingApproval({
      actor,
      sessionId: "cs_123",
      runId: "run_123",
      skillId: "restart-component",
      description: "重启 frontend-ui 会导致短暂中断",
      risk: "high",
    });

    const pendingRun = await runStore.getById("run_123", actor.tenantId);
    expect(pendingRun?.status).toBe("waiting_approval");

    const decision = await controller.decideApproval({
      actor,
      params: { approvalId: approval.approvalId },
      body: { decision: "approved", comment: "确认执行" },
    });

    expect(decision.data.status).toBe("approved");
    expect(decision.data.resolved_by.user_id).toBe(actor.userId);

    const resumedRun = await runStore.getById("run_123", actor.tenantId);
    expect(resumedRun?.status).toBe("completed");

    const stream = await controller.streamRunEvents({
      actor,
      params: { sessionId: "cs_123", runId: "run_123" },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "approval.requested",
      "run.status",
      "approval.resolved",
      "run.status",
    ]);
  });

  it("rejects a pending approval and cancels the run without resuming", async () => {
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };
    const sessionStore = createInMemorySessionStore();
    const runStore = createInMemoryRunStore();
    const approvalStore = createInMemoryApprovalStore();
    const broker = createSseBroker();
    const eventPublisher = new PersistedEventPublisher(broker);
    const runResumer = new InMemoryRunResumer();
    const approvalService = new CopilotApprovalService({
      approvalStore,
      runStore,
      sessionStore,
      eventPublisher,
      broker,
      runResumer,
    });
    const controller = createCopilotController({
      sessionStore,
      runStore,
      approvalStore,
      broker,
      runResumer,
    });

    await sessionStore.create(
      createSessionRecord({
        sessionId: "cs_456",
        tenantId: actor.tenantId,
        userId: actor.userId,
        sourceSystem: actor.sourceSystem,
      })
    );
    await runStore.create(
      createRunRecord({
        runId: "run_456",
        tenantId: actor.tenantId,
        sessionId: "cs_456",
        messageText: "restart frontend-ui",
        status: "pending",
      })
    );

    const approval = await approvalService.createPendingApproval({
      actor,
      sessionId: "cs_456",
      runId: "run_456",
      skillId: "restart-component",
      description: "重启 frontend-ui 会导致短暂中断",
      risk: "high",
    });

    const decision = await controller.decideApproval({
      actor,
      params: { approvalId: approval.approvalId },
      body: { decision: "rejected", comment: "当前高峰期不允许重启" },
    });

    expect(decision.data.status).toBe("rejected");

    const rejectedRun = await runStore.getById("run_456", actor.tenantId);
    expect(rejectedRun?.status).toBe("cancelled");

    const stream = await controller.streamRunEvents({
      actor,
      params: { sessionId: "cs_456", runId: "run_456" },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "approval.requested",
      "run.status",
      "approval.resolved",
      "run.status",
    ]);
    expect(stream.events.at(-1)).toMatchObject({
      type: "run.status",
      data: { status: "cancelled" },
    });
  });

  it("rejects approval decisions from another user in the same tenant", async () => {
    const owner = {
      tenantId: "t_123",
      userId: "u_owner",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };
    const otherUser = {
      tenantId: "t_123",
      userId: "u_other",
      username: "bob",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };
    const sessionStore = createInMemorySessionStore();
    const runStore = createInMemoryRunStore();
    const approvalStore = createInMemoryApprovalStore();
    const broker = createSseBroker();
    const eventPublisher = new PersistedEventPublisher(broker);
    const runResumer = new InMemoryRunResumer();
    const approvalService = new CopilotApprovalService({
      approvalStore,
      runStore,
      sessionStore,
      eventPublisher,
      broker,
      runResumer,
    });
    const controller = createCopilotController({
      sessionStore,
      runStore,
      approvalStore,
      broker,
      runResumer,
    });

    await sessionStore.create(
      createSessionRecord({
        sessionId: "cs_789",
        tenantId: owner.tenantId,
        userId: owner.userId,
        sourceSystem: owner.sourceSystem,
      })
    );
    await runStore.create(
      createRunRecord({
        runId: "run_789",
        tenantId: owner.tenantId,
        sessionId: "cs_789",
        messageText: "restart frontend-ui",
        status: "pending",
      })
    );

    const approval = await approvalService.createPendingApproval({
      actor: owner,
      sessionId: "cs_789",
      runId: "run_789",
      skillId: "restart-component",
      description: "重启 frontend-ui 会导致短暂中断",
      risk: "high",
    });

    await expect(
      controller.decideApproval({
        actor: otherUser,
        params: { approvalId: approval.approvalId },
        body: { decision: "approved", comment: "越权审批" },
      })
    ).rejects.toThrow("Approval not found");
  });

  it("derives enterprise scope metadata when re-queuing a pending enterprise action for approval", async () => {
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };
    const sessionStore = createInMemorySessionStore();
    const runStore = createInMemoryRunStore();
    const approvalStore = createInMemoryApprovalStore();
    const broker = createSseBroker();
    const runResumer = new InMemoryRunResumer();
    const controller = createCopilotController({
      sessionStore,
      runStore,
      approvalStore,
      broker,
      runResumer,
    });

    await sessionStore.create(
      createSessionRecord({
        sessionId: "cs_scope",
        tenantId: actor.tenantId,
        userId: actor.userId,
        sourceSystem: actor.sourceSystem,
        pendingWorkflowAction: {
          toolName: "rainbond_delete_region",
          requiresApproval: true,
          risk: "high",
          description: "删除集群 test-region，该操作可能不可逆",
          arguments: {
            region_name: "test-region",
          },
        },
      })
    );

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: "cs_scope" },
      body: { message: "继续执行", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: { sessionId: "cs_scope", runId: run.data.run_id },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);
    expect(stream.events[1]).toMatchObject({
      type: "approval.requested",
      data: {
        description: "删除集群 test-region，该操作可能不可逆",
        risk: "high",
        level_label: "危险",
        scope: "enterprise",
        scope_label: "企业级",
      },
    });
  });
});
