// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseRequestActor } from "../../../src/server/auth/request-context";

describe("parseRequestActor", () => {
  it("extracts trusted tenant and user identity from headers", () => {
    const actor = parseRequestActor({
      "x-copilot-tenant-id": "t_123",
      "x-copilot-user-id": "u_456",
      "x-copilot-username": "alice",
      "x-copilot-source-system": "ops-console",
      "x-copilot-roles": "app_admin,app_operator",
    });

    expect(actor.tenantId).toBe("t_123");
    expect(actor.userId).toBe("u_456");
    expect(actor.username).toBe("alice");
    expect(actor.sourceSystem).toBe("ops-console");
    expect(actor.roles).toEqual(["app_admin", "app_operator"]);
  });

  it("falls back to a local default actor when copilot headers are missing", () => {
    const actor = parseRequestActor({});

    expect(actor).toMatchObject({
      tenantId: "local-default",
      userId: "local-user",
      username: "local-user",
      sourceSystem: "local-client",
      roles: [],
    });
  });
});
