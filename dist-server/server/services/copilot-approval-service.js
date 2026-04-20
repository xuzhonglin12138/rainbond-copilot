import { createApprovalRecord, } from "../stores/approval-store";
export class CopilotApprovalService {
    constructor(deps) {
        this.deps = deps;
    }
    async createPendingApproval(input) {
        const run = await this.deps.runStore.getById(input.runId, input.actor.tenantId);
        if (!run) {
            throw new Error("Run not found");
        }
        const approval = createApprovalRecord({
            approvalId: `ap_${Date.now()}`,
            tenantId: input.actor.tenantId,
            sessionId: input.sessionId,
            runId: input.runId,
            skillId: input.skillId,
            description: input.description,
            risk: input.risk,
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
    async decide(approvalId, input) {
        const approval = await this.deps.approvalStore.getById(approvalId, input.actor.tenantId);
        if (!approval) {
            throw new Error("Approval not found");
        }
        const run = await this.deps.runStore.getById(approval.runId, input.actor.tenantId);
        if (!run) {
            throw new Error("Run not found");
        }
        const updatedApproval = {
            ...approval,
            status: input.decision,
            resolvedBy: input.actor.userId,
            resolvedAt: new Date().toISOString(),
            comment: input.comment,
        };
        await this.deps.approvalStore.update(updatedApproval);
        const approvalResolvedSequence = await this.nextSequence(approval.runId, input.actor.tenantId);
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
        }
        else {
            await this.deps.runStore.update({
                ...run,
                status: "cancelled",
                finishedAt: new Date().toISOString(),
            });
            const cancelledSequence = await this.nextSequence(approval.runId, input.actor.tenantId);
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
    async nextSequence(runId, tenantId) {
        const events = await this.deps.broker.replay(runId, tenantId, {
            afterSequence: 0,
        });
        return events.length + 1;
    }
}
