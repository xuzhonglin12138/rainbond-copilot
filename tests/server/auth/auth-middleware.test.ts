// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  getRequestActor,
  resolveRequestActor,
} from "../../../src/server/auth/auth-middleware";

describe("auth middleware", () => {
  it("keeps trusted server-side actor identity without resolving via MCP", async () => {
    const resolver = {
      resolveUserJwtSubject: vi.fn(),
    };

    const actor = await resolveRequestActor(
      {
        headers: {
          "x-copilot-tenant-id": "t_123",
          "x-copilot-user-id": "u_456",
          "x-copilot-username": "alice",
          "x-copilot-source-system": "ops-console",
        },
      },
      resolver as any
    );

    expect(actor.actor).toMatchObject({
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
    });
    expect(resolver.resolveUserJwtSubject).not.toHaveBeenCalled();
  });

  it("resolves canonical actor from JWT context when browser identity is unresolved", async () => {
    const resolver = {
      resolveUserJwtSubject: vi.fn(async () => ({
        authMode: "user_jwt",
        userId: "u_1",
        username: "alice",
        enterpriseId: "eid_1",
        tenantId: "team-a",
        teamName: "team-a",
        sourceSystem: "rainbond-ui",
        roles: [],
      })),
    };

    const actor = await resolveRequestActor(
      {
        headers: {
          authorization: "GRJWT token",
          cookie: "token=jwt-token; sessionid=abc",
          "x-team-name": "team-a",
          "x-region-name": "region-a",
          "x-copilot-source-system": "rainbond-ui",
        },
      },
      resolver as any
    );

    expect(actor.actor).toMatchObject({
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      authorization: "GRJWT token",
      cookie: "token=jwt-token; sessionid=abc",
    });
    expect(resolver.resolveUserJwtSubject).toHaveBeenCalledWith({
      mode: "user_jwt",
      authorization: "GRJWT token",
      cookie: "token=jwt-token; sessionid=abc",
      teamName: "team-a",
      regionName: "region-a",
      sourceSystem: "rainbond-ui",
    });
  });

  it("rejects partial browser auth context when authorization is present without cookie", async () => {
    const resolver = {
      resolveUserJwtSubject: vi.fn(),
    };

    await expect(
      resolveRequestActor(
        {
          headers: {
            authorization: "GRJWT token",
            "x-team-name": "team-a",
            "x-region-name": "region-a",
          },
        },
        resolver as any
      )
    ).rejects.toThrow(
      "Authorization and Cookie headers are required together for Rainbond MCP user requests"
    );

    expect(resolver.resolveUserJwtSubject).not.toHaveBeenCalled();
  });

  it("getRequestActor returns the transport-level candidate actor only", () => {
    const actor = getRequestActor({
      headers: {
        authorization: "GRJWT token",
        cookie: "token=jwt-token; sessionid=abc",
        "x-team-name": "team-a",
      },
    });

    expect(actor).toMatchObject({
      tenantId: "team-a",
      userId: "",
      username: "",
      authorization: "GRJWT token",
      cookie: "token=jwt-token; sessionid=abc",
    });
  });
});
