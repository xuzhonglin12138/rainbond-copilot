export type SessionId = string;
export type RunId = string;
export type ApprovalId = string;
export type RiskLevel = "low" | "medium" | "high";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface RequestActor {
  tenantId: string;
  userId: string;
  username: string;
  sourceSystem: string;
  roles: string[];
  displayName?: string;
  tenantName?: string;
}

export interface Session {
  sessionId: SessionId;
  transcriptIds: string[];
  pendingApprovals: ApprovalId[];
  openTasks: string[];
}

export interface ApprovalRequest {
  approvalId: ApprovalId;
  runId: RunId;
  skillId: string;
  description: string;
  risk: RiskLevel;
  status: ApprovalStatus;
}
