import type { ApprovalRequest } from "../shared/types";

export class ApprovalManager {
  private approvals = new Map<string, ApprovalRequest>();

  createApproval(
    runId: string,
    skillId: string,
    description: string,
    risk: "low" | "medium" | "high"
  ): ApprovalRequest {
    const approvalId = `approval-${Date.now()}`;
    const approval: ApprovalRequest = {
      approvalId,
      runId,
      skillId,
      description,
      risk,
      status: "pending",
    };
    this.approvals.set(approvalId, approval);
    return approval;
  }

  approve(approvalId: string): void {
    const approval = this.approvals.get(approvalId);
    if (approval) {
      approval.status = "approved";
    }
  }

  reject(approvalId: string): void {
    const approval = this.approvals.get(approvalId);
    if (approval) {
      approval.status = "rejected";
    }
  }

  getApproval(approvalId: string): ApprovalRequest | undefined {
    return this.approvals.get(approvalId);
  }
}
