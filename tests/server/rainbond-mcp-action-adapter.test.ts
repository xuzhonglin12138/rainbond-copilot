// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { RainbondMcpActionAdapter } from "../../src/server/integrations/rainbond-mcp/action-adapter";

describe("RainbondMcpActionAdapter", () => {
  it("maps getComponentStatus to rainbond_get_component_summary", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          component_id: "svc-1",
          component_name: "api",
          status: "running",
          memory: 1024,
        },
        content: [],
      })),
    };
    const adapter = new RainbondMcpActionAdapter(client as any);

    const result = await adapter.getComponentStatus({
      teamName: "team-a",
      regionName: "region-a",
      appId: 12,
      serviceId: "svc-1",
    });

    expect(client.callTool).toHaveBeenCalledWith(
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

  it("maps getComponentLogs to rainbond_get_component_logs", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          component_name: "api",
          logs: ["line-1", "line-2"],
        },
        content: [],
      })),
    };
    const adapter = new RainbondMcpActionAdapter(client as any);

    const result = await adapter.getComponentLogs({
      teamName: "team-a",
      regionName: "region-a",
      appId: 12,
      serviceId: "svc-1",
      lines: 50,
    });

    expect(client.callTool).toHaveBeenCalledWith(
      "rainbond_get_component_logs",
      expect.objectContaining({
        team_name: "team-a",
        region_name: "region-a",
        app_id: 12,
        service_id: "svc-1",
        lines: 50,
      })
    );
    expect(result.logs).toEqual(["line-1", "line-2"]);
  });

  it("maps restartComponent to rainbond_operate_app", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          ok: true,
        },
        content: [],
      })),
    };
    const adapter = new RainbondMcpActionAdapter(client as any);

    const result = await adapter.restartComponent({
      teamName: "team-a",
      regionName: "region-a",
      appId: 12,
      action: "restart",
    });

    expect(client.callTool).toHaveBeenCalledWith("rainbond_operate_app", {
      team_name: "team-a",
      region_name: "region-a",
      app_id: 12,
      action: "restart",
    });
    expect(result.status).toBe("running");
  });

  it("maps scaleComponentMemory to rainbond_vertical_scale_component with cpu and memory", async () => {
    const client = {
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          component_name: "api",
          new_memory: 1024,
          new_cpu: 1000,
        },
        content: [],
      })),
    };
    const adapter = new RainbondMcpActionAdapter(client as any);

    const result = await adapter.scaleComponentMemory({
      teamName: "team-a",
      regionName: "region-a",
      appId: 12,
      serviceId: "svc-1",
      memory: 1024,
      cpu: 1000,
    });

    expect(client.callTool).toHaveBeenCalledWith(
      "rainbond_vertical_scale_component",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 12,
        service_id: "svc-1",
        new_memory: 1024,
        new_cpu: 1000,
        new_gpu: 0,
      }
    );
    expect(result).toMatchObject({
      name: "api",
      memory: 1024,
      cpu: 1000,
    });
  });
});
