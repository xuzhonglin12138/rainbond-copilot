import * as getComponentLogs from "../../skills/actions/get-component-logs/plugin";
import * as getComponentStatus from "../../skills/actions/get-component-status/plugin";
import * as restartComponent from "../../skills/actions/restart-component/plugin";
import * as scaleComponentMemory from "../../skills/actions/scale-component-memory/plugin";
function createActionSkill(id, plugin) {
    return {
        id,
        name: plugin.name,
        kind: "action",
        description: plugin.description,
        risk: plugin.risk || "low",
        requiresApproval: plugin.requiresApproval || false,
        approvalPolicy: plugin.approvalPolicy,
        execute: plugin.execute,
    };
}
export function createServerActionSkills() {
    return {
        "get-component-status": createActionSkill("get-component-status", getComponentStatus),
        "get-component-logs": createActionSkill("get-component-logs", getComponentLogs),
        "restart-component": createActionSkill("restart-component", restartComponent),
        "scale-component-memory": createActionSkill("scale-component-memory", scaleComponentMemory),
    };
}
