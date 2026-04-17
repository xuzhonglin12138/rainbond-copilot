export type SkillDescriptor = {
  id: string;
  name: string;
  kind: "prompt" | "action";
  description: string;
  risk?: "low" | "medium" | "high";
  requiresApproval?: boolean;
};

export interface ApprovalPolicyDecision {
  requiresApproval: boolean;
  risk?: "low" | "medium" | "high";
  reason: string;
}

export interface ApprovalPolicy {
  evaluate: (input: any) => ApprovalPolicyDecision;
}

export type PromptSkill = SkillDescriptor & {
  kind: "prompt";
  content: string;
};

export type ActionSkill = SkillDescriptor & {
  kind: "action";
  execute: (input: unknown) => Promise<unknown>;
  approvalPolicy?: ApprovalPolicy;
};

export type Skill = PromptSkill | ActionSkill;

// Adapter interface for Phase 2 integration
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
