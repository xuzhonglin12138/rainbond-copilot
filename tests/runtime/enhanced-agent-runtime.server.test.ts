// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createServerRuntimeConfig } from "../../src/runtime/runtime-dependencies";

describe("createServerRuntimeConfig", () => {
  it("builds a server-oriented runtime config without browser workspace defaults", () => {
    const config = createServerRuntimeConfig({
      sessionId: "cs_123",
      actor: {
        tenantId: "t_123",
        userId: "u_456",
        username: "alice",
        sourceSystem: "ops-console",
        roles: ["app_admin"],
      },
    });

    expect(config.sessionId).toBe("cs_123");
    expect(config.actor?.tenantId).toBe("t_123");
    expect(config.enableWorkspace).toBe(false);
    expect(config.enableMemory).toBe(false);
  });
});
