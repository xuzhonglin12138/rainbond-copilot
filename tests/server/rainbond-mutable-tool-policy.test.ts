// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  evaluateMutableToolApproval,
  getMutableToolPolicy,
  MUTABLE_TOOL_POLICY_LIST,
} from "../../src/server/integrations/rainbond-mcp/mutable-tool-policy";

describe("rainbond mutable tool policy", () => {
  it("contains a complete policy list for all 51 visible mutable MCP tools", () => {
    expect(MUTABLE_TOOL_POLICY_LIST).toHaveLength(51);

    const uniqueNames = new Set(MUTABLE_TOOL_POLICY_LIST.map((item) => item.name));
    expect(uniqueNames.size).toBe(51);
  });

  it("marks direct-execution tools as not requiring approval", () => {
    const policy = getMutableToolPolicy("rainbond_check_yaml_app");

    expect(policy).toMatchObject({
      name: "rainbond_check_yaml_app",
      riskLevel: "low",
      allowDirectExecution: true,
    });

    expect(
      evaluateMutableToolApproval("rainbond_check_yaml_app", {})
    ).toMatchObject({
      requiresApproval: false,
      risk: "low",
    });
  });

  it("marks destructive tools as approval-required and reuses the configured approval message", () => {
    const decision = evaluateMutableToolApproval("rainbond_delete_component", {
      service_cname: "frontend-ui",
    });

    expect(decision).toMatchObject({
      requiresApproval: true,
      risk: "high",
      reason: "删除组件 frontend-ui，该操作可能不可逆",
    });
  });

  it("marks medium-risk configuration changes as approval-required but not destructive", () => {
    const decision = evaluateMutableToolApproval("rainbond_manage_component_envs", {
      service_cname: "backend-api",
    });

    expect(decision).toMatchObject({
      requiresApproval: true,
      risk: "medium",
      reason: "修改组件 backend-api 的环境变量",
    });
  });

  it("treats summary-style sub-operations on mutable component tools as low-risk direct execution", () => {
    expect(
      evaluateMutableToolApproval("rainbond_manage_component_ports", {
        operation: "summary",
        service_cname: "backend-api",
      })
    ).toMatchObject({
      requiresApproval: false,
      risk: "low",
    });

    expect(
      evaluateMutableToolApproval("rainbond_manage_component_probe", {
        operation: "get",
        service_cname: "backend-api",
      })
    ).toMatchObject({
      requiresApproval: false,
      risk: "low",
    });
  });
});
