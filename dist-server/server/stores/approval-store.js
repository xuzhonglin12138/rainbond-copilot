export function createApprovalRecord(input) {
    return {
        approvalId: input.approvalId,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        runId: input.runId,
        skillId: input.skillId,
        description: input.description,
        risk: input.risk,
        scope: input.scope,
        status: input.status ?? "pending",
        requestedBy: input.requestedBy,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
        resolvedBy: input.resolvedBy,
        resolvedAt: input.resolvedAt,
        comment: input.comment,
    };
}
export class InMemoryApprovalStore {
    constructor() {
        this.approvals = new Map();
    }
    async create(approval) {
        this.approvals.set(this.key(approval.approvalId, approval.tenantId), approval);
    }
    async getById(approvalId, tenantId) {
        return this.approvals.get(this.key(approvalId, tenantId)) ?? null;
    }
    async update(approval) {
        this.approvals.set(this.key(approval.approvalId, approval.tenantId), approval);
    }
    async listPendingBySession(sessionId, tenantId) {
        return Array.from(this.approvals.values()).filter((approval) => approval.sessionId === sessionId &&
            approval.tenantId === tenantId &&
            approval.status === "pending");
    }
    key(approvalId, tenantId) {
        return `${tenantId}:${approvalId}`;
    }
}
export function createInMemoryApprovalStore() {
    return new InMemoryApprovalStore();
}
