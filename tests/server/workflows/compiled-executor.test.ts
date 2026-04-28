// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  canExecuteCompiledSkill,
  executeCompiledWorkflow,
} from "../../../src/server/workflows/compiled-executor";

describe("compiled executor", () => {
  it("executes the compiled delivery verifier workflow through MCP tools", async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({
        isError: false,
        structuredContent: {
          group_name: "manual-demo",
          status: "running",
        },
        content: [],
      })
      .mockResolvedValueOnce({
        isError: false,
        structuredContent: {
          items: [{ service_id: "svc-1" }, { service_id: "svc-2" }],
        },
        content: [],
      })
      .mockResolvedValueOnce({
        isError: false,
        structuredContent: {
          service: {
            component_name: "api",
          },
          status: {
            status: "running",
          },
        },
        content: [],
      });
    const publishToolTrace = vi.fn(async () => {});

    const result = await executeCompiledWorkflow({
      skillId: "rainbond-delivery-verifier",
      actor: {
        tenantId: "team-a",
        tenantName: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
        enterpriseId: "eid-1",
      },
      candidateScope: {
        teamName: "team-a",
        regionName: "region-a",
        appId: "app-001",
      },
      client: {
        callTool,
      },
      publishToolTrace,
    });

    expect(canExecuteCompiledSkill("rainbond-delivery-verifier")).toBe(true);
    expect(callTool).toHaveBeenCalledTimes(3);
    expect(callTool).toHaveBeenCalledWith("rainbond_get_app_detail", {
      team_name: "team-a",
      region_name: "region-a",
      app_id: 1,
    });
    expect(callTool).toHaveBeenCalledWith("rainbond_query_components", {
      enterprise_id: "eid-1",
      app_id: 1,
    });
    expect(callTool).toHaveBeenCalledWith("rainbond_get_component_summary", {
      team_name: "team-a",
      region_name: "region-a",
      app_id: 1,
      service_id: "svc-1",
    });
    expect(result.toolCalls).toEqual([
      { name: "rainbond_get_app_detail", status: "success" },
      { name: "rainbond_query_components", status: "success" },
      { name: "rainbond_get_component_summary", status: "success" },
    ]);
    expect(result.summary).toContain("delivered-but-needs-manual-validation");
    expect(result.summary).toContain("https://team-a-region-a.rainbond.me/manual-demo");
    expect(result.subflowData).toMatchObject({
      appStatus: "running",
      componentCount: 2,
      inspectedComponentStatus: "running",
      runtimeState: "runtime_healthy",
      deliveryState: "delivered-but-needs-manual-validation",
      preferredAccessUrl: "https://team-a-region-a.rainbond.me/manual-demo",
    });
  });
});
