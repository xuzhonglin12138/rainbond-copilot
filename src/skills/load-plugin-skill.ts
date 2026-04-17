import { join } from "node:path";
import type { ActionSkill } from "./types";

export async function loadPluginSkill(skillDir: string): Promise<ActionSkill> {
  const pluginPath = join(skillDir, "plugin.ts");
  const module = await import(pluginPath);

  const idMatch = skillDir.match(/([^/]+)$/);
  const id = idMatch ? idMatch[1] : "unknown";

  return {
    id,
    name: module.name || id,
    kind: "action",
    description: module.description || "",
    risk: module.risk || "low",
    requiresApproval: module.requiresApproval ?? false,
    execute: module.execute,
  };
}
