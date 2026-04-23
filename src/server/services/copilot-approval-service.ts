import type {
  ApprovalScope,
  RequestActor,
  ApprovalStatus,
  RiskLevel,
} from "../../shared/types.js";
import {
  getApprovalRiskLabel,
  getApprovalScopeLabel,
} from "../integrations/rainbond-mcp/mutable-tool-policy.js";
import { createServerId } from "../utils/id.js";
import { PersistedEventPublisher } from "../events/persisted-event-publisher.js";
import type { SseBroker } from "../events/sse-broker.js";
import {
  createApprovalRecord,
  type ApprovalRecord,
  type ApprovalStore,
} from "../stores/approval-store.js";
import type { RunStore } from "../stores/run-store.js";
import type { RunResumer } from "../runtime/run-resumer.js";

export interface CopilotApprovalServiceDeps {
  approvalStore: ApprovalStore;
  runStore: RunStore;
  eventPublisher: PersistedEventPublisher;
  broker: SseBroker;
  runResumer: RunResumer;
}

export interface CreatePendingApprovalInput {
  actor: RequestActor;
  sessionId: string;
  runId: string;
  skillId: string;
  description: string;
  risk: RiskLevel;
  scope?: ApprovalScope;
}

export interface ApprovalDecisionInput {
  actor: RequestActor;
  decision: Exclude<ApprovalStatus, "pending">;
  comment?: string;
}

export class CopilotApprovalService {
  constructor(private readonly deps: CopilotApprovalServiceDeps) {}

  async createPendingApproval(
    input: CreatePendingApprovalInput
  ): Promise<ApprovalRecord> {
    const run = await this.deps.runStore.getById(input.runId, input.actor.tenantId);

    if (!run) {
      throw new Error("Run not found");
    }

    const approval = createApprovalRecord({
      approvalId: createServerId("ap"),
      tenantId: input.actor.tenantId,
      sessionId: input.sessionId,
      runId: input.runId,
      skillId: input.skillId,
      description: input.description,
      risk: input.risk,
      scope: input.scope,
      requestedBy: input.actor.userId,
    });

    await this.deps.approvalStore.create(approval);
    await this.deps.runStore.update({
      ...run,
      status: "waiting_approval",
    });

    const requestedSequence = await this.nextSequence(input.runId, input.actor.tenantId);
    await this.deps.eventPublisher.publish({
      type: "approval.requested",
      tenantId: input.actor.tenantId,
      sessionId: input.sessionId,
      runId: input.runId,
      sequence: requestedSequence,
      data: {
        approval_id: approval.approvalId,
        skill_id: approval.skillId,
        description: approval.description,
        risk: approval.risk,
        level_label: getApprovalRiskLabel(approval.risk),
        scope: approval.scope,
        scope_label: getApprovalScopeLabel(approval.scope),
      },
    });

    const waitingSequence = await this.nextSequence(input.runId, input.actor.tenantId);
    await this.deps.eventPublisher.publish({
      type: "run.status",
      tenantId: input.actor.tenantId,
      sessionId: input.sessionId,
      runId: input.runId,
      sequence: waitingSequence,
      data: {
        status: "waiting_approval",
      },
    });

    return approval;
  }

  async decide(
    approvalId: string,
    input: ApprovalDecisionInput
  ): Promise<ApprovalRecord> {
    const approval = await this.deps.approvalStore.getById(
      approvalId,
      input.actor.tenantId
    );

    if (!approval) {
      throw new Error("Approval not found");
    }

    if (approval.requestedBy !== input.actor.userId) {
      throw new Error("Approval not found");
    }

    const run = await this.deps.runStore.getById(
      approval.runId,
      input.actor.tenantId
    );

    if (!run) {
      throw new Error("Run not found");
    }

    const updatedApproval: ApprovalRecord = {
      ...approval,
      status: input.decision,
      resolvedBy: input.actor.userId,
      resolvedAt: new Date().toISOString(),
      comment: input.comment,
    };
    await this.deps.approvalStore.update(updatedApproval);

    const approvalResolvedSequence = await this.nextSequence(
      approval.runId,
      input.actor.tenantId
    );
    await this.deps.eventPublisher.publish({
      type: "approval.resolved",
      tenantId: input.actor.tenantId,
      sessionId: approval.sessionId,
      runId: approval.runId,
      sequence: approvalResolvedSequence,
      data: {
        approval_id: approval.approvalId,
        status: updatedApproval.status,
        resolved_by: updatedApproval.resolvedBy,
        comment: updatedApproval.comment,
      },
    });

    if (input.decision === "approved") {
      await this.deps.runStore.update({
        ...run,
        status: "running",
      });
      await this.deps.runResumer.resume({
        tenantId: input.actor.tenantId,
        runId: approval.runId,
        approval: updatedApproval,
      });
    } else {
      await this.deps.runStore.update({
        ...run,
        status: "cancelled",
        finishedAt: new Date().toISOString(),
      });

      const cancelledSequence = await this.nextSequence(
        approval.runId,
        input.actor.tenantId
      );
      await this.deps.eventPublisher.publish({
        type: "run.status",
        tenantId: input.actor.tenantId,
        sessionId: approval.sessionId,
        runId: approval.runId,
        sequence: cancelledSequence,
        data: {
          status: "cancelled",
        },
      });
    }

    return updatedApproval;
  }

  private async nextSequence(runId: string, tenantId: string): Promise<number> {
    const events = await this.deps.broker.replay(runId, tenantId, {
      afterSequence: 0,
    });

    return events.length + 1;
  }
}
