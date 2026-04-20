import type { ApprovalStatus, RiskLevel } from "../../shared/types.js";

export interface ApprovalRecord {
  approvalId: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  skillId: string;
  description: string;
  risk: RiskLevel;
  status: ApprovalStatus;
  requestedBy: string;
  requestedAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  comment?: string;
}

export interface CreateApprovalRecordInput {
  approvalId: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  skillId: string;
  description: string;
  risk: RiskLevel;
  requestedBy: string;
  status?: ApprovalStatus;
  requestedAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  comment?: string;
}

export interface ApprovalStore {
  create(approval: ApprovalRecord): Promise<void>;
  getById(approvalId: string, tenantId: string): Promise<ApprovalRecord | null>;
  update(approval: ApprovalRecord): Promise<void>;
  listPendingBySession(
    sessionId: string,
    tenantId: string
  ): Promise<ApprovalRecord[]>;
}

export function createApprovalRecord(
  input: CreateApprovalRecordInput
): ApprovalRecord {
  return {
    approvalId: input.approvalId,
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    runId: input.runId,
    skillId: input.skillId,
    description: input.description,
    risk: input.risk,
    status: input.status ?? "pending",
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
    resolvedBy: input.resolvedBy,
    resolvedAt: input.resolvedAt,
    comment: input.comment,
  };
}

export class InMemoryApprovalStore implements ApprovalStore {
  private approvals = new Map<string, ApprovalRecord>();

  async create(approval: ApprovalRecord): Promise<void> {
    this.approvals.set(this.key(approval.approvalId, approval.tenantId), approval);
  }

  async getById(
    approvalId: string,
    tenantId: string
  ): Promise<ApprovalRecord | null> {
    return this.approvals.get(this.key(approvalId, tenantId)) ?? null;
  }

  async update(approval: ApprovalRecord): Promise<void> {
    this.approvals.set(this.key(approval.approvalId, approval.tenantId), approval);
  }

  async listPendingBySession(
    sessionId: string,
    tenantId: string
  ): Promise<ApprovalRecord[]> {
    return Array.from(this.approvals.values()).filter(
      (approval) =>
        approval.sessionId === sessionId &&
        approval.tenantId === tenantId &&
        approval.status === "pending"
    );
  }

  private key(approvalId: string, tenantId: string): string {
    return `${tenantId}:${approvalId}`;
  }
}

export function createInMemoryApprovalStore(): ApprovalStore {
  return new InMemoryApprovalStore();
}
