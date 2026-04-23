export type ActionSkillRisk = "low" | "medium" | "high";

export interface ApprovalPolicyDecision {
  requiresApproval: boolean;
  risk?: ActionSkillRisk;
  reason: string;
}

export interface ApprovalPolicy {
  evaluate: (input: any) => ApprovalPolicyDecision;
}

export interface ActionSkill {
  id: string;
  name: string;
  kind: "action";
  description: string;
  risk?: ActionSkillRisk;
  requiresApproval?: boolean;
  execute: (input: unknown) => Promise<unknown>;
  approvalPolicy?: ApprovalPolicy;
}

export interface ActionAdapter {
  getComponentStatus(input: { name: string }): Promise<{
    name: string;
    status: string;
    memory: number;
  }>;

  getComponentLogs(input: { name: string; lines?: number }): Promise<{
    name: string;
    logs: string[];
  }>;

  restartComponent(input: { name: string }): Promise<{
    name: string;
    status: string;
  }>;

  scaleComponentMemory(input: { name: string; memory: number }): Promise<{
    name: string;
    memory: number;
  }>;
}
