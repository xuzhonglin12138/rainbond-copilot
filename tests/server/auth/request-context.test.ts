// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseRequestActor } from "../../../src/server/auth/request-context";

describe("parseRequestActor", () => {
  it("extracts tenant and user identity when trusted copilot headers are used without browser JWT mode", () => {
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

  it("leaves user identity unresolved in browser JWT mode even if routing headers exist", () => {
    const actor = parseRequestActor({
      authorization: "GRJWT token",
      cookie: "token=jwt-token; sessionid=abc",
      "x-team-name": "team-a",
      "x-region-name": "region-a",
    });

    expect(actor).toMatchObject({
      tenantId: "team-a",
      userId: "",
      username: "",
      sourceSystem: "local-client",
      roles: [],
      authorization: "GRJWT token",
      cookie: "token=jwt-token; sessionid=abc",
    });
  });
});
