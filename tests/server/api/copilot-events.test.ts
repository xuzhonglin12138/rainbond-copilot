// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createCopilotController } from "../../../src/server/controllers/copilot-controller";
import { createInMemorySessionStore } from "../../../src/server/stores/session-store";

describe("copilot event stream", () => {
  const mockActionAdapter = {
    getComponentStatus: vi.fn(async (input: { name: string }) => ({
      name: input.name,
      status: "running",
      memory: 1024,
    })),
    getComponentLogs: vi.fn(async (input: { name: string; lines?: number }) => ({
      name: input.name,
      logs: Array.from({ length: input.lines || 20 }, (_, index) => `log-${index + 1}`),
    })),
    restartComponent: vi.fn(async (input: { name: string }) => ({
      name: input.name,
      status: "running",
    })),
    scaleComponentMemory: vi.fn(async (input: { name: string; memory: number }) => ({
      name: input.name,
      memory: input.memory,
    })),
  };

  it("returns replayable SSE events after a sequence", async () => {
    const controller = createCopilotController({
      llmClient: null,
      actionAdapter: mockActionAdapter as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "check frontend-ui", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "4" },
    });

    expect(stream.contentType).toBe("text/event-stream");
    expect(stream.events).toHaveLength(1);
    expect(stream.events[0].type).toBe("run.status");
    expect(stream.events[0].sequence).toBe(5);
  });

  it("executes low-risk diagnostic requests and emits trace plus final message", async () => {
    const controller = createCopilotController({
      llmClient: null,
      actionAdapter: mockActionAdapter as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "check frontend-ui status", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "chat.trace",
      "chat.trace",
      "chat.message",
      "run.status",
    ]);
    expect(stream.events.at(-1)).toMatchObject({
      type: "run.status",
      data: { status: "done" },
    });
  });

  it("uses llm-generated assistant content for general chat when an llm client is provided", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "你好！我是 Rainbond Copilot，我可以帮你检查组件状态、查看日志和处理审批操作。",
        finish_reason: "stop",
      })),
    };
    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "你好", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(llmClient.chat).toHaveBeenCalled();
    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "chat.message",
      "run.status",
    ]);
    expect(stream.events[1].data).toMatchObject({
      role: "assistant",
      content: "你好！我是 Rainbond Copilot，我可以帮你检查组件状态、查看日志和处理审批操作。",
    });
  });

  it("injects current session context into the llm prompt and enriches query tool inputs from context", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_team_apps_1",
              type: "function",
              function: {
                name: "rainbond_get_team_apps",
                arguments: JSON.stringify({}),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "",
          finish_reason: "stop",
        }),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_get_team_apps",
          description: "Get application list under the specified team and region.",
          inputSchema: {
            type: "object",
            properties: {
              team_name: { type: "string" },
              region_name: { type: "string" },
            },
            required: ["team_name", "region_name"],
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          items: [],
          total: 0,
          page: 1,
          page_size: 20,
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "jabrm8l6",
      regionName: "rainbond",
      enterpriseId: "8948f3fcf66e0cd91bf1045e8ca4a965",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          team_name: "jabrm8l6",
          region_name: "rainbond",
          page: "/team/jabrm8l6/region/rainbond/index",
        },
      },
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "请帮我查看当前团队的应用列表", stream: true },
    });

    await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(llmClient.chat.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("team_name: jabrm8l6"),
        }),
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("region_name: rainbond"),
        }),
      ])
    );
    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_team_apps",
      expect.objectContaining({
        team_name: "jabrm8l6",
        region_name: "rainbond",
      })
    );
    expect(llmClient.chat.mock.calls[0][1]).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({
            name: "rainbond_query_teams",
          }),
        }),
        expect.objectContaining({
          function: expect.objectContaining({
            name: "rainbond_query_regions",
          }),
        }),
        expect.objectContaining({
          function: expect.objectContaining({
            name: "rainbond_query_apps",
          }),
        }),
      ])
    );
  });

  it("preserves reasoning_content across tool call continuations", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          reasoning_content: "先确认当前团队应用列表，再决定下一步。",
          tool_calls: [
            {
              id: "tool_team_apps_reasoning_1",
              type: "function",
              function: {
                name: "rainbond_get_team_apps",
                arguments: JSON.stringify({}),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "已完成查询。",
          finish_reason: "stop",
        }),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_get_team_apps",
          description: "Get application list under the specified team and region.",
          inputSchema: {
            type: "object",
            properties: {
              team_name: { type: "string" },
              region_name: { type: "string" },
            },
            required: ["team_name", "region_name"],
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          items: [],
          total: 0,
          page: 1,
          page_size: 20,
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "jabrm8l6",
      regionName: "rainbond",
      enterpriseId: "8948f3fcf66e0cd91bf1045e8ca4a965",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          team_name: "jabrm8l6",
          region_name: "rainbond",
          page: "/team/jabrm8l6/region/rainbond/index",
        },
      },
    });

    await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "请帮我查看当前团队的应用列表", stream: true },
    });

    const secondCallMessages = llmClient.chat.mock.calls[1][0];
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "先确认当前团队应用列表，再决定下一步。",
          tool_calls: [
            expect.objectContaining({
              function: expect.objectContaining({
                name: "rainbond_get_team_apps",
              }),
            }),
          ],
        }),
      ])
    );
  });

  it("routes enterprise mutable MCP tool calls into approval flow", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "",
        tool_calls: [
          {
            id: "tool_region_update_1",
            type: "function",
            function: {
              name: "rainbond_update_region",
              arguments: JSON.stringify({
                region_name: "rainbond",
                desc: "agent",
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_query_regions",
          description: "Query regions.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "rainbond_update_region",
          description: "Update cluster metadata.",
          inputSchema: {
            type: "object",
            properties: {
              region_name: { type: "string" },
              desc: { type: "string" },
            },
            required: ["region_name"],
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {},
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "demo-team",
      regionName: "rainbond",
      enterpriseId: "ent_123",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "ent_123",
          page: "/enterprise/clusters",
        },
      },
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "把默认集群的集群简介修改为 agent", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);
    expect(stream.events[1]).toMatchObject({
      type: "approval.requested",
      data: {
        description: "更新集群 rainbond",
        risk: "medium",
        level_label: "警告",
        scope: "enterprise",
        scope_label: "企业级",
      },
    });
    expect(queryToolClient.callTool).not.toHaveBeenCalled();
  });

  it("routes team-level create_app MCP tool calls into approval flow", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "",
        tool_calls: [
          {
            id: "tool_create_app_1",
            type: "function",
            function: {
              name: "rainbond_create_app",
              arguments: JSON.stringify({
                app_name: "agent-demo",
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_get_team_apps",
          description: "Get team apps.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "rainbond_create_app",
          description: "Create application",
          inputSchema: {
            type: "object",
            properties: {
              app_name: { type: "string" },
            },
            required: ["app_name"],
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {},
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "demo-team",
      regionName: "rainbond",
      enterpriseId: "ent_123",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "ent_123",
          team_name: "demo-team",
          region_name: "rainbond",
          page: "/team/demo-team/region/rainbond/index",
        },
      },
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "创建一个名为 agent-demo 的应用", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);
    expect(stream.events[1]).toMatchObject({
      type: "approval.requested",
      data: {
        description: "创建应用 agent-demo",
        risk: "medium",
        level_label: "警告",
        scope: "team",
        scope_label: "团队级",
      },
    });
    expect(queryToolClient.callTool).not.toHaveBeenCalled();
  });

  it("executes low-risk app-level mutable MCP tools directly", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_check_helm_1",
              type: "function",
              function: {
                name: "rainbond_check_helm_app",
                arguments: JSON.stringify({
                  repo_name: "bitnami",
                  chart_name: "nginx",
                  name: "demo-nginx",
                  version: "1.0.0",
                }),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "",
          finish_reason: "stop",
        }),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_check_helm_app",
          description: "Check helm application information before generating template or deployment.",
          inputSchema: {
            type: "object",
            properties: {
              repo_name: { type: "string" },
              chart_name: { type: "string" },
              name: { type: "string" },
              version: { type: "string" },
            },
            required: ["repo_name", "chart_name", "name", "version"],
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          chart_name: "nginx",
          name: "demo-nginx",
          version: "1.0.0",
          checked: true,
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "demo-team",
      regionName: "rainbond",
      enterpriseId: "ent_123",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "ent_123",
          team_name: "demo-team",
          region_name: "rainbond",
          app_id: "134",
          page: "/team/demo-team/region/rainbond/apps/134/overview",
        },
      },
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "校验这个 Helm 应用参数", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "chat.trace",
      "chat.trace",
      "chat.message",
      "run.status",
    ]);
    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_check_helm_app",
      expect.objectContaining({
        repo_name: "bitnami",
        chart_name: "nginx",
        name: "demo-nginx",
        version: "1.0.0",
        team_name: "demo-team",
        region_name: "rainbond",
        app_id: 134,
      })
    );
  });

  it("routes high-risk app-level mutable MCP tools into approval flow", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "",
        tool_calls: [
          {
            id: "tool_delete_app_1",
            type: "function",
            function: {
              name: "rainbond_delete_app",
              arguments: JSON.stringify({
                app_id: 134,
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_delete_app",
          description: "Delete an application.",
          inputSchema: {
            type: "object",
            properties: {
              app_id: { type: "integer" },
            },
            required: ["app_id"],
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {},
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "demo-team",
      regionName: "rainbond",
      enterpriseId: "ent_123",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "ent_123",
          team_name: "demo-team",
          region_name: "rainbond",
          app_id: "134",
          page: "/team/demo-team/region/rainbond/apps/134/overview",
        },
      },
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "删除当前应用", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);
    expect(stream.events[1]).toMatchObject({
      type: "approval.requested",
      data: {
        description: "删除应用 134，该操作可能不可逆",
        risk: "high",
        level_label: "危险",
        scope: "app",
        scope_label: "应用级",
      },
    });
    expect(queryToolClient.callTool).not.toHaveBeenCalled();
  });

  it("executes low-risk component summary mutable MCP tools directly", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_component_probe_summary_1",
              type: "function",
              function: {
                name: "rainbond_manage_component_probe",
                arguments: JSON.stringify({
                  operation: "summary",
                }),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "",
          finish_reason: "stop",
        }),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_manage_component_probe",
          description: "Manage component probes.",
          inputSchema: {
            type: "object",
            properties: {
              operation: { type: "string" },
            },
            required: ["operation"],
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          probe_count: 1,
          operation: "summary",
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "demo-team",
      regionName: "rainbond",
      enterpriseId: "ent_123",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "ent_123",
          team_name: "demo-team",
          region_name: "rainbond",
          app_id: "134",
          component_id: "svc-1",
          page: "/team/demo-team/region/rainbond/apps/134/overview",
        },
      },
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "查看当前组件的探针概况", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "chat.trace",
      "chat.trace",
      "chat.message",
      "run.status",
    ]);
    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_manage_component_probe",
      {
        operation: "summary",
        enterprise_id: "ent_123",
        team_name: "demo-team",
        region_name: "rainbond",
        app_id: 134,
        service_id: "svc-1",
      }
    );
  });

  it("routes component operate_app actions into component-scoped approval flow", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "",
        tool_calls: [
          {
            id: "tool_component_restart_1",
            type: "function",
            function: {
              name: "rainbond_operate_app",
              arguments: JSON.stringify({
                action: "restart",
                service_ids: ["svc-1"],
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_operate_app",
          description: "Batch operate application components.",
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string" },
              service_ids: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["action"],
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {},
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "demo-team",
      regionName: "rainbond",
      enterpriseId: "ent_123",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "ent_123",
          team_name: "demo-team",
          region_name: "rainbond",
          app_id: "134",
          component_id: "svc-1",
          page: "/team/demo-team/region/rainbond/apps/134/overview",
        },
      },
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "重启当前组件", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);
    expect(stream.events[1]).toMatchObject({
      type: "approval.requested",
      data: {
        description: "重启组件 svc-1",
        risk: "high",
        level_label: "危险",
        scope: "component",
        scope_label: "组件级",
      },
    });
    expect(queryToolClient.callTool).not.toHaveBeenCalled();
  });

  it("keeps follow-up mutable tool actions from the same sentence instead of dropping the second one", async () => {
    const sessionStore = createInMemorySessionStore();
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "",
        tool_calls: [
          {
            id: "tool_env_1",
            type: "function",
            function: {
              name: "rainbond_manage_component_envs",
              arguments: JSON.stringify({
                operation: "upsert",
                envs: [
                  {
                    name: "MYSQL_HOST",
                    attr_name: "MYSQL_HOST",
                    attr_value: "db.default",
                  },
                ],
              }),
            },
          },
          {
            id: "tool_port_1",
            type: "function",
            function: {
              name: "rainbond_manage_component_ports",
              arguments: JSON.stringify({
                operation: "enable_outer",
                port: 8080,
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_manage_component_envs",
          description: "Manage component envs.",
          inputSchema: {
            type: "object",
            properties: {
              operation: { type: "string" },
              envs: { type: "array" },
            },
          },
        },
        {
          name: "rainbond_manage_component_ports",
          description: "Manage component ports.",
          inputSchema: {
            type: "object",
            properties: {
              operation: { type: "string" },
              port: { type: "integer" },
            },
          },
        },
      ]),
      callTool: vi.fn(async (name: string, input: Record<string, unknown>) => {
        if (name === "rainbond_manage_component_envs") {
          return {
            isError: false,
            structuredContent: {
              updated: true,
              service_id: input.service_id,
            },
            content: [],
          };
        }
        return {
          isError: false,
          structuredContent: {
            updated: true,
            service_id: input.service_id,
          },
          content: [],
        };
      }),
    };

    const controller = createCopilotController({
      llmClient,
      sessionStore,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "team-a",
      tenantName: "team-a",
      regionName: "region-a",
      enterpriseId: "eid-1",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          team_name: "team-a",
          region_name: "region-a",
          app_id: "12",
          component_id: "svc-direct",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: {
        message: "把 MYSQL_HOST 改成 db.default，并且把 8080 端口开放到外网",
        stream: true,
      },
    });

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(initialStream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);

    const storedSessionAfterQueue = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(storedSessionAfterQueue?.pendingWorkflowAction).toMatchObject({
      toolName: "rainbond_manage_component_envs",
      followUpActions: [
        expect.objectContaining({
          toolName: "rainbond_manage_component_ports",
          requiresApproval: true,
        }),
      ],
    });

    const firstApprovalId = initialStream.events[1].data.approval_id;
    await controller.decideApproval({
      actor,
      params: { approvalId: firstApprovalId },
      body: { decision: "approved", comment: "先执行第一步" },
    });

    const resumedAfterFirstApproval = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "3" },
    });

    expect(resumedAfterFirstApproval.events.map((event) => event.type)).toContain(
      "approval.requested"
    );

    const storedSessionAfterFirstApproval = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(storedSessionAfterFirstApproval?.pendingWorkflowAction).toMatchObject({
      toolName: "rainbond_manage_component_ports",
    });
  });

  it("continues the llm tool loop after approval using the approved tool result", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_mutate_1",
              type: "function",
              function: {
                name: "rainbond_manage_component_envs",
                arguments: JSON.stringify({
                  operation: "upsert",
                  envs: [
                    {
                      name: "MYSQL_HOST",
                      attr_name: "MYSQL_HOST",
                      attr_value: "db.default",
                    },
                  ],
                }),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_summary_1",
              type: "function",
              function: {
                name: "rainbond_get_component_summary",
                arguments: JSON.stringify({}),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "环境变量已更新，组件当前状态正常。",
          finish_reason: "stop",
        }),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_manage_component_envs",
          description: "Manage component envs.",
          inputSchema: {
            type: "object",
            properties: {
              operation: { type: "string" },
              envs: { type: "array" },
            },
          },
        },
        {
          name: "rainbond_get_component_summary",
          description: "Get component summary.",
          inputSchema: {
            type: "object",
            properties: {
              team_name: { type: "string" },
              region_name: { type: "string" },
              app_id: { type: "integer" },
              service_id: { type: "string" },
            },
          },
        },
      ]),
      callTool: vi.fn(async (name: string, input: Record<string, unknown>) => {
        if (name === "rainbond_manage_component_envs") {
          return {
            isError: false,
            structuredContent: {
              updated: true,
              service_id: input.service_id,
            },
            content: [],
          };
        }

        return {
          isError: false,
          structuredContent: {
            service: {
              component_name: "svc-direct",
              min_memory: 1024,
            },
            status: {
              status: "running",
            },
          },
          content: [],
        };
      }),
    };

    const controller = createCopilotController({
      llmClient,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "team-a",
      tenantName: "team-a",
      regionName: "region-a",
      enterpriseId: "eid-1",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          team_name: "team-a",
          region_name: "region-a",
          app_id: "12",
          component_id: "svc-direct",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: {
        message: "把 MYSQL_HOST 改成 db.default，改完后帮我确认组件状态",
        stream: true,
      },
    });

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(initialStream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);

    const approvalId = initialStream.events[1].data.approval_id;
    await controller.decideApproval({
      actor,
      params: { approvalId },
      body: { decision: "approved", comment: "执行并继续" },
    });

    const resumedStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "3" },
    });

    expect(llmClient.chat).toHaveBeenCalledTimes(3);
    expect(llmClient.chat.mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          tool_calls: [
            expect.objectContaining({
              id: "tool_mutate_1",
              function: expect.objectContaining({
                name: "rainbond_manage_component_envs",
              }),
            }),
          ],
        }),
        expect.objectContaining({
          role: "tool",
          name: "rainbond_manage_component_envs",
          tool_call_id: "tool_mutate_1",
        }),
      ])
    );
    expect(resumedStream.events.at(-1)).toMatchObject({
      type: "run.status",
      data: { status: "done" },
    });
    expect(
      resumedStream.events.find((event) => event.type === "chat.message")?.data
    ).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("svc-direct"),
    });
  });

  it("resumes the llm loop after multiple approved actions so it can continue planning later steps", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_start_1",
              type: "function",
              function: {
                name: "rainbond_operate_app",
                arguments: JSON.stringify({
                  action: "start",
                }),
              },
            },
            {
              id: "tool_env_1",
              type: "function",
              function: {
                name: "rainbond_manage_component_envs",
                arguments: JSON.stringify({
                  operation: "upsert",
                  envs: [
                    {
                      name: "CC",
                      attr_name: "CC",
                      attr_value: "ff",
                    },
                  ],
                }),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_snapshot_1",
              type: "function",
              function: {
                name: "rainbond_create_app_version_snapshot",
                arguments: JSON.stringify({
                  version: "v1.0.3",
                }),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "三个步骤都已完成。",
          finish_reason: "stop",
        }),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_operate_app",
          description: "Operate app.",
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string" },
            },
          },
        },
        {
          name: "rainbond_manage_component_envs",
          description: "Manage component envs.",
          inputSchema: {
            type: "object",
            properties: {
              operation: { type: "string" },
              envs: { type: "array" },
            },
          },
        },
        {
          name: "rainbond_create_app_version_snapshot",
          description: "Create app version snapshot.",
          inputSchema: {
            type: "object",
            properties: {
              version: { type: "string" },
            },
          },
        },
      ]),
      callTool: vi.fn(async (name: string, input: Record<string, unknown>) => {
        if (name === "rainbond_operate_app") {
          return {
            isError: false,
            structuredContent: {
              action: "start",
              app_id: input.app_id,
            },
            content: [],
          };
        }

        if (name === "rainbond_manage_component_envs") {
          return {
            isError: false,
            structuredContent: {
              updated: true,
              service_id: input.service_id,
            },
            content: [],
          };
        }

        return {
          isError: false,
          structuredContent: {
            snapshot: {
              version: "v1.0.3",
            },
          },
          content: [],
        };
      }),
    };

    const controller = createCopilotController({
      llmClient,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "team-a",
      tenantName: "team-a",
      regionName: "region-a",
      enterpriseId: "eid-1",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          team_name: "team-a",
          region_name: "region-a",
          app_id: "134",
          component_id: "svc-direct",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: {
        message: "启动当前应用并添加环境变量CC=ff,最后建立一个新的快照",
        stream: true,
      },
    });

    const firstStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });
    const firstApprovalId = firstStream.events[1].data.approval_id;

    await controller.decideApproval({
      actor,
      params: { approvalId: firstApprovalId },
      body: { decision: "approved", comment: "先启动" },
    });

    const secondApprovalStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "3" },
    });
    const secondApprovalId = secondApprovalStream.events.find(
      (event) => event.type === "approval.requested"
    ).data.approval_id;

    await controller.decideApproval({
      actor,
      params: { approvalId: secondApprovalId },
      body: { decision: "approved", comment: "再改环境变量" },
    });

    const finalStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: String(secondApprovalStream.events.at(-1).sequence) },
    });

    expect(llmClient.chat).toHaveBeenCalledTimes(3);
    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_create_app_version_snapshot",
      expect.objectContaining({
        version: "v1.0.3",
      })
    );
    expect(finalStream.events.at(-1)).toMatchObject({
      type: "run.status",
      data: { status: "done" },
    });
  });

  it("routes snapshot rollback requests into approval with the resolved snapshot version id", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => []),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          items: [
            { version_id: 39, version: "1.0.3" },
            { version_id: 38, version: "1.0.2" },
            { version_id: 37, version: "1.0.1" },
          ],
          total: 3,
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "kz5igqh4",
      regionName: "rainbond",
      enterpriseId: "ent_123",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "ent_123",
          team_name: "kz5igqh4",
          region_name: "rainbond",
          app_id: "158",
          page: "/team/kz5igqh4/region/rainbond/apps/158/version",
        },
      },
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "回滚到1.0.2的快照版本", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(llmClient.chat).not.toHaveBeenCalled();
    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_list_app_version_snapshots",
      {
        team_name: "kz5igqh4",
        region_name: "rainbond",
        app_id: 158,
      }
    );
    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);
    expect(stream.events[1]).toMatchObject({
      type: "approval.requested",
      data: {
        description: "回滚当前应用到快照版本 1.0.2",
        risk: "high",
        level_label: "危险",
        scope: "app",
        scope_label: "应用级",
      },
    });
  });

  it("queues rollback-to-previous-version and close-app as pending approvals for version-center confirmation prompts", async () => {
    const sessionStore = createInMemorySessionStore();
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => []),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          items: [
            { version_id: 39, version: "1.0.3" },
            { version_id: 38, version: "1.0.2" },
            { version_id: 37, version: "1.0.1" },
          ],
          total: 3,
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
      sessionStore,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "kz5igqh4",
      regionName: "rainbond",
      enterpriseId: "ent_123",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "ent_123",
          team_name: "kz5igqh4",
          region_name: "rainbond",
          app_id: "158",
          page: "/team/kz5igqh4/region/rainbond/apps/158/version",
        },
      },
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "回滚快照到上一个版本后关闭整个应用", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);
    expect(stream.events[1]).toMatchObject({
      type: "approval.requested",
      data: {
        description: "回滚当前应用到快照版本 1.0.2",
      },
    });

    const storedSession = await controller.getSession({
      actor,
      params: { sessionId: session.data.session_id },
    });
    expect(storedSession.data.pending_workflow_action).toMatchObject({
      tool_name: "rainbond_rollback_app_version_snapshot",
      requires_approval: true,
      arguments: expect.objectContaining({
        version_id: 38,
      }),
    });
    const internalSession = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(internalSession?.pendingWorkflowAction?.followUpActions).toMatchObject([
      expect.objectContaining({
        toolName: "rainbond_operate_app",
        arguments: expect.objectContaining({
          action: "stop",
          app_id: 158,
        }),
      }),
    ]);
  });

  it("adds a generated k8s_app when creating a new app from a snapshot version", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "",
        tool_calls: [
          {
            id: "tool_snapshot_copy_1",
            type: "function",
            function: {
              name: "rainbond_create_app_from_snapshot_version",
              arguments: JSON.stringify({
                source_app_id: 158,
                version_id: 39,
                target_app_name: "demo-mcp",
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_create_app_from_snapshot_version",
          description: "Create a new app directly from a snapshot-generated hidden template.",
          inputSchema: {
            type: "object",
            properties: {
              source_app_id: { type: "integer" },
              version_id: { type: "integer" },
              target_app_name: { type: "string" },
            },
            required: ["source_app_id", "version_id", "target_app_name"],
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {},
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "kz5igqh4",
      regionName: "rainbond",
      enterpriseId: "ent_123",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "ent_123",
          team_name: "kz5igqh4",
          region_name: "rainbond",
          app_id: "158",
          page: "/team/kz5igqh4/region/rainbond/apps/158/version",
        },
      },
    });
    await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "基于1.0.3版本的快照新建一个demo-mcp的应用", stream: true },
    });

    const currentSession = await controller.getSession({
      actor,
      params: { sessionId: session.data.session_id },
    });
    const pendingAction = currentSession.data.pending_workflow_action as any;

    expect(pendingAction).toMatchObject({
      tool_name: "rainbond_create_app_from_snapshot_version",
      requires_approval: true,
      arguments: expect.objectContaining({
        team_name: "kz5igqh4",
        region_name: "rainbond",
        source_app_id: 158,
        version_id: 39,
        target_app_name: "demo-mcp",
      }),
    });
    expect(String(pendingAction.arguments.k8s_app)).toMatch(
      /^demo-mcp-[a-z0-9]{6}$/
    );
  });

  it("resolves component alias to service_id before queuing component env approvals", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "",
        tool_calls: [
          {
            id: "tool_component_env_1",
            type: "function",
            function: {
              name: "rainbond_manage_component_envs",
              arguments: JSON.stringify({
                operation: "upsert",
                attr_name: "VV",
                attr_value: "dd",
                name: "VV",
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_manage_component_envs",
          description: "Manage component environment variables.",
          inputSchema: {
            type: "object",
            properties: {
              operation: { type: "string" },
              attr_name: { type: "string" },
              attr_value: { type: "string" },
              name: { type: "string" },
            },
            required: ["operation"],
          },
        },
      ]),
      callTool: vi.fn(async (name: string) => {
        if (name === "rainbond_query_components") {
          return {
            isError: false,
            structuredContent: {
              items: [
                {
                  service_id: "svc-1",
                  service_alias: "backend",
                  service_cname: "backend",
                },
              ],
              total: 1,
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

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "kz5igqh4",
      regionName: "rainbond",
      enterpriseId: "8948f3fcf66e0cd91bf1045e8ca4a965",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          team_name: "kz5igqh4",
          region_name: "rainbond",
          app_id: "170",
          component_id: "backend",
          component_source: "route",
          page: "/team/kz5igqh4/region/rainbond/apps/170/overview",
        },
      },
    });
    await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "给当前组件添加环境变量 VV=dd", stream: true },
    });

    const currentSession = await controller.getSession({
      actor,
      params: { sessionId: session.data.session_id },
    });
    const pendingAction = currentSession.data.pending_workflow_action as any;

    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_query_components",
      {
        enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
        app_id: 170,
        query: "backend",
        page: 1,
        page_size: 20,
      }
    );
    expect(pendingAction).toMatchObject({
      tool_name: "rainbond_manage_component_envs",
      requires_approval: true,
      arguments: expect.objectContaining({
        operation: "upsert",
        service_id: "svc-1",
        attr_name: "VV",
        attr_value: "dd",
        name: "VV",
      }),
    });
  });

  it("refreshes the server-side session context when a new message carries a more specific context", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_component_1",
              type: "function",
              function: {
                name: "rainbond_get_component_summary",
                arguments: JSON.stringify({}),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "",
          finish_reason: "stop",
        }),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_get_component_summary",
          description: "Get an aggregated summary of the component.",
          inputSchema: {
            type: "object",
            properties: {
              team_name: { type: "string" },
              region_name: { type: "string" },
              app_id: { type: "integer" },
              service_id: { type: "string" },
            },
            required: ["team_name", "region_name", "app_id", "service_id"],
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          service: {
            component_name: "rainbond-copilot-dev",
            min_memory: 1024,
          },
          status: {
            status: "running",
          },
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "default",
      regionName: "rainbond",
      enterpriseId: "8948f3fcf66e0cd91bf1045e8ca4a965",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          team_name: "default",
          region_name: "rainbond",
        },
      },
    });

    await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: {
        message: "请查看当前组件状态",
        stream: true,
        context: {
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          team_name: "default",
          region_name: "rainbond",
          app_id: "134",
          component_id: "gr71871f",
          page: "/team/default/region/rainbond/apps/134/overview",
        },
      },
    });

    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_component_summary",
      expect.objectContaining({
        team_name: "default",
        region_name: "rainbond",
        app_id: 134,
        service_id: "gr71871f",
      })
    );
  });

  it("supports llm tool-calling for low-risk diagnosis", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_1",
              type: "function",
              function: {
                name: "get-component-status",
                arguments: JSON.stringify({ name: "backend-api" }),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "backend-api 当前运行正常，没有发现明显异常。",
          finish_reason: "stop",
        }),
    };
    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "请帮我检查 backend-api 状态", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(llmClient.chat).toHaveBeenCalledTimes(2);
    expect(llmClient.chat.mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          tool_calls: [
            expect.objectContaining({
              id: "tool_1",
              function: expect.objectContaining({
                name: "get-component-status",
              }),
            }),
          ],
        }),
        expect.objectContaining({
          role: "tool",
          name: "get-component-status",
          tool_call_id: "tool_1",
        }),
      ])
    );
    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "chat.trace",
      "chat.trace",
      "chat.message",
      "run.status",
    ]);
    expect(stream.events[3].data).toMatchObject({
      role: "assistant",
      content:
        "backend-api 当前运行正常，没有发现明显异常。\n\n基于本次查询结果：\nbackend-api 当前状态为 running，配置内存 1024MB。",
    });
  });

  it("exposes read-only rainbond mcp query tools to the llm and can answer with their results", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_query_1",
              type: "function",
              function: {
                name: "rainbond_get_component_summary",
                arguments: JSON.stringify({
                  team_name: "team-a",
                  region_name: "region-a",
                  app_id: 134,
                  service_id: "gr71871f",
                }),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "",
          finish_reason: "stop",
        }),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_get_component_summary",
          description: "Get an aggregated summary of the component.",
          inputSchema: {
            type: "object",
            properties: {
              team_name: { type: "string" },
              region_name: { type: "string" },
              app_id: { type: "integer" },
              service_id: { type: "string" },
            },
            required: ["team_name", "region_name", "app_id", "service_id"],
          },
        },
        {
          name: "rainbond_create_app",
          description: "Create application",
          inputSchema: {
            type: "object",
            properties: {
              app_name: { type: "string" },
            },
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          service: {
            component_name: "rainbond-copilot-dev",
            min_memory: 1024,
          },
          status: {
            status: "running",
          },
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "请你查看 rainbond-copilot-dev 组件的状态", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(queryToolClient.listTools).toHaveBeenCalledTimes(1);
    expect(llmClient.chat.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({
            name: "rainbond_get_component_summary",
          }),
        }),
      ])
    );
    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_component_summary",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 134,
        service_id: "gr71871f",
      }
    );
    expect(stream.events[3].data).toMatchObject({
      role: "assistant",
      content: "当前组件 rainbond-copilot-dev 状态为 running，当前配置内存 1024MB。",
    });
  });

  it.skip("routes current-component close confirmations to approval directly from session context", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => []),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          app_id: 134,
          action: "stop",
          service_ids: ["gr71871f"],
          result: [{ service_id: "gr71871f" }],
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "default",
      regionName: "rainbond",
      enterpriseId: "8948f3fcf66e0cd91bf1045e8ca4a965",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          team_name: "default",
          region_name: "rainbond",
          app_id: "134",
          component_id: "gr71871f",
          component_source: "query",
          resource: {
            type: "component",
            id: "gr71871f",
            name: "gr71871f",
          },
          page: "/team/default/region/rainbond/apps/134/overview",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "确认关闭", stream: true },
    });

    expect(llmClient.chat).not.toHaveBeenCalled();

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(initialStream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);

    const approvalId = initialStream.events[1].data.approval_id;
    await controller.decideApproval({
      actor,
      params: { approvalId },
      body: { decision: "approved", comment: "确认关闭" },
    });

    const resumedStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "3" },
    });

    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_operate_app",
      {
        team_name: "default",
        region_name: "rainbond",
        app_id: 134,
        action: "stop",
        service_ids: ["gr71871f"],
      }
    );
    expect(
      resumedStream.events.find((event) => event.type === "chat.message")?.data
    ).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("gr71871f"),
    });
  });

  it.skip("routes current-component delete intents to approval directly from session context", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => []),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          deleted: true,
          service_id: "gr71871f",
          service_cname: "rainbond-copilot-dev",
          app_id: 134,
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "default",
      regionName: "rainbond",
      enterpriseId: "8948f3fcf66e0cd91bf1045e8ca4a965",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          team_name: "default",
          region_name: "rainbond",
          app_id: "134",
          component_id: "gr71871f",
          component_source: "query",
          resource: {
            type: "component",
            id: "gr71871f",
            name: "gr71871f",
          },
          page: "/team/default/region/rainbond/apps/134/overview",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "删除当前组件", stream: true },
    });

    expect(llmClient.chat).not.toHaveBeenCalled();

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(initialStream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);

    const approvalId = initialStream.events[1].data.approval_id;
    await controller.decideApproval({
      actor,
      params: { approvalId },
      body: { decision: "approved", comment: "确认删除" },
    });

    const resumedStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "3" },
    });

    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_delete_component",
      {
        team_name: "default",
        region_name: "rainbond",
        app_id: 134,
        service_id: "gr71871f",
      }
    );
    expect(
      resumedStream.events.find((event) => event.type === "chat.message")?.data
    ).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("rainbond-copilot-dev"),
    });
  });

  it.skip("routes current-component memory scaling intents to approval directly from session context", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => []),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          scaled: true,
          service_id: "gr71871f",
          new_memory: 2048,
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "default",
      regionName: "rainbond",
      enterpriseId: "8948f3fcf66e0cd91bf1045e8ca4a965",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          team_name: "default",
          region_name: "rainbond",
          app_id: "134",
          component_id: "gr71871f",
          component_source: "query",
          resource: {
            type: "component",
            id: "gr71871f",
            name: "gr71871f",
          },
          page: "/team/default/region/rainbond/apps/134/overview",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "把当前组件内存调整到 2048MB", stream: true },
    });

    expect(llmClient.chat).not.toHaveBeenCalled();

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(initialStream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);

    const approvalId = initialStream.events[1].data.approval_id;
    await controller.decideApproval({
      actor,
      params: { approvalId },
      body: { decision: "approved", comment: "确认扩容" },
    });

    const resumedStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "3" },
    });

    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_vertical_scale_component",
      {
        team_name: "default",
        region_name: "rainbond",
        app_id: 134,
        service_id: "gr71871f",
        new_memory: 2048,
      }
    );
    expect(
      resumedStream.events.find((event) => event.type === "chat.message")?.data
    ).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("2048MB"),
    });
  });

  it.skip("routes current-component image change intents to approval directly from session context", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => []),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          image: "nginx:1.27",
          service_id: "gr71871f",
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "default",
      regionName: "rainbond",
      enterpriseId: "8948f3fcf66e0cd91bf1045e8ca4a965",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          team_name: "default",
          region_name: "rainbond",
          app_id: "134",
          component_id: "gr71871f",
          component_source: "query",
          resource: {
            type: "component",
            id: "gr71871f",
            name: "gr71871f",
          },
          page: "/team/default/region/rainbond/apps/134/overview",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "把当前组件镜像改成 nginx:1.27", stream: true },
    });

    expect(llmClient.chat).not.toHaveBeenCalled();

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(initialStream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);

    const approvalId = initialStream.events[1].data.approval_id;
    await controller.decideApproval({
      actor,
      params: { approvalId },
      body: { decision: "approved", comment: "确认改镜像" },
    });

    const resumedStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "3" },
    });

    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_change_component_image",
      {
        team_name: "default",
        region_name: "rainbond",
        app_id: 134,
        service_id: "gr71871f",
        image: "nginx:1.27",
      }
    );
    expect(
      resumedStream.events.find((event) => event.type === "chat.message")?.data
    ).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("nginx:1.27"),
    });
  });

  it.skip("routes current-component port operations to approval directly from session context", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => []),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          container_port: 8080,
          service_id: "gr71871f",
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "default",
      regionName: "rainbond",
      enterpriseId: "8948f3fcf66e0cd91bf1045e8ca4a965",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          team_name: "default",
          region_name: "rainbond",
          app_id: "134",
          component_id: "gr71871f",
          component_source: "query",
          resource: {
            type: "component",
            id: "gr71871f",
            name: "gr71871f",
          },
          page: "/team/default/region/rainbond/apps/134/overview",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "开启当前组件对内端口 8080", stream: true },
    });

    expect(llmClient.chat).not.toHaveBeenCalled();

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(initialStream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);

    const approvalId = initialStream.events[1].data.approval_id;
    await controller.decideApproval({
      actor,
      params: { approvalId },
      body: { decision: "approved", comment: "确认开端口" },
    });

    const resumedStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "3" },
    });

    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_manage_component_ports",
      {
        team_name: "default",
        region_name: "rainbond",
        app_id: 134,
        service_id: "gr71871f",
        operation: "enable_inner",
        port: 8080,
      }
    );
    expect(
      resumedStream.events.find((event) => event.type === "chat.message")?.data
    ).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("8080"),
    });
  });

  it.skip("routes current-component connection env creation to approval directly from session context", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => []),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          created: true,
          service_id: "gr71871f",
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: ["app_admin"],
      tenantName: "default",
      regionName: "rainbond",
      enterpriseId: "8948f3fcf66e0cd91bf1045e8ca4a965",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          team_name: "default",
          region_name: "rainbond",
          app_id: "134",
          component_id: "gr71871f",
          component_source: "query",
          resource: {
            type: "component",
            id: "gr71871f",
            name: "gr71871f",
          },
          page: "/team/default/region/rainbond/apps/134/overview",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "给当前组件添加连接信息 MYSQL_HOST=db.default", stream: true },
    });

    expect(llmClient.chat).not.toHaveBeenCalled();

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(initialStream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);

    const approvalId = initialStream.events[1].data.approval_id;
    await controller.decideApproval({
      actor,
      params: { approvalId },
      body: { decision: "approved", comment: "确认添加连接信息" },
    });

    const resumedStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "3" },
    });

    expect(queryToolClient.callTool).toHaveBeenCalledWith(
      "rainbond_manage_component_connection_envs",
      {
        team_name: "default",
        region_name: "rainbond",
        app_id: 134,
        service_id: "gr71871f",
        operation: "create",
        attr_name: "MYSQL_HOST",
        attr_value: "db.default",
      }
    );
    expect(
      resumedStream.events.find((event) => event.type === "chat.message")?.data
    ).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("MYSQL_HOST"),
    });
  });

  it("summarizes current user query results with the returned user information", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_user_1",
              type: "function",
              function: {
                name: "rainbond_get_current_user",
                arguments: JSON.stringify({}),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "已完成 rainbond_get_current_user 查询。这是我查询个人信息后，得到的内容。",
          finish_reason: "stop",
        }),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_get_current_user",
          description: "Get current authenticated user information.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          user_id: 1,
          nick_name: "admin",
          real_name: "",
          email: "admin@admin.com",
          enterprise_id: "8948f3fcf66e0cd91bf1045e8ca4a965",
          is_enterprise_admin: true,
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "请查询当前登录用户信息", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events[3].data).toMatchObject({
      role: "assistant",
      content:
        "当前登录用户是 admin，邮箱 admin@admin.com，企业 ID 8948f3fcf66e0cd91bf1045e8ca4a965，当前具有企业管理员权限。",
    });
  });

  it("appends result-grounded detail when the llm reply is too generic for list queries", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_list_1",
              type: "function",
              function: {
                name: "rainbond_query_components",
                arguments: JSON.stringify({
                  enterprise_id: "eid-1",
                  app_id: 134,
                }),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "以下是查询结果。",
          finish_reason: "stop",
        }),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_query_components",
          description: "Query components under the specified application.",
          inputSchema: {
            type: "object",
            properties: {
              enterprise_id: { type: "string" },
              app_id: { type: "integer" },
            },
            required: ["enterprise_id", "app_id"],
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          items: [
            {
              service_alias: "rainbond-copilot-dev",
            },
            {
              service_alias: "rainbond-copilot-api",
            },
          ],
          total: 2,
        },
        content: [],
      })),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "请帮我查询当前应用的组件列表", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events[3].data).toMatchObject({
      role: "assistant",
      content:
        "已查询组件列表，当前返回 2 条记录，前几项包括：rainbond-copilot-dev、rainbond-copilot-api。",
    });
  });

  it("deduplicates repeated component queries and answers with a combined component info summary", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_detail_1",
              type: "function",
              function: {
                name: "rainbond_get_component_detail",
                arguments: JSON.stringify({
                  team_name: "team-a",
                  region_name: "region-a",
                  app_id: 134,
                  service_id: "gr71871f",
                }),
              },
            },
            {
              id: "tool_summary_1",
              type: "function",
              function: {
                name: "rainbond_get_component_summary",
                arguments: JSON.stringify({
                  team_name: "team-a",
                  region_name: "region-a",
                  app_id: 134,
                  service_id: "gr71871f",
                }),
              },
            },
            {
              id: "tool_detail_2",
              type: "function",
              function: {
                name: "rainbond_get_component_detail",
                arguments: JSON.stringify({
                  team_name: "team-a",
                  region_name: "region-a",
                  app_id: 134,
                  service_id: "gr71871f",
                }),
              },
            },
            {
              id: "tool_summary_2",
              type: "function",
              function: {
                name: "rainbond_get_component_summary",
                arguments: JSON.stringify({
                  team_name: "team-a",
                  region_name: "region-a",
                  app_id: 134,
                  service_id: "gr71871f",
                }),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "以下是查询结果。",
          finish_reason: "stop",
        }),
    };

    const queryToolClient = {
      listTools: vi.fn(async () => [
        {
          name: "rainbond_get_component_detail",
          description: "Get component detail.",
          inputSchema: {
            type: "object",
            properties: {
              team_name: { type: "string" },
              region_name: { type: "string" },
              app_id: { type: "integer" },
              service_id: { type: "string" },
            },
            required: ["team_name", "region_name", "app_id", "service_id"],
          },
        },
        {
          name: "rainbond_get_component_summary",
          description: "Get component summary.",
          inputSchema: {
            type: "object",
            properties: {
              team_name: { type: "string" },
              region_name: { type: "string" },
              app_id: { type: "integer" },
              service_id: { type: "string" },
            },
            required: ["team_name", "region_name", "app_id", "service_id"],
          },
        },
      ]),
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            component_name: "rainbond-copilot-dev",
            service_alias: "gr71871f",
            status: "",
            access_infos: [{ url: "http://demo.example.com" }],
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            service: {
              component_name: "rainbond-copilot-dev",
              min_memory: 512,
              access_infos: [{ url: "http://demo.example.com" }],
            },
            status: {
              status: "running",
            },
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
      queryToolClientFactory: async () => queryToolClient as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "查询当前组件的相关信息", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(queryToolClient.callTool).toHaveBeenCalledTimes(2);
    expect(stream.events[5].data).toMatchObject({
      role: "assistant",
      content:
        "当前组件 rainbond-copilot-dev 状态为 running，当前配置内存 512MB。 当前可访问地址 http://demo.example.com。",
    });
  });

  it("synthesizes a result-based assistant reply when the llm follow-up content is empty", async () => {
    const llmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            {
              id: "tool_1",
              type: "function",
              function: {
                name: "get-component-status",
                arguments: JSON.stringify({ name: "rainbond-copilot-dev" }),
              },
            },
          ],
          finish_reason: "tool_calls",
        })
        .mockResolvedValueOnce({
          content: "",
          finish_reason: "stop",
        }),
    };

    const controller = createCopilotController({
      llmClient,
      actionAdapter: mockActionAdapter as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "请你查看 rainbond-copilot-dev 组件的状态", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events[3].data).toMatchObject({
      role: "assistant",
      content: "rainbond-copilot-dev 当前状态为 running，配置内存 1024MB。",
    });
  });

  it("emits an approval lifecycle for high-risk restart requests", async () => {
    const controller = createCopilotController();
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "restart frontend-ui", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(stream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);
    expect(stream.events.at(-1)).toMatchObject({
      type: "run.status",
      data: { status: "waiting_approval" },
    });
  });

  it("executes an approved high-risk restart request through the action adapter", async () => {
    const actionAdapter = {
      getComponentStatus: vi.fn(async () => ({
        name: "frontend-ui",
        status: "running",
        memory: 1024,
      })),
      getComponentLogs: vi.fn(async () => ({
        name: "frontend-ui",
        logs: [],
      })),
      restartComponent: vi.fn(async (input: { name: string }) => ({
        name: input.name,
        status: "running",
      })),
      scaleComponentMemory: vi.fn(async () => ({
        name: "frontend-ui",
        memory: 1024,
      })),
    };

    const controller = createCopilotController({
      actionAdapter: actionAdapter as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "restart frontend-ui", stream: true },
    });

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    const approvalId = initialStream.events[1].data.approval_id;
    await controller.decideApproval({
      actor,
      params: { approvalId },
      body: { decision: "approved", comment: "确认重启" },
    });

    const resumedStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "3" },
    });

    expect(actionAdapter.restartComponent).toHaveBeenCalledWith({
      name: "frontend-ui",
    });
    expect(resumedStream.events.map((event) => event.type)).toEqual([
      "approval.resolved",
      "chat.trace",
      "chat.trace",
      "chat.message",
      "workflow.completed",
      "run.status",
    ]);
    expect(resumedStream.events[3].data).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("frontend-ui"),
    });
  });

  it("uses an injected action adapter for low-risk execution", async () => {
    const actionAdapter = {
      getComponentStatus: vi.fn(async () => ({
        name: "api",
        status: "running",
        memory: 2048,
      })),
      getComponentLogs: vi.fn(async () => ({
        name: "api",
        logs: ["ok"],
      })),
      restartComponent: vi.fn(async () => ({
        name: "api",
        status: "running",
      })),
      scaleComponentMemory: vi.fn(async () => ({
        name: "api",
        memory: 2048,
      })),
    };

    const controller = createCopilotController({
      llmClient: null,
      actionAdapter: actionAdapter as any,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "check api status", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(actionAdapter.getComponentStatus).toHaveBeenCalled();
    expect(stream.events.at(-2)).toMatchObject({
      type: "chat.message",
      data: {
        role: "assistant",
        content: expect.stringContaining("api 当前状态为 running"),
      },
    });
  });

  it("uses a per-request actionAdapterFactory when provided", async () => {
    const actionAdapter = {
      getComponentStatus: vi.fn(async () => ({
        name: "api",
        status: "running",
        memory: 1024,
      })),
      getComponentLogs: vi.fn(async () => ({
        name: "api",
        logs: [],
      })),
      restartComponent: vi.fn(async () => ({
        name: "api",
        status: "running",
      })),
      scaleComponentMemory: vi.fn(async () => ({
        name: "api",
        memory: 1024,
      })),
    };
    const actionAdapterFactory = vi.fn(async () => actionAdapter);

    const controller = createCopilotController({
      llmClient: null,
      actionAdapterFactory,
    });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });
    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "check api status", stream: true },
    });

    await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(actionAdapterFactory).toHaveBeenCalledWith({
      actor,
      sessionId: session.data.session_id,
    });
    expect(actionAdapter.getComponentStatus).toHaveBeenCalled();
  });
});
