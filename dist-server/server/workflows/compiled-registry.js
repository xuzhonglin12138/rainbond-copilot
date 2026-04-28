import { compiledRainbondSkills } from "../../generated/rainbond/compiled-skills.js";
export function listCompiledEmbeddedWorkflows() {
    return compiledRainbondSkills
        .filter((skill) => skill.mode === "embedded")
        .map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        mode: "embedded",
        stages: skill.workflow.stages.map((stage) => stage.id),
    }));
}
