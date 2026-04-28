import { getRegisteredSkills } from "../skills/skill-registry.js";
import type { WorkflowDefinition } from "./registry.js";

export function listCompiledEmbeddedWorkflows(): WorkflowDefinition[] {
  return getRegisteredSkills()
    .filter((skill) => skill.mode === "embedded")
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      mode: "embedded" as const,
      stages: skill.workflow.stages.map((stage) => stage.id),
    }));
}
