// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCopilotController } from "../../../src/server/controllers/copilot-controller";

describe("copilot api controller", () => {
  it("creates a session for the current tenant and user", async () => {
    const controller = createCopilotController();
    const response = await controller.createSession({
      actor: {
        tenantId: "t_123",
        userId: "u_456",
        username: "alice",
        sourceSystem: "ops-console",
        roles: ["app_admin"],
      },
      body: {
        context: {
          app_id: "app-001",
        },
      },
    });

    expect(response.data.session_id).toMatch(/^cs_/);
    expect(response.data.tenant_id).toBe("t_123");
    expect(response.data.status).toBe("active");
  });

  it("creates a run and returns a stream URL", async () => {
    const controller = createCopilotController();
    const session = await controller.createSession({
      actor: {
        tenantId: "t_123",
        userId: "u_456",
        username: "alice",
        sourceSystem: "ops-console",
        roles: ["app_admin"],
      },
      body: {},
    });

    const response = await controller.createMessageRun({
      actor: {
        tenantId: "t_123",
        userId: "u_456",
        username: "alice",
        sourceSystem: "ops-console",
        roles: ["app_admin"],
      },
      params: { sessionId: session.data.session_id },
      body: { message: "check frontend-ui", stream: true },
    });

    expect(response.data.run_id).toMatch(/^run_/);
    expect(response.data.session_id).toBe(session.data.session_id);
    expect(response.data.stream_url).toContain(
      `/api/v1/copilot/sessions/${session.data.session_id}/runs/`
    );
  });
});
