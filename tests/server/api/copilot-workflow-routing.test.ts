// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createCopilotController as createBaseCopilotController } from "../../../src/server/controllers/copilot-controller";
import { createInMemoryRunStore } from "../../../src/server/stores/run-store";
import { createInMemorySessionStore } from "../../../src/server/stores/session-store";

function createCopilotController(deps: Record<string, unknown> = {}) {
  return createBaseCopilotController({
    enableRainbondAppAssistantWorkflow: true,
    ...deps,
  });
}

describe("copilot workflow routing", () => {
  it("does not auto-route workflow prompts when rainbond app assistant workflow is disabled", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "暂不进入流程，直接按普通对话处理。",
        finish_reason: "stop",
      })),
    };

    const controller = createBaseCopilotController({
      llmClient,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "134",
          team_name: "team-a",
          region_name: "region-a",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "给这个应用创建一个快照", stream: true },
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
    expect(stream.events.map((event) => event.type)).not.toContain("workflow.selected");
    expect(stream.events.map((event) => event.type)).not.toContain("workflow.completed");
  });

  it("routes capability-style prompts into the workflow capability summary instead of the legacy llm skill list", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };

    const controller = createCopilotController({
      llmClient,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {},
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "你能做什么，有哪些流程？", stream: true },
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
    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        workflow_id: "rainbond-app-assistant",
        workflow_stage: "report",
        next_action: "describe_capabilities",
        structured_result: expect.objectContaining({
          summary: expect.stringContaining("rainbond-template-installer"),
        }),
      },
    });
  });

  it("routes deployment-style prompts into rainbond-app-assistant", async () => {
    const sessionStore = createInMemorySessionStore();
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "running",
            running_service_count: 2,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                service_id: "svc-1",
                service_alias: "api",
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
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
        }),
    };

    const controller = createCopilotController({
      llmClient,
      sessionStore,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我把这个项目在 Rainbond 上跑起来", stream: true },
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
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_app_detail",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
      }
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_query_components",
      {
        enterprise_id: "eid-1",
        app_id: 1,
        page: 1,
        page_size: 20,
      }
    );
    expect(stream.events.map((event) => event.type)).toContain("workflow.selected");
    expect(stream.events.map((event) => event.type)).toContain("workflow.stage");
    expect(stream.events.map((event) => event.type)).toContain("workflow.completed");
    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        workflow_id: "rainbond-app-assistant",
        workflow_stage: "select-subflow",
        next_action: "bootstrap_topology",
        structured_result: expect.objectContaining({
          subflowData: {
            appStatus: "running",
            componentCount: 1,
            inspectedComponentStatus: "running",
            runtimeState: "runtime_healthy",
          },
          tool_calls: [
            { name: "rainbond_get_app_detail", status: "success" },
            { name: "rainbond_query_components", status: "success" },
            { name: "rainbond_get_component_summary", status: "success" },
          ],
        }),
      },
    });
    expect(stream.events.at(-1)).toMatchObject({
      type: "run.status",
      data: { status: "done" },
    });

    const storedSession = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(storedSession?.lastVerifiedScopeSignature).toBe(
      "team-a|region-a|app-001||verified"
    );
    expect(storedSession?.verifiedScope).toMatchObject({
      teamName: "team-a",
      regionName: "region-a",
      appId: "app-001",
      verified: true,
    });
    expect(storedSession?.pendingWorkflowAction).toBeUndefined();
  });

  it.skip("routes template-install prompts into the template installer subflow", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            enterprise_id: "eid-1",
            items: [
              {
                app_model_id: "model-1",
              },
            ],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            enterprise_id: "eid-1",
            source: "local",
            app_model: { app_model_id: "model-1", app_model_name: "demo-app" },
            items: [{ version: "1.0.0" }, { version: "1.1.0" }],
            total: 1,
            page: 1,
            page_size: 20,
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我把这个模板安装到当前应用", stream: true },
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
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_query_local_app_models",
      expect.objectContaining({
        enterprise_id: "eid-1",
      })
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_query_app_model_versions",
      {
        enterprise_id: "eid-1",
        source: "local",
        app_model_id: "model-1",
        page: 1,
        page_size: 20,
      }
    );
    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        workflow_id: "rainbond-app-assistant",
        workflow_stage: "select-subflow",
        next_action: "install_template",
        structured_result: expect.objectContaining({
          selectedWorkflow: "rainbond-template-installer",
          tool_calls: [
            { name: "rainbond_query_local_app_models", status: "success" },
            { name: "rainbond_query_app_model_versions", status: "success" },
          ],
          subflowData: {
            appModelId: "model-1",
            versionCount: 2,
            appModelName: "demo-app",
            latestVersion: "1.1.0",
            proposedToolAction: {
              toolName: "rainbond_install_app_model",
              requiresApproval: true,
              arguments: {
                team_name: "team-a",
                region_name: "region-a",
                app_id: 1,
                source: "local",
                app_model_id: "model-1",
                app_model_version: "1.1.0",
                is_deploy: true,
              },
            },
          },
        }),
      },
    });

    const storedSession = await controller.getSession({
      actor,
      params: { sessionId: session.data.session_id },
    });
    expect(storedSession.data.pending_workflow_action).toMatchObject({
      tool_name: "rainbond_install_app_model",
      requires_approval: true,
    });
  });

  it.skip("proposes image-based component creation for bootstrap when the current app has no components", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "closed",
            running_service_count: 0,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [],
            total: 0,
            page: 1,
            page_size: 20,
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我把 nginx:latest 作为 web 组件部署到当前应用", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        structured_result: expect.objectContaining({
          subflowData: expect.objectContaining({
            componentCount: 0,
            proposedToolAction: {
              toolName: "rainbond_create_component_from_image",
              requiresApproval: true,
              arguments: {
                team_name: "team-a",
                region_name: "region-a",
                app_id: 1,
                service_cname: "web",
                image: "nginx:latest",
                is_deploy: true,
              },
            },
          }),
        }),
      },
    });
  });

  it.skip("proposes source-based component creation for bootstrap when the message includes a git repository", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "closed",
            running_service_count: 0,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [],
            total: 0,
            page: 1,
            page_size: 20,
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: {
        message:
          "帮我把 https://gitee.com/rainbond/demo-2048.git 作为 api 组件部署到当前应用",
        stream: true,
      },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        structured_result: expect.objectContaining({
          subflowData: expect.objectContaining({
            componentCount: 0,
            proposedToolAction: {
              toolName: "rainbond_create_component_from_source",
              requiresApproval: true,
              arguments: {
                team_name: "team-a",
                region_name: "region-a",
                app_id: 1,
                code_from: "git",
                service_cname: "api",
                git_url: "https://gitee.com/rainbond/demo-2048.git",
                code_version: "master",
                is_deploy: true,
              },
            },
          }),
        }),
      },
    });
  });

  it.skip("proposes local-package component creation for bootstrap when the message includes a local package path", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "closed",
            running_service_count: 0,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [],
            total: 0,
            page: 1,
            page_size: 20,
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: {
        message: "帮我把 /tmp/demo-app.zip 作为 demo-app 组件部署到当前应用",
        stream: true,
      },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        structured_result: expect.objectContaining({
          subflowData: expect.objectContaining({
            componentCount: 0,
            proposedToolAction: {
              toolName: "rainbond_create_component_from_local_package",
              requiresApproval: true,
              arguments: {
                team_name: "team-a",
                region_name: "region-a",
                app_id: 1,
                local_path: "/tmp/demo-app.zip",
                service_cname: "demo-app",
                is_deploy: true,
              },
            },
          }),
        }),
      },
    });
  });

  it("proposes helm validation for bootstrap when the message includes helm chart details", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "closed",
            running_service_count: 0,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [],
            total: 0,
            page: 1,
            page_size: 20,
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: {
        message: "帮我安装 helm repo bitnami chart wordpress version 1.0.0 到当前应用",
        stream: true,
      },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        structured_result: expect.objectContaining({
          subflowData: expect.objectContaining({
            componentCount: 0,
            appStatus: "closed",
          }),
        }),
      },
    });
  });

  it.skip("routes cloud-template install prompts into the cloud template installer path", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [{ name: "RainbondMarket" }],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [{ app_id: "cloud-model-1", app_name: "Redis" }],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_model: { app_model_id: "cloud-model-1", app_model_name: "Redis" },
            items: [{ version: "6.0.0" }, { version: "6.2.0" }],
            total: 2,
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我把这个云市场模板安装到当前应用", stream: true },
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
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_query_cloud_markets",
      {
        enterprise_id: "eid-1",
        page: 1,
        page_size: 20,
      }
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_query_cloud_app_models",
      {
        enterprise_id: "eid-1",
        market_name: "RainbondMarket",
        page: 1,
        page_size: 20,
      }
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_query_app_model_versions",
      {
        enterprise_id: "eid-1",
        source: "cloud",
        market_name: "RainbondMarket",
        app_model_id: "cloud-model-1",
        page: 1,
        page_size: 20,
      }
    );
    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        structured_result: expect.objectContaining({
          subflowData: expect.objectContaining({
            marketName: "RainbondMarket",
            appModelId: "cloud-model-1",
            appModelName: "Redis",
            latestVersion: "6.2.0",
            proposedToolAction: {
              toolName: "rainbond_install_app_model",
              requiresApproval: true,
              arguments: {
                team_name: "team-a",
                region_name: "region-a",
                app_id: 1,
                source: "cloud",
                market_name: "RainbondMarket",
                app_model_id: "cloud-model-1",
                app_model_version: "6.2.0",
                is_deploy: true,
              },
            },
          }),
        }),
      },
    });
  });

  it.skip("proposes creating a target app first when template-install context has no app_id", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            enterprise_id: "eid-1",
            items: [
              {
                app_model_id: "model-1",
              },
            ],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            enterprise_id: "eid-1",
            source: "local",
            app_model: { app_model_id: "model-1", app_model_name: "demo-app" },
            items: [{ version: "1.0.0" }, { version: "1.1.0" }],
            total: 2,
            page: 1,
            page_size: 20,
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/index",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我把这个模板安装到新应用", stream: true },
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
    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        structured_result: expect.objectContaining({
          subflowData: expect.objectContaining({
            proposedToolAction: {
              toolName: "rainbond_create_app",
              requiresApproval: true,
              arguments: {
                team_name: "team-a",
                region_name: "region-a",
                app_name: "demo-app",
              },
            },
          }),
        }),
      },
    });
  });

  it("routes version-center inspection prompts into the app version assistant subflow", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            overview: {
              current_version: "v1.0.0",
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            has_template: true,
            items: [{ version_id: 100, version: "v1.0.0" }],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            detail: {
              version_id: 100,
              version: "v1.0.0",
              services: [{ service_id: "svc-1" }],
            },
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001/version",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我查看版本中心", stream: true },
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
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_app_version_overview",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
      }
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_list_app_version_snapshots",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
      }
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_app_version_snapshot_detail",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
        version_id: 100,
      }
    );
    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        next_action: "run_version_flow",
        structured_result: expect.objectContaining({
          selectedWorkflow: "rainbond-app-version-assistant",
          tool_calls: [
            { name: "rainbond_get_app_version_overview", status: "success" },
            { name: "rainbond_list_app_version_snapshots", status: "success" },
            { name: "rainbond_get_app_version_snapshot_detail", status: "success" },
          ],
          subflowData: {
            currentVersion: "v1.0.0",
            snapshotCount: 1,
            latestSnapshotVersion: "v1.0.0",
            latestSnapshotServiceCount: 1,
          },
        }),
      },
    });

    const storedSession = await controller.getSession({
      actor,
      params: { sessionId: session.data.session_id },
    });
    expect(storedSession.data.pending_workflow_action).toBeNull();
  });

  it("routes delivery-acceptance prompts into the delivery verifier subflow", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "running",
            running_service_count: 2,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                service_id: "svc-1",
                service_alias: "api",
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
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
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我验证这个应用是否已经交付完成", stream: true },
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
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_app_detail",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
      }
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_query_components",
      {
        enterprise_id: "eid-1",
        app_id: 1,
        page: 1,
        page_size: 20,
      }
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_component_summary",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
        service_id: "svc-1",
      }
    );
    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        next_action: "verify_delivery",
        structured_result: expect.objectContaining({
          subflowData: {
            appStatus: "running",
            componentCount: 1,
            inspectedComponentStatus: "running",
            runtimeState: "runtime_healthy",
            deliveryState: "delivered-but-needs-manual-validation",
          },
          selectedWorkflow: "rainbond-delivery-verifier",
          tool_calls: [
            { name: "rainbond_get_app_detail", status: "success" },
            { name: "rainbond_query_components", status: "success" },
            { name: "rainbond_get_component_summary", status: "success" },
          ],
        }),
      },
    });
  });

  it.skip("executes snapshot creation directly when the user explicitly asks to create a snapshot", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            overview: {
              current_version: "v1.0.0",
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                version_id: 100,
                version: "v1.0.0",
              },
            ],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            detail: {
              services: [{ service_id: "svc-1" }],
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            snapshot: {
              version: "v1.0.1",
            },
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001/version",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我创建快照", stream: true },
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
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_create_app_version_snapshot",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
      }
    );
    const completed = stream.events.find((event) => event.type === "workflow.completed");
    expect(completed?.data.workflow_stage).toBe("select-subflow");
    expect(completed?.data.structured_result.summary).toBe(
      "已创建应用快照 v1.0.1，可以继续执行发布或回滚。"
    );
    expect(completed?.data.structured_result.executedAction).toMatchObject({
      toolName: "rainbond_create_app_version_snapshot",
    });
  });

  it("creates a snapshot after the user replies with a version number for a pending snapshot intent", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            overview: {
              current_version: "v1.0.2",
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                version_id: 100,
                version: "v1.0.2",
              },
              {
                version_id: 99,
                version: "v1.0.1",
              },
            ],
            total: 2,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            detail: {
              services: [{ service_id: "svc-1" }],
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            snapshot: {
              version: "v1.0.3",
            },
          },
          content: [],
        }),
    };

    const sessionStore = createInMemorySessionStore();
    const runStore = createInMemoryRunStore();
    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
      sessionStore,
      runStore,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001/version",
        },
      },
    });

    const initialRun = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我创建快照", stream: true },
    });

    const pendingSession = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(pendingSession?.pendingWorkflowAction).toMatchObject({
      toolName: "rainbond_create_app_version_snapshot",
      requiresApproval: false,
      arguments: expect.objectContaining({
        app_id: 1,
      }),
    });
    const deferredRun = await runStore.getById(initialRun.data.run_id, actor.tenantId);
    expect(deferredRun?.executionState?.deferredAction).toMatchObject({
      toolName: "rainbond_create_app_version_snapshot",
      missingArgument: "version",
      suggestedValue: "v1.0.3",
      arguments: expect.objectContaining({
        app_id: 1,
      }),
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "v1.0.3", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_create_app_version_snapshot",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
        version: "v1.0.3",
      }
    );
    const completed = stream.events.find((event) => event.type === "workflow.completed");
    expect(completed?.data.structured_result.summary).toBe(
      "已创建应用快照 v1.0.3，可以继续执行发布或回滚。"
    );
  });

  it("updates the pending template install action when the user replies with a target version", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi.fn(async (toolName: string) => {
        if (toolName === "rainbond_query_local_app_models") {
          return {
            isError: false,
            structuredContent: {
              enterprise_id: "eid-1",
              items: [{ app_model_id: "model-1" }],
              total: 1,
            },
            content: [],
          };
        }
        if (toolName === "rainbond_query_app_model_versions") {
          return {
            isError: false,
            structuredContent: {
              enterprise_id: "eid-1",
              source: "local",
              app_model: { app_model_id: "model-1", app_model_name: "demo-app" },
              items: [{ version: "1.0.0" }, { version: "1.1.0" }],
              total: 1,
              page: 1,
              page_size: 20,
            },
            content: [],
          };
        }
        throw new Error(`Unexpected tool call ${toolName}`);
      }),
    };
    const sessionStore = createInMemorySessionStore();
    const runStore = createInMemoryRunStore();

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
      sessionStore,
      runStore,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const initialRun = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我把这个模板安装到当前应用", stream: true },
    });

    const pendingSession = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(pendingSession?.pendingWorkflowAction).toMatchObject({
      toolName: "rainbond_install_app_model",
      requiresApproval: true,
      arguments: expect.objectContaining({
        app_model_version: "1.1.0",
      }),
    });
    const deferredRun = await runStore.getById(initialRun.data.run_id, actor.tenantId);
    expect(deferredRun?.executionState?.deferredAction).toMatchObject({
      toolName: "rainbond_install_app_model",
      missingArgument: "app_model_version",
      suggestedValue: "1.1.0",
      arguments: expect.objectContaining({
        app_model_id: "model-1",
      }),
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "1.0.0", stream: true },
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
    const updatedSession = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(updatedSession?.pendingWorkflowAction).toMatchObject({
      toolName: "rainbond_install_app_model",
      arguments: expect.objectContaining({
        app_model_version: "1.0.0",
      }),
    });
  });

  it("resolves a rollback target version from user input before requesting approval", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi.fn(async (toolName: string) => {
        if (toolName === "rainbond_get_app_version_overview") {
          return {
            isError: false,
            structuredContent: {
              overview: {
                current_version: "v1.0.2",
              },
            },
            content: [],
          };
        }
        if (toolName === "rainbond_list_app_version_snapshots") {
          return {
            isError: false,
            structuredContent: {
              items: [
                { version_id: 100, version: "v1.0.2" },
                { version_id: 99, version: "v1.0.1" },
              ],
              total: 2,
            },
            content: [],
          };
        }
        if (toolName === "rainbond_get_app_version_snapshot_detail") {
          return {
            isError: false,
            structuredContent: {
              detail: {
                services: [{ service_id: "svc-1" }],
              },
            },
            content: [],
          };
        }
        throw new Error(`Unexpected tool call ${toolName}`);
      }),
    };
    const sessionStore = createInMemorySessionStore();
    const runStore = createInMemoryRunStore();

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
      queryToolClientFactory: async () => workflowClient as any,
      sessionStore,
      runStore,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001/version",
        },
      },
    });

    const initialRun = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我回滚快照", stream: true },
    });

    const pendingSession = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(pendingSession?.pendingWorkflowAction).toMatchObject({
      toolName: "rainbond_rollback_app_version_snapshot",
      requiresApproval: true,
      arguments: expect.objectContaining({
        __await_version_input: true,
      }),
    });
    const deferredRun = await runStore.getById(initialRun.data.run_id, actor.tenantId);
    expect(deferredRun?.executionState?.deferredAction).toMatchObject({
      toolName: "rainbond_rollback_app_version_snapshot",
      missingArgument: "version_id",
      suggestedValue: "v1.0.1",
      resolutionTool: expect.objectContaining({
        toolName: "rainbond_list_app_version_snapshots",
      }),
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "v1.0.1", stream: true },
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
    const updatedSession = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(updatedSession?.pendingWorkflowAction).toMatchObject({
      toolName: "rainbond_rollback_app_version_snapshot",
      arguments: expect.objectContaining({
        version_id: 99,
      }),
    });
  });

  it.skip("executes snapshot publish directly when the user explicitly asks to create a snapshot and publish it", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            overview: {
              current_version: "v1.0.0",
              template_id: "hidden-template-id",
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                version_id: 100,
                version: "v1.0.0",
              },
            ],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            detail: {
              services: [{ service_id: "svc-1" }],
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            snapshot: {
              version: "v1.0.1",
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [{ app_id: "hidden-template-id", app_name: "demo-model" }],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            share_record: {
              ID: 71,
              app_model_id: "hidden-template-id",
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            publish_mode: "snapshot",
            share_info: {
              share_service_list: [{ service_cname: "api" }],
              share_plugin_list: [],
              share_k8s_resources: [],
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            submitted: true,
            record: { ID: 71, step: 2 },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            event_list: [{ ID: 3, type: "service", event_status: "not_start" }],
            total: 1,
            is_complete: false,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            event: { ID: 3, event_status: "start" },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            event: { ID: 3, event_status: "success" },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            completed: true,
            share_id: 71,
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001/version",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我创建快照并发布到版本中心", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_create_app_version_snapshot",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
      }
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_app_publish_candidates",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
        scope: "local",
        preferred_app_id: "hidden-template-id",
        preferred_version: "v1.0.1",
      }
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_complete_app_share",
      {
        team_name: "team-a",
        region_name: "region-a",
        share_id: 71,
      }
    );
    const completed = stream.events.find((event) => event.type === "workflow.completed");
    expect(completed?.data.structured_result.summary).toBe(
      "已创建应用快照 v1.0.1，并完成版本中心发布流程。"
    );
    expect(completed?.data.structured_result.subflowData).toMatchObject({
      snapshotVersion: "v1.0.1",
      publishShareId: 71,
      publishEventCount: 1,
      publishMode: "snapshot",
      publishedSnapshotVersion: "v1.0.1",
    });
  });

  it.skip("executes snapshot rollback directly when the user explicitly asks to rollback", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            overview: {
              current_version: "v1.0.2",
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                version_id: 100,
                version: "v1.0.1",
              },
            ],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            detail: {
              services: [{ service_id: "svc-1" }],
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            rollback_record: {
              ID: 91,
              status: 4,
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [{ ID: 91, status: 4, version: "v1.0.1" }],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            record: { ID: 91, status: 4, service_record: [] },
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001/version",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我回滚到最近快照", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_rollback_app_version_snapshot",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
        version_id: 100,
      }
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_list_app_version_rollback_records",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
      }
    );
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_app_version_rollback_record_detail",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
        record_id: 91,
      }
    );
    const completed = stream.events.find((event) => event.type === "workflow.completed");
    expect(completed?.data.structured_result.summary).toBe(
      "已发起应用快照回滚到 v1.0.1，回滚记录 91 已生成。"
    );
    expect(completed?.data.structured_result.subflowData).toMatchObject({
      rollbackVersion: "v1.0.1",
      rollbackRecordId: 91,
    });
  });

  it("routes troubleshoot prompts into the troubleshooter subflow and inspects component summary", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "running",
            running_service_count: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                service_id: "svc-1",
                service_alias: "api",
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
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
              status: "abnormal",
            },
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我修复这个应用", stream: true },
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
    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_component_summary",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
        service_id: "svc-1",
      }
    );
    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        next_action: "inspect_runtime",
        structured_result: expect.objectContaining({
          subflowData: expect.objectContaining({
            appStatus: "running",
            componentCount: 1,
            inspectedComponentStatus: "abnormal",
            blockerHint: "runtime_unhealthy",
            runtimeState: "runtime_unhealthy",
          }),
          selectedWorkflow: "rainbond-fullstack-troubleshooter",
          tool_calls: [
            { name: "rainbond_get_app_detail", status: "success" },
            { name: "rainbond_query_components", status: "success" },
            { name: "rainbond_get_component_summary", status: "success" },
          ],
        }),
      },
    });
  });

  it.skip("proposes a low-risk log inspection follow-up for troubleshoot results", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "running",
            running_service_count: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                service_id: "svc-1",
                service_alias: "api",
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
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
              status: "abnormal",
            },
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我修复这个应用", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        structured_result: expect.objectContaining({
          subflowData: expect.objectContaining({
            proposedToolAction: {
              toolName: "rainbond_get_component_logs",
              requiresApproval: false,
              arguments: {
                team_name: "team-a",
                region_name: "region-a",
                app_id: 1,
                service_id: "svc-1",
                lines: 100,
              },
            },
          }),
        }),
      },
    });
  });

  it.skip("proposes probe inspection when troubleshoot intent explicitly mentions probes", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "running",
            running_service_count: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                service_id: "svc-1",
                service_alias: "api",
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
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
              status: "abnormal",
            },
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我排查这个应用的探针配置", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        structured_result: expect.objectContaining({
          subflowData: expect.objectContaining({
            proposedToolAction: {
              toolName: "rainbond_manage_component_probe",
              requiresApproval: false,
              arguments: {
                team_name: "team-a",
                region_name: "region-a",
                app_id: 1,
                service_id: "svc-1",
                operation: "summary",
              },
            },
          }),
        }),
      },
    });
  });

  it.skip("proposes dependency repair after logs suggest a database connectivity issue", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "running",
            running_service_count: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                service_id: "svc-api",
                service_alias: "api",
              },
              {
                service_id: "svc-db",
                service_alias: "postgres",
              },
            ],
            total: 2,
            page: 1,
            page_size: 20,
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
              status: "abnormal",
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              "dial tcp 10.0.0.12:5432: connect: connection refused",
            ],
            total: 1,
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我修复这个应用，数据库连不上", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_component_logs",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
        service_id: "svc-api",
        lines: 100,
      }
    );
    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        structured_result: expect.objectContaining({
          subflowData: expect.objectContaining({
            blockerHint: "dependency_missing",
            proposedToolAction: {
              toolName: "rainbond_manage_component_dependency",
              requiresApproval: false,
              arguments: {
                team_name: "team-a",
                region_name: "region-a",
                app_id: 1,
                service_id: "svc-api",
                operation: "add",
                dep_service_id: "svc-db",
              },
            },
          }),
        }),
      },
    });
  });

  it.skip("proposes env compatibility repair when logs suggest missing DB_HOST or DB_PORT variables", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "running",
            running_service_count: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                service_id: "svc-api",
                service_alias: "api",
              },
              {
                service_id: "svc-db",
                service_alias: "postgres",
              },
            ],
            total: 2,
            page: 1,
            page_size: 20,
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
              status: "abnormal",
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              "missing environment variable DB_HOST",
            ],
            total: 1,
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我修复这个应用，DB_HOST 缺失", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(
      stream.events.find((event) => event.type === "workflow.completed")
    ).toMatchObject({
      data: {
        structured_result: expect.objectContaining({
          subflowData: expect.objectContaining({
            blockerHint: "env_naming_incompatibility",
            proposedToolAction: {
              toolName: "rainbond_manage_component_envs",
              requiresApproval: false,
              arguments: {
                team_name: "team-a",
                region_name: "region-a",
                app_id: 1,
                service_id: "svc-api",
                operation: "upsert",
                envs: [
                  { name: "DB_HOST", value: "postgres" },
                  { name: "DB_PORT", value: "5432" },
                ],
              },
            },
          }),
        }),
      },
    });
  });

  it.skip("executes an env compatibility repair when the user asks to continue", async () => {
    const sessionStore = createInMemorySessionStore();
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            status: "running",
            running_service_count: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              {
                service_id: "svc-api",
                service_alias: "api",
              },
              {
                service_id: "svc-db",
                service_alias: "postgres",
              },
            ],
            total: 2,
            page: 1,
            page_size: 20,
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
              status: "abnormal",
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            items: [
              "missing environment variable DB_HOST",
            ],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            updated: true,
            service_id: "svc-api",
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      sessionStore,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我修复这个应用，DB_HOST 缺失", stream: true },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "继续执行", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_manage_component_envs",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
        service_id: "svc-api",
        operation: "upsert",
        envs: [
          { name: "DB_HOST", value: "postgres" },
          { name: "DB_PORT", value: "5432" },
        ],
      }
    );
    expect(
      stream.events.find((event) => event.type === "chat.message")?.data
    ).toMatchObject({
      role: "assistant",
      content: "已为组件 svc-api 更新环境变量 DB_HOST、DB_PORT。",
    });
  });

  it.skip("executes a low-risk pending workflow action when the user asks to continue after version-center inspection", async () => {
    const sessionStore = createInMemorySessionStore();
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            overview: {
              current_version: "v1.0.0",
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            has_template: true,
            items: [{ version_id: 100, version: "v1.0.0" }],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            detail: {
              version_id: 100,
              version: "v1.0.0",
              services: [{ service_id: "svc-1" }],
            },
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            app_id: 1,
            created: true,
            snapshot: {
              version: "v1.0.1",
            },
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      sessionStore,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001/version",
        },
      },
    });

    await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我查看版本中心", stream: true },
    });

    const run = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "继续执行", stream: true },
    });

    const stream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: run.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_create_app_version_snapshot",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
      }
    );
    expect(stream.events.map((event) => event.type)).toContain("workflow.completed");
    const snapshotCompletedEvent = stream.events.find(
      (event) => event.type === "workflow.completed"
    );
    expect(snapshotCompletedEvent?.data.workflow_stage).toBe("executed");
    expect(snapshotCompletedEvent?.data.structured_result.summary).toBe(
      "已创建应用快照 v1.0.1，可以继续执行发布或回滚。"
    );
    expect(snapshotCompletedEvent?.data.structured_result.subflowData).toMatchObject({
      snapshotVersion: "v1.0.1",
    });
    expect(snapshotCompletedEvent?.data.structured_result.executedAction).toMatchObject({
      toolName: "rainbond_create_app_version_snapshot",
    });

    const storedSession = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(storedSession?.pendingWorkflowAction).toBeUndefined();
  });

  it.skip("requests approval and executes a high-risk pending workflow action after approval", async () => {
    const sessionStore = createInMemorySessionStore();
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            enterprise_id: "eid-1",
            items: [
              {
                app_model_id: "model-1",
              },
            ],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            enterprise_id: "eid-1",
            source: "local",
            app_model: { app_model_id: "model-1", app_model_name: "demo-app" },
            items: [{ version: "1.0.0" }, { version: "1.1.0" }],
            total: 2,
            page: 1,
            page_size: 20,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            installed: true,
            app_id: 1,
            installed_app_name: "demo-installed",
            service_list: [],
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      sessionStore,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我把这个模板安装到当前应用", stream: true },
    });

    const continueRun = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "继续执行", stream: true },
    });

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: continueRun.data.run_id,
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
      body: { decision: "approved", comment: "确认执行" },
    });

    const resumedStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: continueRun.data.run_id,
      },
      query: { after_sequence: "3" },
    });

    expect(workflowClient.callTool).toHaveBeenCalledWith(
      "rainbond_install_app_model",
      {
        team_name: "team-a",
        region_name: "region-a",
        app_id: 1,
        source: "local",
        app_model_id: "model-1",
        app_model_version: "1.1.0",
        is_deploy: true,
      }
    );
    expect(resumedStream.events.map((event) => event.type)).toContain("workflow.completed");
    const installCompletedEvent = resumedStream.events.find(
      (event) => event.type === "workflow.completed"
    );
    expect(installCompletedEvent?.data.workflow_stage).toBe("executed");
    expect(installCompletedEvent?.data.structured_result.summary).toBe(
      "已完成模板安装，目标应用 demo-installed 已进入后续部署流程。"
    );
    expect(installCompletedEvent?.data.structured_result.subflowData).toMatchObject({
      installedAppName: "demo-installed",
      installedServiceCount: 0,
    });
    expect(installCompletedEvent?.data.structured_result.executedAction).toMatchObject({
      toolName: "rainbond_install_app_model",
    });

    const storedSession = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(storedSession?.pendingWorkflowAction).toBeUndefined();
  });

  it.skip("clears a high-risk pending workflow action when approval is rejected", async () => {
    const sessionStore = createInMemorySessionStore();
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            enterprise_id: "eid-1",
            items: [{ app_model_id: "model-1" }],
            total: 1,
          },
          content: [],
        })
        .mockResolvedValueOnce({
          isError: false,
          structuredContent: {
            enterprise_id: "eid-1",
            source: "local",
            app_model: { app_model_id: "model-1", app_model_name: "demo-app" },
            items: [{ version: "1.1.0" }],
            total: 1,
            page: 1,
            page_size: 20,
          },
          content: [],
        }),
    };

    const controller = createCopilotController({
      llmClient,
      sessionStore,
      workflowToolClientFactory: async () => workflowClient as any,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "app-001",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/app-001",
        },
      },
    });

    await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "帮我把这个模板安装到当前应用", stream: true },
    });

    const continueRun = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "继续执行", stream: true },
    });

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: continueRun.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    const approvalId = initialStream.events[1].data.approval_id;
    await controller.decideApproval({
      actor,
      params: { approvalId },
      body: { decision: "rejected", comment: "暂不执行" },
    });

    const storedSession = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    expect(storedSession?.pendingWorkflowAction).toBeUndefined();

    const sessionView = await controller.getSession({
      actor,
      params: { sessionId: session.data.session_id },
    });
    expect(sessionView.data.pending_workflow_action).toBeNull();
  });

  it("treats affirmative replies like 是的 as continue-execution prompts for pending workflow actions", async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: "should not be called",
        finish_reason: "stop",
      })),
    };
    const workflowClient = {
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          rollback_record: {
            ID: 91,
            status: 4,
          },
        },
        content: [],
      })),
    };
    const sessionStore = createInMemorySessionStore();

    const controller = createCopilotController({
      llmClient,
      workflowToolClientFactory: async () => workflowClient as any,
      sessionStore,
    });

    const actor = {
      tenantId: "team-a",
      userId: "u_1",
      username: "alice",
      sourceSystem: "rainbond-ui",
      roles: [],
      enterpriseId: "eid-1",
    };

    const session = await controller.createSession({
      actor,
      body: {
        context: {
          app_id: "158",
          team_name: "team-a",
          region_name: "region-a",
          page: "/team/team-a/region/region-a/apps/158/version",
        },
      },
    });

    const currentSession = await sessionStore.getById(
      session.data.session_id,
      actor.tenantId
    );
    await sessionStore.update({
      ...currentSession,
      pendingWorkflowAction: {
        kind: "mcp_tool",
        toolName: "rainbond_rollback_app_version_snapshot",
        requiresApproval: true,
        risk: "high",
        scope: "app",
        description: "回滚当前应用到快照版本 1.0.2",
        arguments: {
          team_name: "team-a",
          region_name: "region-a",
          app_id: 158,
          version_id: 38,
        },
      },
    });

    const continueRun = await controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "是的", stream: true },
    });

    const initialStream = await controller.streamRunEvents({
      actor,
      params: {
        sessionId: session.data.session_id,
        runId: continueRun.data.run_id,
      },
      query: { after_sequence: "0" },
    });

    expect(initialStream.events.map((event) => event.type)).toEqual([
      "run.status",
      "approval.requested",
      "run.status",
    ]);
  });
});
