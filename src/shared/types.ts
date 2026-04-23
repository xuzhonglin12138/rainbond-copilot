export type SessionId = string;
export type RunId = string;
export type ApprovalId = string;
export type RiskLevel = "low" | "medium" | "high";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type AuthMode = "user_jwt" | "internal" | "trusted_headers";

export interface RequestActor {
  tenantId: string;
  userId: string;
  username: string;
  sourceSystem: string;
  roles: string[];
  authMode?: AuthMode;
  authorization?: string;
  cookie?: string;
  regionName?: string;
  displayName?: string;
  tenantName?: string;
  enterpriseId?: string;
}
