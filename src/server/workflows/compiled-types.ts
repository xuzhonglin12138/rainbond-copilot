export type CompiledSkillMode = "embedded" | "workspace";

export type CompiledMachineBlockKind =
  | "workflow"
  | "tool_policy"
  | "output_contract";

export interface CompiledWorkflowBranch {
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  when?: string;
}

export interface CompiledWorkflowStage {
  id: string;
  kind: string;
  tool?: string;
  args?: Record<string, unknown>;
  branches?: CompiledWorkflowBranch[];
}

export interface CompiledWorkflowInputSchema {
  required?: string[];
  properties?: Record<string, Record<string, unknown>>;
}

export interface CompiledWorkflowDefinition {
  id: string;
  entry?: {
    intents?: string[];
  };
  input_schema?: CompiledWorkflowInputSchema;
  required_context?: string[];
  stages: CompiledWorkflowStage[];
}

export interface CompiledSkill {
  id: string;
  name: string;
  description: string;
  mode: CompiledSkillMode;
  sourcePath: string;
  workflow: CompiledWorkflowDefinition;
  toolPolicy?: Record<string, unknown>;
  outputContract?: Record<string, unknown>;
}

export interface CompileReport {
  generatedAt: string;
  compiled: Array<{
    id: string;
    sourcePath: string;
    stageCount: number;
  }>;
  skipped: Array<{
    sourcePath: string;
    reason: string;
  }>;
  errors: Array<{
    sourcePath: string;
    error: string;
  }>;
}
