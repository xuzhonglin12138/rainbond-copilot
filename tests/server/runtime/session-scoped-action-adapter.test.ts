// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SessionScopedRainbondActionAdapter } from "../../../src/server/runtime/session-scoped-action-adapter";

describe("SessionScopedRainbondActionAdapter", () => {
  it("resolves component name to service_id via rainbond_query_components", async () => {
    const client = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                service_id: "svc-1",
                service_alias: "api",
                service_cname: "API",
              },
            ],
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            component_name: "api",
            status: "running",
            memory: 1024,
          },
          content: [],
        }),
    };

    const adapter = new SessionScopedRainbondActionAdapter(client as any, {
      actor: {
        tenantId: "team-a",
        tenantName: "team-a",
        enterpriseId: "eid-1",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-a",
        region_name: "region-a",
        app_id: "12",
      },
    });

    const result = await adapter.getComponentStatus({ name: "api" });

    expect(client.callTool).toHaveBeenNthCalledWith(
      1,
      "rainbond_query_components",
      {
        enterprise_id: "eid-1",
        app_id: 12,
        query: "api",
        page: 1,
        page_size: 20,
      }
    );
    expect(client.callTool).toHaveBeenNthCalledWith(
      2,
      "rainbond_get_component_summary",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 12,
        service_id: "svc-1",
      }
    );
    expect(result).toMatchObject({
      name: "api",
      status: "running",
      memory: 1024,
    });
  });

  it("uses component_id from session context when available", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          component_name: "api",
          logs: ["line-1"],
        },
        content: [],
      })),
    };

    const adapter = new SessionScopedRainbondActionAdapter(client as any, {
      actor: {
        tenantId: "team-a",
        tenantName: "team-a",
        enterpriseId: "eid-1",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-a",
        region_name: "region-a",
        app_id: "12",
        component_id: "svc-direct",
        component_source: "route",
      },
    });

    const result = await adapter.getComponentLogs({ name: "svc-direct", lines: 20 });

    expect(client.callTool).toHaveBeenCalledTimes(1);
    expect(client.callTool).toHaveBeenCalledWith(
      "rainbond_get_component_logs",
      expect.objectContaining({
        service_id: "svc-direct",
      })
    );
    expect(result.logs).toEqual(["line-1"]);
  });

  it("prefers the current component_id from session context for mutating actions even when the user message uses a component name", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          ok: true,
        },
        content: [],
      })),
    };

    const adapter = new SessionScopedRainbondActionAdapter(client as any, {
      actor: {
        tenantId: "team-a",
        tenantName: "team-a",
        enterpriseId: "eid-1",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-a",
        region_name: "region-a",
        app_id: "12",
        component_id: "svc-direct",
        component_source: "route",
      },
    });

    const result = await adapter.restartComponent({ name: "service-web" });

    expect(client.callTool).toHaveBeenCalledTimes(1);
    expect(client.callTool).toHaveBeenCalledWith("rainbond_operate_app", {
      team_name: "team-a",
      region_name: "region-a",
      app_id: 12,
      action: "restart",
      service_ids: ["svc-direct"],
    });
    expect(result).toMatchObject({
      name: "svc-direct",
      serviceId: "svc-direct",
      status: "running",
    });
  });

  it("allows restart when the session context already contains a complete executable scope", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          ok: true,
        },
        content: [],
      })),
    };

    const adapter = new SessionScopedRainbondActionAdapter(client as any, {
      actor: {
        tenantId: "team-a",
        tenantName: "team-a",
        enterpriseId: "eid-1",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-a",
        region_name: "region-a",
        app_id: "12",
        component_id: "svc-direct",
        component_source: "route",
      },
    });

    const result = await adapter.restartComponent({ name: "svc-direct" });

    expect(client.callTool).toHaveBeenCalledWith("rainbond_operate_app", {
      team_name: "team-a",
      region_name: "region-a",
      app_id: 12,
      action: "restart",
      service_ids: ["svc-direct"],
    });
    expect(result).toMatchObject({
      name: "svc-direct",
      serviceId: "svc-direct",
      status: "running",
    });
  });

  it("allows scale when the session context already contains a complete executable scope", async () => {
    const client = {
      callTool: vi.fn(async (name) => {
        if (name === "rainbond_vertical_scale_component") {
          return {
            isError: false,
            structuredContent: {
              component_name: "svc-direct",
              memory: 2048,
            },
            content: [],
          };
        }
        return {
          isError: false,
          structuredContent: {},
          content: [],
        };
      }),
    };

    const adapter = new SessionScopedRainbondActionAdapter(client as any, {
      actor: {
        tenantId: "team-a",
        tenantName: "team-a",
        enterpriseId: "eid-1",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-a",
        region_name: "region-a",
        app_id: "12",
        component_id: "svc-direct",
        component_source: "route",
      },
    });

    await adapter.scaleComponentMemory({ name: "svc-direct", memory: 2048 });

    expect(client.callTool).toHaveBeenCalledWith(
      "rainbond_vertical_scale_component",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 12,
        service_id: "svc-direct",
        new_memory: 2048,
      }
    );
  });

  it("still rejects mutating actions when the session lacks executable scope", async () => {
    const client = {
      callTool: vi.fn(),
    };

    const adapter = new SessionScopedRainbondActionAdapter(client as any, {
      actor: {
        tenantId: "team-a",
        tenantName: "team-a",
        enterpriseId: "eid-1",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-a",
      },
    });

    await expect(adapter.restartComponent({ name: "svc-direct" })).rejects.toThrow(
      "Missing verified session scope for Rainbond action"
    );
  });

  it("uses verified scope values for mutating actions", async () => {
    const client = {
      callTool: vi.fn(async (name) => {
        if (name === "rainbond_vertical_scale_component") {
          return {
            isError: false,
            structuredContent: {
              component_name: "api",
              memory: 2048,
            },
            content: [],
          };
        }
        return {
          isError: false,
          structuredContent: {
            items: [],
          },
          content: [],
        };
      }),
    };

    const adapter = new SessionScopedRainbondActionAdapter(client as any, {
      actor: {
        tenantId: "team-a",
        tenantName: "team-a",
        enterpriseId: "eid-1",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-context",
        region_name: "region-context",
        app_id: "9",
        component_id: "svc-direct",
      },
      lastVerifiedScopeSignature: "team-a|region-a|12||verified",
      verifiedScope: {
        teamName: "team-a",
        regionName: "region-a",
        appId: "12",
        verified: true,
      },
    });

    await adapter.scaleComponentMemory({ name: "svc-direct", memory: 2048 });

    expect(client.callTool).toHaveBeenCalledWith(
      "rainbond_vertical_scale_component",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 12,
        service_id: "svc-direct",
        new_memory: 2048,
      }
    );
  });
});
