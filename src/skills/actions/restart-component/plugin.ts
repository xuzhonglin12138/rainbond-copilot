import { MockActionAdapter } from "../../../adapters/mock/mock-action-adapter.js";

export const name = "Restart Component";
export const description = "Restart a Rainbond component (potentially disruptive)";
export const risk = "high";
export const requiresApproval = true;
export const approvalPolicy = {
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
};

const adapter = new MockActionAdapter();

export async function execute(input: { name: string }) {
  return adapter.restartComponent(input);
}
