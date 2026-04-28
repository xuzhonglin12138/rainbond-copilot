import type { ActionAdapter, ActionSkill } from "./skill-types.js";

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

function requireActionAdapter(adapter?: ActionAdapter): ActionAdapter {
  if (!adapter) {
    throw new Error("Action adapter is required for server runtime execution");
  }

  return adapter;
}

export function createServerActionSkills(
  adapter?: ActionAdapter
): Record<string, ActionSkill> {
  return {
    "get-component-status": createActionSkill(
      "get-component-status",
      {
        name: "Get Component Status",
        description: "Get the current status of a Rainbond component",
        risk: "low",
        requiresApproval: false,
        execute: (input: { name: string }) =>
          requireActionAdapter(adapter).getComponentStatus(input),
      }
    ),
    "get-component-logs": createActionSkill(
      "get-component-logs",
      {
        name: "Get Component Logs",
        description: "Retrieve recent logs from a Rainbond component",
        risk: "low",
        requiresApproval: false,
        approvalPolicy: {
          evaluate(input: { name: string; lines?: number }) {
            const lines = input.lines ?? 50;
            const isSensitiveComponent = /(^|[-_])(db|mysql|redis)([-_]|$)/i.test(
              input.name
            );

            if (lines >= 200 || isSensitiveComponent) {
              return {
                requiresApproval: true,
                risk: "medium" as const,
                reason: `查看 ${input.name} 的 ${lines} 行日志，可能暴露敏感运行细节或带来额外排查负载`,
              };
            }

            return {
              requiresApproval: false,
              risk: "low" as const,
              reason: `查看 ${input.name} 的最近日志`,
            };
          },
        },
        execute: (input: { name: string; lines?: number }) =>
          requireActionAdapter(adapter).getComponentLogs(input),
      }
    ),
    "restart-component": createActionSkill(
      "restart-component",
      {
        name: "Restart Component",
        description: "Restart a Rainbond component (potentially disruptive)",
        risk: "high",
        requiresApproval: true,
        approvalPolicy: {
          evaluate(input: { name: string }) {
            const isStatefulComponent = /(^|[-_])(db|mysql|redis)([-_]|$)/i.test(
              input.name
            );

            return {
              requiresApproval: true,
              risk: "high" as const,
              reason: isStatefulComponent
                ? `重启 ${input.name}，该组件可能承载有状态服务，存在短时不可用风险`
                : `重启 ${input.name}，会导致该组件短时中断`,
            };
          },
        },
        execute: (input: { name: string }) =>
          requireActionAdapter(adapter).restartComponent(input),
      }
    ),
    "scale-component-memory": createActionSkill(
      "scale-component-memory",
      {
        name: "Scale Component Resources",
        description: "Scale the CPU and memory allocation of a Rainbond component",
        risk: "medium",
        requiresApproval: true,
        approvalPolicy: {
          evaluate(input: { name: string; memory: number; cpu?: number }) {
            const isLargeScaleChange = input.memory >= 2048;
            const isStatefulComponent = /(^|[-_])(db|mysql|redis)([-_]|$)/i.test(
              input.name
            );
            const cpuPart =
              typeof input.cpu === "number" ? `，CPU 调整到 ${input.cpu}m` : "";

            return {
              requiresApproval: true,
              risk:
                isLargeScaleChange || isStatefulComponent
                  ? ("high" as const)
                  : ("medium" as const),
              reason:
                isLargeScaleChange || isStatefulComponent
                  ? `将 ${input.name} 的内存调整到 ${input.memory}MB${cpuPart}，属于高影响资源变更`
                  : `将 ${input.name} 的内存调整到 ${input.memory}MB${cpuPart}，需要确认资源变更影响`,
            };
          },
        },
        execute: (input: { name: string; memory: number; cpu?: number }) =>
          requireActionAdapter(adapter).scaleComponentMemory(input),
      }
    ),
  };
}
