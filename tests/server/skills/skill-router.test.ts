// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initializeSkillRegistry, getRegisteredSkills } from "../../../src/server/skills/skill-registry";
import {
  buildSkillsAsTools,
  buildSkillToolName,
  createSkillRouter,
  parseSkillIdFromToolName,
  type SkillRouterClient,
} from "../../../src/server/skills/skill-router";

beforeAll(async () => {
  await initializeSkillRegistry();
});

describe("skill router", () => {
  it("exposes one Anthropic-style tool per embedded skill", () => {
    const skills = getRegisteredSkills();
    const tools = buildSkillsAsTools(skills);

    expect(tools.length).toBeGreaterThanOrEqual(4);
    for (const tool of tools) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toMatch(/^select_skill_/);
      expect(tool.function.parameters.type).toBe("object");
      expect(tool.function.parameters.properties).toBeDefined();
    }

    const troubleshooterTool = tools.find(
      (tool) =>
        tool.function.name === buildSkillToolName("rainbond-fullstack-troubleshooter")
    );
    expect(troubleshooterTool).toBeDefined();
    expect(troubleshooterTool?.function.parameters.properties).toHaveProperty(
      "inspection_mode"
    );
  });

  it("round-trips skill ID through tool name encoding", () => {
    expect(parseSkillIdFromToolName(buildSkillToolName("rainbond-fullstack-troubleshooter"))).toBe(
      "rainbond-fullstack-troubleshooter"
    );
    expect(parseSkillIdFromToolName("not_a_skill_tool")).toBeNull();
  });

  it("dispatches to the skill the LLM picks and sanitizes input against schema", async () => {
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
                inspection_mode: "build_logs",
                event_id: "evt-123",
                bogus_extra_field: "should-be-dropped",
                empty_value: "",
              }),
            },
          },
        ],
      }),
    };

    const router = createSkillRouter({ llmClient });
    const choice = await router.route({
      message: "我的服务构建失败了，看下 build log",
      sessionContext: {
        teamName: "team-a",
        regionName: "region-x",
        appId: "42",
      },
    });

    expect(choice).not.toBeNull();
    expect(choice?.skillId).toBe("rainbond-fullstack-troubleshooter");
    expect(choice?.input).toEqual({
      inspection_mode: "build_logs",
      event_id: "evt-123",
    });

    const chatCall = (llmClient.chat as any).mock.calls[0];
    const messages = chatCall[0];
    const tools = chatCall[1];
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("我的服务构建失败了");
    expect(messages[1].content).toContain("teamName");
    expect(tools.length).toBeGreaterThanOrEqual(4);
  });

  it("returns null when the LLM refuses to call any skill tool", async () => {
    const llmClient: SkillRouterClient = {
      chat: vi.fn().mockResolvedValue({
        content: "I'm not sure",
        finish_reason: "stop",
      }),
    };

    const router = createSkillRouter({ llmClient });
    const choice = await router.route({ message: "随便聊聊" });
    expect(choice).toBeNull();
  });

  it("returns null when the tool name is not a registered skill", async () => {
    const llmClient: SkillRouterClient = {
      chat: vi.fn().mockResolvedValue({
        content: null,
        finish_reason: "tool_calls",
        tool_calls: [
          {
            id: "tc_2",
            type: "function",
            function: {
              name: "select_skill_nonexistent",
              arguments: "{}",
            },
          },
        ],
      }),
    };

    const router = createSkillRouter({ llmClient });
    const choice = await router.route({ message: "anything" });
    expect(choice).toBeNull();
  });
});
