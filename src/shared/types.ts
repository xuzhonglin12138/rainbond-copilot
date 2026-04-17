export type SessionId = string;
export type RunId = string;
export type ApprovalId = string;

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
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected";
}
