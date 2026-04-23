// @vitest-environment node
import { describe, expect, it } from "vitest";
import { executeRainbondAppAssistant } from "../../../src/server/workflows/rainbond-app-assistant";

describe("executeRainbondAppAssistant", () => {
  it("asks for missing scope when the embedded context is incomplete", async () => {
    const result = await executeRainbondAppAssistant({
      message: "帮我把这个项目在 Rainbond 上跑起来",
      actor: {
        tenantId: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {},
    });

    expect(result).toMatchObject({
      workflowId: "rainbond-app-assistant",
      workflowStage: "resolve-context",
      nextAction: "request_context",
    });
  });

  it("moves into state assessment when team and app scope are present", async () => {
    const result = await executeRainbondAppAssistant({
      message: "帮我修复这个应用",
      actor: {
        tenantId: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        app_id: "app-001",
        page: "/team/team-a/region/region-a/apps/app-001",
      },
    });

    expect(result).toMatchObject({
      workflowId: "rainbond-app-assistant",
      workflowStage: "assess-state",
      nextAction: "inspect_runtime",
    });
  });

  it("selects the bootstrap subflow for deploy-style requests", async () => {
    const result = await executeRainbondAppAssistant({
      message: "帮我把这个项目在 Rainbond 上跑起来",
      actor: {
        tenantId: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-a",
        region_name: "region-a",
        app_id: "app-001",
      },
    });

    expect(result).toMatchObject({
      workflowId: "rainbond-app-assistant",
      workflowStage: "select-subflow",
      nextAction: "bootstrap_topology",
      selectedWorkflow: "rainbond-fullstack-bootstrap",
    });
  });

  it("selects the template installer subflow for template-install intent", async () => {
    const result = await executeRainbondAppAssistant({
      message: "帮我把这个模板安装到当前应用",
      actor: {
        tenantId: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-a",
        region_name: "region-a",
        app_id: "app-001",
      },
    });

    expect(result).toMatchObject({
      workflowStage: "select-subflow",
      nextAction: "install_template",
      selectedWorkflow: "rainbond-template-installer",
    });
  });

  it("still selects the template installer when team and region are present but app_id is missing", async () => {
    const result = await executeRainbondAppAssistant({
      message: "帮我把这个模板安装到新应用",
      actor: {
        tenantId: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-a",
        region_name: "region-a",
      },
    });

    expect(result).toMatchObject({
      workflowStage: "select-subflow",
      nextAction: "install_template",
      selectedWorkflow: "rainbond-template-installer",
    });
  });

  it("selects the version assistant for snapshot and publish intent", async () => {
    const result = await executeRainbondAppAssistant({
      message: "帮我创建快照并发布到版本中心",
      actor: {
        tenantId: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-a",
        region_name: "region-a",
        app_id: "app-001",
      },
    });

    expect(result).toMatchObject({
      workflowStage: "select-subflow",
      nextAction: "run_version_flow",
      selectedWorkflow: "rainbond-app-version-assistant",
    });
  });

  it("selects delivery verification for acceptance-style requests", async () => {
    const result = await executeRainbondAppAssistant({
      message: "帮我验证这个应用是否已经交付完成",
      actor: {
        tenantId: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {
        team_name: "team-a",
        region_name: "region-a",
        app_id: "app-001",
      },
    });

    expect(result).toMatchObject({
      workflowStage: "select-subflow",
      nextAction: "verify_delivery",
      selectedWorkflow: "rainbond-delivery-verifier",
    });
  });

  it("describes embedded workflows for capability-style questions even without app scope", async () => {
    const result = await executeRainbondAppAssistant({
      message: "你现在能做什么，有哪些流程？",
      actor: {
        tenantId: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
      },
      sessionContext: {},
    });

    expect(result).toMatchObject({
      workflowId: "rainbond-app-assistant",
      workflowStage: "report",
      nextAction: "describe_capabilities",
    });
    expect(result.summary).toContain("rainbond-app-assistant");
    expect(result.summary).toContain("rainbond-template-installer");
    expect(result.summary).toContain("rainbond-app-version-assistant");
  });
});
