import { compiledRainbondSkills } from "../../generated/rainbond/compiled-skills.js";
import type { WorkflowDefinition } from "./registry.js";

export function listCompiledEmbeddedWorkflows(): WorkflowDefinition[] {
  return compiledRainbondSkills
    .filter((skill) => skill.mode === "embedded")
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      mode: "embedded" as const,
      stages: skill.workflow.stages.map((stage) => stage.id),
    }));
}
