import { MockActionAdapter } from "../../../adapters/mock/mock-action-adapter";

export const name = "Get Component Status";
export const description = "Get the current status of a Rainbond component";
export const risk = "low";
export const requiresApproval = false;

const adapter = new MockActionAdapter();

export async function execute(input: { name: string }) {
  return adapter.getComponentStatus(input);
}
