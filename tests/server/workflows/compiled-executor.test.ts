// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  canExecuteCompiledSkill,
  executeCompiledWorkflow,
} from "../../../src/server/workflows/compiled-executor";

const baseActor = {
  tenantId: "team-a",
  tenantName: "team-a",
  userId: "u_1",
  username: "alice",
  sourceSystem: "rainbond-ui" as const,
  roles: [],
  enterpriseId: "eid-1",
};

const baseScope = {
  teamName: "team-a",
  regionName: "region-a",
  appId: "app-001",
};

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

  it("routes the troubleshooter branch by inspection_mode (build_logs)", async () => {
    const callTool = vi.fn(async (name: string) => ({
      isError: false,
      structuredContent: { ok: true, _tool: name },
      content: [],
    }));

    expect(canExecuteCompiledSkill("rainbond-fullstack-troubleshooter")).toBe(true);

    const result = await executeCompiledWorkflow({
      skillId: "rainbond-fullstack-troubleshooter",
      actor: baseActor,
      candidateScope: baseScope,
      input: {
        service_id: "svc-7",
        event_id: "evt-42",
        inspection_mode: "build_logs",
      },
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    const calledTools = callTool.mock.calls.map(([name]) => name);
    expect(calledTools).toContain("rainbond_get_app_detail");
    expect(calledTools).toContain("rainbond_query_components");
    expect(calledTools).toContain("rainbond_get_component_build_logs");
    expect(calledTools).not.toContain("rainbond_get_component_pods");
    expect(calledTools).not.toContain("rainbond_get_component_logs");
    expect(calledTools).not.toContain("rainbond_get_component_summary");

    const buildLogsCall = callTool.mock.calls.find(
      ([name]) => name === "rainbond_get_component_build_logs"
    );
    expect(buildLogsCall?.[1]).toMatchObject({
      service_id: "svc-7",
      event_id: "evt-42",
      app_id: 1,
    });

    expect(result.toolCalls.map((tc) => tc.name)).toContain(
      "rainbond_get_component_build_logs"
    );
  });

  it("continues through the generic loop when inspection_mode is unset", async () => {
    const callTool = vi.fn(async (name: string) => {
      if (name === "rainbond_get_app_detail") {
        return {
          isError: false,
          structuredContent: {
            group_name: "demo-2048",
            status: "closed",
            running_service_count: 0,
          },
          content: [],
        };
      }
      if (name === "rainbond_query_components") {
        return {
          isError: false,
          structuredContent: {
            items: [{ service_id: "svc-9", service_alias: "2048-game" }],
            total: 1,
            page: 1,
            page_size: 20,
          },
          content: [],
        };
      }
      if (name === "rainbond_get_component_summary") {
        return {
          isError: false,
          structuredContent: {
            service: {
              component_name: "2048-game",
              service_source: "source_code",
            },
            status: {
              status: "waiting",
            },
          },
          content: [],
        };
      }
      if (name === "rainbond_get_component_events") {
        return {
          isError: false,
          structuredContent: {
            items: [
              {
                event_id: "evt-42",
                message: "build failed while fetching npm package",
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
          },
          content: [],
        };
      }
      if (name === "rainbond_get_component_build_logs") {
        return {
          isError: false,
          structuredContent: {
            lines: ["BUILD FAILED", "npm ERR! exited with code 1"],
          },
          content: [],
        };
      }
      return {
        isError: false,
        structuredContent: { ok: true, _tool: name },
        content: [],
      };
    });

    await executeCompiledWorkflow({
      skillId: "rainbond-fullstack-troubleshooter",
      actor: baseActor,
      candidateScope: baseScope,
      input: { service_id: "svc-9" },
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    const calledTools = callTool.mock.calls.map(([name]) => name);
    expect(calledTools).toContain("rainbond_get_component_summary");
    expect(calledTools).toContain("rainbond_get_component_events");
    expect(calledTools).toContain("rainbond_get_component_build_logs");
  });

  it("omits $input.<key> args entirely when the placeholder has no supplied value", async () => {
    // Regression: previously we sent literal "$input.service_id" / "$input.event_id"
    // strings to MCP when the LLM router could not extract those parameters from the
    // user's natural-language message. MCP would either reject the call or, worse,
    // accept the bogus literal as a valid identifier.
    const callTool = vi.fn(async (name: string) => ({
      isError: false,
      structuredContent: { ok: true, _tool: name },
      content: [],
    }));

    await executeCompiledWorkflow({
      skillId: "rainbond-fullstack-troubleshooter",
      actor: baseActor,
      candidateScope: baseScope,
      input: {
        // intentionally omit service_id and event_id
        inspection_mode: "build_logs",
      },
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    const buildLogsCall = callTool.mock.calls.find(
      ([name]) => name === "rainbond_get_component_build_logs"
    );
    expect(buildLogsCall).toBeDefined();

    const args = buildLogsCall?.[1] as Record<string, unknown>;
    expect(args).not.toHaveProperty("service_id");
    expect(args).not.toHaveProperty("event_id");
    for (const value of Object.values(args)) {
      expect(typeof value === "string" && value.startsWith("$input."), `leaked literal: ${String(value)}`).toBe(false);
    }
  });

  it("falls back to candidateScope.componentId when LLM did not supply service_id", async () => {
    // Regression: the LLM cannot reliably extract a service_id from a
    // Chinese component name like "demo-2048 应用下的 2048-game 组件".
    // The UI session context already carries the component_id of the page
    // the user is on, so we route that into $input.service_id when no
    // explicit value is provided.
    const callTool = vi.fn(async (name: string) => ({
      isError: false,
      structuredContent: { ok: true, _tool: name },
      content: [],
    }));

    await executeCompiledWorkflow({
      skillId: "rainbond-fullstack-troubleshooter",
      actor: baseActor,
      candidateScope: {
        ...baseScope,
        componentId: "gr71871f",
      },
      input: {
        // service_id intentionally omitted
        inspection_mode: "build_logs",
        event_id: "evt-99",
      },
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    const buildLogsCall = callTool.mock.calls.find(
      ([name]) => name === "rainbond_get_component_build_logs"
    );
    expect(buildLogsCall?.[1]).toMatchObject({
      service_id: "gr71871f",
      event_id: "evt-99",
    });
  });

  it("does not overwrite an explicit service_id from input", async () => {
    const callTool = vi.fn(async (name: string) => ({
      isError: false,
      structuredContent: { ok: true, _tool: name },
      content: [],
    }));

    await executeCompiledWorkflow({
      skillId: "rainbond-fullstack-troubleshooter",
      actor: baseActor,
      candidateScope: { ...baseScope, componentId: "gr71871f" },
      input: {
        service_id: "explicit-svc",
        inspection_mode: "build_logs",
        event_id: "evt-1",
      },
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    const buildLogsCall = callTool.mock.calls.find(
      ([name]) => name === "rainbond_get_component_build_logs"
    );
    expect(buildLogsCall?.[1]).toMatchObject({ service_id: "explicit-svc" });
  });

  it("dispatches inspection_mode=logs to component logs", async () => {
    const callTool = vi.fn(async (name: string) => ({
      isError: false,
      structuredContent: { ok: true, _tool: name },
      content: [],
    }));

    await executeCompiledWorkflow({
      skillId: "rainbond-fullstack-troubleshooter",
      actor: baseActor,
      candidateScope: baseScope,
      input: {
        service_id: "svc-9",
        inspection_mode: "logs",
        action: "service",
        lines: 200,
      },
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    const logsCall = callTool.mock.calls.find(
      ([name]) => name === "rainbond_get_component_logs"
    );
    expect(logsCall?.[1]).toMatchObject({
      service_id: "svc-9",
      action: "service",
      lines: 200,
    });
  });

  it("canonicalizes a routed component alias to the real service_id before component-scoped MCP calls", async () => {
    const callTool = vi.fn(async (name: string) => {
      if (name === "rainbond_get_app_detail") {
        return {
          isError: false,
          structuredContent: {
            group_name: "demo-2048",
            status: "closed",
            running_service_count: 0,
          },
          content: [],
        };
      }
      if (name === "rainbond_query_components") {
        return {
          isError: false,
          structuredContent: {
            items: [
              {
                service_id: "8fe8f61d266de87c82d4507a0110c0cc",
                service_alias: "gr10c0cc",
                service_cname: "2048-game",
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
          },
          content: [],
        };
      }
      if (name === "rainbond_get_component_summary") {
        return {
          isError: false,
          structuredContent: {
            service: {
              component_name: "2048-game",
              service_source: "source_code",
            },
            status: {
              status: "waiting",
            },
          },
          content: [],
        };
      }
      return {
        isError: false,
        structuredContent: { ok: true, _tool: name },
        content: [],
      };
    });

    await executeCompiledWorkflow({
      skillId: "rainbond-fullstack-troubleshooter",
      actor: baseActor,
      candidateScope: baseScope,
      input: {
        service_id: "gr10c0cc",
        inspection_mode: "summary",
      },
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    const summaryCall = callTool.mock.calls.find(
      ([name]) => name === "rainbond_get_component_summary"
    );
    expect(summaryCall?.[1]).toMatchObject({
      service_id: "8fe8f61d266de87c82d4507a0110c0cc",
    });
  });

  it("preserves the original alias-like service_id in skill input while canonicalizing MCP args", async () => {
    const callTool = vi.fn(async (name: string) => {
      if (name === "rainbond_get_app_detail") {
        return {
          isError: false,
          structuredContent: {
            group_name: "demo-2048",
            status: "closed",
            running_service_count: 0,
          },
          content: [],
        };
      }
      if (name === "rainbond_query_components") {
        return {
          isError: false,
          structuredContent: {
            items: [
              {
                service_id: "8fe8f61d266de87c82d4507a0110c0cc",
                service_alias: "gr10c0cc",
                service_cname: "2048-game",
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
          },
          content: [],
        };
      }
      if (name === "rainbond_get_component_summary") {
        return {
          isError: false,
          structuredContent: {
            service: {
              component_name: "2048-game",
              service_source: "source_code",
            },
            status: {
              status: "waiting",
            },
          },
          content: [],
        };
      }
      return {
        isError: false,
        structuredContent: {},
        content: [],
      };
    });

    const summarizer = {
      summarize: vi.fn().mockResolvedValue("ok"),
    };

    await executeCompiledWorkflow({
      skillId: "rainbond-fullstack-troubleshooter",
      actor: baseActor,
      candidateScope: { ...baseScope, componentId: "gr10c0cc" },
      input: {
        service_id: "gr10c0cc",
        inspection_mode: "summary",
      },
      summarizer,
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    const summarizerInput = summarizer.summarize.mock.calls[0][0].skillInput;
    expect(summarizerInput).toMatchObject({
      service_id: "gr10c0cc",
      inspection_mode: "summary",
    });

    const summaryCall = callTool.mock.calls.find(
      ([name]) => name === "rainbond_get_component_summary"
    );
    expect(summaryCall?.[1]).toMatchObject({
      service_id: "8fe8f61d266de87c82d4507a0110c0cc",
    });
  });
});
