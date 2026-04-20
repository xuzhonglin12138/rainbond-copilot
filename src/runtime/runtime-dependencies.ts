import { SkillRegistry } from "../skills/registry";
import type { RequestActor } from "../shared/types";
import type { EnhancedRuntimeConfig } from "./enhanced-agent-runtime";

export interface CreateServerRuntimeConfigInput {
  sessionId: string;
  actor: RequestActor;
  workspaceDir?: string;
}

export function createServerRuntimeConfig(
  input: CreateServerRuntimeConfigInput
): EnhancedRuntimeConfig {
  return {
    sessionId: input.sessionId,
    workspaceDir: input.workspaceDir ?? `.workspace/${input.sessionId}`,
    actor: input.actor,
    enableWorkspace: false,
    enableMemory: false,
    enableGoals: true,
    enableReflection: true,
    enableSubAgents: true,
    skillRegistry: new SkillRegistry("src/skills"),
    llmClient: null,
  };
}
