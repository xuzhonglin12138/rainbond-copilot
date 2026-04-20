import * as getComponentLogs from "../../skills/actions/get-component-logs/plugin.js";
import * as getComponentStatus from "../../skills/actions/get-component-status/plugin.js";
import * as restartComponent from "../../skills/actions/restart-component/plugin.js";
import * as scaleComponentMemory from "../../skills/actions/scale-component-memory/plugin.js";
import type { ActionSkill } from "../../skills/types.js";

function createActionSkill(
  id: string,
  plugin: {
    name: string;
    description: string;
    risk?: "low" | "medium" | "high";
    requiresApproval?: boolean;
    approvalPolicy?: ActionSkill["approvalPolicy"];
    execute: (input: any) => Promise<any>;
  }
): ActionSkill {
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

export function createServerActionSkills(): Record<string, ActionSkill> {
  return {
    "get-component-status": createActionSkill(
      "get-component-status",
      getComponentStatus
    ),
    "get-component-logs": createActionSkill(
      "get-component-logs",
      getComponentLogs
    ),
    "restart-component": createActionSkill(
      "restart-component",
      restartComponent
    ),
    "scale-component-memory": createActionSkill(
      "scale-component-memory",
      scaleComponentMemory
    ),
  };
}
