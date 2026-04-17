import { MockActionAdapter } from "../../../adapters/mock/mock-action-adapter";

export const name = "Get Component Logs";
export const description = "Retrieve recent logs from a Rainbond component";
export const risk = "low";
export const requiresApproval = false;
export const approvalPolicy = {
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
};

const adapter = new MockActionAdapter();

export async function execute(input: { name: string; lines?: number }) {
  return adapter.getComponentLogs(input);
}
