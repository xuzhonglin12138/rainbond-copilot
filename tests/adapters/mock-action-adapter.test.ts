import { MockActionAdapter } from "../../src/adapters/mock/mock-action-adapter";

it("marks frontend-ui as running after restart", async () => {
  const adapter = new MockActionAdapter();
  await adapter.restartComponent({ name: "frontend-ui" });
  const status = await adapter.getComponentStatus({ name: "frontend-ui" });

  expect(status.status).toBe("running");
});
