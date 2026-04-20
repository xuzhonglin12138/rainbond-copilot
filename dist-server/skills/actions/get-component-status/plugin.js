import { MockActionAdapter } from "../../../adapters/mock/mock-action-adapter.js";
export const name = "Get Component Status";
export const description = "Get the current status of a Rainbond component";
export const risk = "low";
export const requiresApproval = false;
const adapter = new MockActionAdapter();
export async function execute(input) {
    return adapter.getComponentStatus(input);
}
