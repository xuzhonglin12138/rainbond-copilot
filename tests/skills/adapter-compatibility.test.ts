import type { ActionAdapter } from "../../src/skills/types";
import { MockActionAdapter } from "../../src/adapters/mock/mock-action-adapter";

it("keeps action skill input/output stable across adapters", async () => {
  // This test ensures that action skills have a stable interface
  // so that MockActionAdapter can be swapped for RainbondActionAdapter
  // without changing the skill implementations

  const adapter: ActionAdapter = new MockActionAdapter();

  // Test getComponentStatus interface
  const status = await adapter.getComponentStatus({ name: "frontend-ui" });
  expect(status).toHaveProperty("name");
  expect(status).toHaveProperty("status");
  expect(status).toHaveProperty("memory");

  // Test getComponentLogs interface
  const logs = await adapter.getComponentLogs({ name: "frontend-ui", lines: 10 });
  expect(logs).toHaveProperty("name");
  expect(logs).toHaveProperty("logs");
  expect(Array.isArray(logs.logs)).toBe(true);

  // Test restartComponent interface
  const restart = await adapter.restartComponent({ name: "frontend-ui" });
  expect(restart).toHaveProperty("name");
  expect(restart).toHaveProperty("status");

  // Test scaleComponentMemory interface
  const scale = await adapter.scaleComponentMemory({ name: "frontend-ui", memory: 1024 });
  expect(scale).toHaveProperty("name");
  expect(scale).toHaveProperty("memory");
});
