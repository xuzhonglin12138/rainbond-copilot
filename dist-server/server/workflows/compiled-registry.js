import { getRegisteredSkills } from "../skills/skill-registry.js";
export function listCompiledEmbeddedWorkflows() {
    return getRegisteredSkills()
        .filter((skill) => skill.mode === "embedded")
        .map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        mode: "embedded",
        stages: skill.workflow.stages.map((stage) => stage.id),
    }));
}
