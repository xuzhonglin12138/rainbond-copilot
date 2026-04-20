import { MockActionAdapter } from "../../../adapters/mock/mock-action-adapter.js";
export const name = "Scale Component Memory";
export const description = "Scale the memory allocation of a Rainbond component";
export const risk = "medium";
export const requiresApproval = true;
export const approvalPolicy = {
    evaluate(input) {
        const isLargeScaleChange = input.memory >= 2048;
        const isStatefulComponent = /(^|[-_])(db|mysql|redis)([-_]|$)/i.test(input.name);
        return {
            requiresApproval: true,
            risk: isLargeScaleChange || isStatefulComponent ? "high" : "medium",
            reason: isLargeScaleChange || isStatefulComponent
                ? `将 ${input.name} 的内存调整到 ${input.memory}MB，属于高影响资源变更`
                : `将 ${input.name} 的内存调整到 ${input.memory}MB，需要确认资源变更影响`,
        };
    },
};
const adapter = new MockActionAdapter();
export async function execute(input) {
    return adapter.scaleComponentMemory(input);
}
