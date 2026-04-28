// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initializeSkillRegistry } from "../../../src/server/skills/skill-registry";
import {
  buildSkillToolName,
  createSkillRouter,
  type SkillRouterClient,
} from "../../../src/server/skills/skill-router";
import { executeRainbondAppAssistant } from "../../../src/server/workflows/rainbond-app-assistant";
import { executeCompiledWorkflow } from "../../../src/server/workflows/compiled-executor";

beforeAll(async () => {
  await initializeSkillRegistry();
});

const baseActor = {
  tenantId: "team-a",
  tenantName: "team-a",
  userId: "u_1",
  username: "alice",
  sourceSystem: "rainbond-ui" as const,
  roles: [],
  enterpriseId: "eid-1",
};

describe("end-to-end skill dispatch flow (Sprint 1-5)", () => {
  it("LLM router → app assistant → compiled executor → build_logs branch", async () => {
    // Sprint 2: stub LLM to pick troubleshooter with build_logs intent
    const llmClient: SkillRouterClient = {
      chat: vi.fn().mockResolvedValue({
        content: null,
        finish_reason: "tool_calls",
        tool_calls: [
          {
            id: "tc_1",
            type: "function",
            function: {
              name: buildSkillToolName("rainbond-fullstack-troubleshooter"),
              arguments: JSON.stringify({
                service_id: "svc-7",
                event_id: "evt-42",
                inspection_mode: "build_logs",
              }),
            },
          },
        ],
      }),
    };

    const skillRouter = createSkillRouter({ llmClient });

    // Sprint 2: app-assistant routes through LLM router
    const assistantResult = await executeRainbondAppAssistant({
      message: "我的服务构建失败了，看下 build log",
      actor: baseActor,
      sessionContext: {
        teamName: "team-a",
        regionName: "region-x",
        appId: "42",
      },
      skillRouter,
    });

    expect(assistantResult.routedBy).toBe("llm");
    expect(assistantResult.selectedWorkflow).toBe(
      "rainbond-fullstack-troubleshooter"
    );
    expect(assistantResult.skillInput).toMatchObject({
      service_id: "svc-7",
      event_id: "evt-42",
      inspection_mode: "build_logs",
    });

    // Sprint 3: compiled executor runs the branch chosen by `when` clause
    const callTool = vi.fn(async (name: string) => ({
      isError: false,
      structuredContent: { ok: true, _tool: name },
      content: [],
    }));

    await executeCompiledWorkflow({
      skillId: assistantResult.selectedWorkflow!,
      actor: baseActor,
      candidateScope: assistantResult.candidateScope,
      input: assistantResult.skillInput,
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    const calledTools = callTool.mock.calls.map(([name]) => name);

    // Confirm the user-visible payoff: the framework now actually inspects
    // BUILD logs, not pods/events, when the user asks about a build error.
    expect(calledTools).toContain("rainbond_get_component_build_logs");
    expect(calledTools).not.toContain("rainbond_get_component_pods");
    expect(calledTools).not.toContain("rainbond_get_component_logs");
    expect(calledTools).not.toContain("rainbond_get_component_summary");

    const buildLogsArgs = callTool.mock.calls.find(
      ([name]) => name === "rainbond_get_component_build_logs"
    )?.[1];
    expect(buildLogsArgs).toMatchObject({
      service_id: "svc-7",
      event_id: "evt-42",
      app_id: 42,
      team_name: "team-a",
      region_name: "region-x",
    });
  });

  it("falls back to summary branch when LLM cannot disambiguate intent", async () => {
    const llmClient: SkillRouterClient = {
      chat: vi.fn().mockResolvedValue({
        content: null,
        finish_reason: "tool_calls",
        tool_calls: [
          {
            id: "tc_2",
            type: "function",
            function: {
              name: buildSkillToolName("rainbond-fullstack-troubleshooter"),
              arguments: JSON.stringify({ service_id: "svc-9" }),
            },
          },
        ],
      }),
    };

    const skillRouter = createSkillRouter({ llmClient });

    const assistantResult = await executeRainbondAppAssistant({
      message: "应用怎么了",
      actor: baseActor,
      sessionContext: {
        teamName: "team-a",
        regionName: "region-x",
        appId: "42",
      },
      skillRouter,
    });

    const callTool = vi.fn(async (name: string) => ({
      isError: false,
      structuredContent: { ok: true, _tool: name },
      content: [],
    }));

    await executeCompiledWorkflow({
      skillId: assistantResult.selectedWorkflow!,
      actor: baseActor,
      candidateScope: assistantResult.candidateScope,
      input: assistantResult.skillInput,
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    const calledTools = callTool.mock.calls.map(([name]) => name);
    expect(calledTools).toContain("rainbond_get_component_summary");
    expect(calledTools).not.toContain("rainbond_get_component_build_logs");
  });

  it("falls back to legacy regex routing when no LLM router is wired", async () => {
    const assistantResult = await executeRainbondAppAssistant({
      message: "应用挂了 帮我排查",
      actor: baseActor,
      sessionContext: {
        teamName: "team-a",
        regionName: "region-x",
        appId: "42",
      },
      // no skillRouter -> regex tree should still pick troubleshooter
    });

    expect(assistantResult.selectedWorkflow).toBe(
      "rainbond-fullstack-troubleshooter"
    );
    expect(assistantResult.routedBy).toBeUndefined();
    expect(assistantResult.skillInput).toBeUndefined();
  });
});
