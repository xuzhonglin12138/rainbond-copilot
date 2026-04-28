// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initializeSkillRegistry } from "../../../src/server/skills/skill-registry";
import { createSkillSummarizer } from "../../../src/server/skills/skill-summarizer";
import { executeCompiledWorkflow } from "../../../src/server/workflows/compiled-executor";
import type { SkillRouterClient } from "../../../src/server/skills/skill-router";

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

const baseScope = {
  teamName: "team-a",
  regionName: "region-a",
  appId: "app-001",
};

describe("skill summarizer", () => {
  it("calls the LLM with skill narrative + tool outputs and returns its content", async () => {
    const llmClient: SkillRouterClient = {
      chat: vi.fn().mockResolvedValue({
        content:
          "### Problem Judgment\nbuild log shows npm exited non-zero\n\n### Follow-up Advice\nhand off to code/build",
        finish_reason: "stop",
      }),
    };

    const summarizer = createSkillSummarizer({ llmClient });

    const result = await summarizer.summarize({
      skillId: "rainbond-fullstack-troubleshooter",
      skillName: "Rainbond Fullstack Troubleshooter",
      skillNarrative:
        "## Output format\nReply must include `### Problem Judgment`.",
      userMessage: "构建报错了",
      skillInput: { service_id: "svc-7", inspection_mode: "build_logs" },
      toolOutputs: [
        {
          name: "rainbond_get_component_build_logs",
          output: { lines: ["npm ERR! exited with code 1"] },
        },
      ],
    });

    expect(result).toContain("Problem Judgment");
    expect(result).toContain("hand off to code/build");

    const messages = (llmClient.chat as any).mock.calls[0][0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Rainbond Fullstack Troubleshooter");
    expect(messages[0].content).toContain("Reply must include `### Problem Judgment`");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("构建报错了");
    expect(messages[1].content).toContain("rainbond_get_component_build_logs");
    expect(messages[1].content).toContain("npm ERR!");
  });

  it("falls back to a placeholder string when the LLM returns nothing", async () => {
    const llmClient: SkillRouterClient = {
      chat: vi.fn().mockResolvedValue({ content: "", finish_reason: "stop" }),
    };
    const summarizer = createSkillSummarizer({ llmClient });
    const result = await summarizer.summarize({
      skillId: "x",
      skillName: "x",
      skillNarrative: "x",
      skillInput: {},
      toolOutputs: [],
    });
    expect(result).toMatch(/LLM 未返回/);
  });

  it("compiled-executor wires the summarizer into the summarize stage", async () => {
    const llmContent =
      "### Problem Judgment\nsource build still running\n\n### Follow-up Advice\nwait";
    const summarizer = {
      summarize: vi.fn().mockResolvedValue(llmContent),
    };

    const callTool = vi.fn(async (name: string) => ({
      isError: false,
      structuredContent: { ok: true, _tool: name },
      content: [],
    }));

    const result = await executeCompiledWorkflow({
      skillId: "rainbond-fullstack-troubleshooter",
      actor: baseActor,
      candidateScope: baseScope,
      input: {
        service_id: "svc-7",
        event_id: "evt-42",
        inspection_mode: "build_logs",
      },
      userMessage: "构建报错了",
      summarizer,
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    expect(summarizer.summarize).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe(llmContent);

    const summarizerCall = summarizer.summarize.mock.calls[0][0];
    expect(summarizerCall.skillId).toBe("rainbond-fullstack-troubleshooter");
    expect(summarizerCall.userMessage).toBe("构建报错了");
    expect(summarizerCall.skillInput).toMatchObject({
      service_id: "svc-7",
      inspection_mode: "build_logs",
    });
    expect(summarizerCall.toolOutputs.map((t: any) => t.name)).toContain(
      "rainbond_get_component_build_logs"
    );
  });

  it("compiled-executor falls back to placeholder summary when no summarizer wired", async () => {
    const callTool = vi.fn(async (name: string) => ({
      isError: false,
      structuredContent: { ok: true, _tool: name },
      content: [],
    }));

    const result = await executeCompiledWorkflow({
      skillId: "rainbond-fullstack-troubleshooter",
      actor: baseActor,
      candidateScope: baseScope,
      input: { service_id: "svc-7" },
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    expect(result.summary).toMatch(/已通过编译型流程执行/);
  });

  it("compiled-executor swallows summarizer errors and keeps the placeholder summary", async () => {
    const summarizer = {
      summarize: vi.fn().mockRejectedValue(new Error("upstream timeout")),
    };
    const callTool = vi.fn(async (name: string) => ({
      isError: false,
      structuredContent: { ok: true, _tool: name },
      content: [],
    }));

    const result = await executeCompiledWorkflow({
      skillId: "rainbond-fullstack-troubleshooter",
      actor: baseActor,
      candidateScope: baseScope,
      input: { service_id: "svc-7" },
      summarizer,
      client: { callTool },
      publishToolTrace: vi.fn(async () => {}),
    });

    expect(summarizer.summarize).toHaveBeenCalled();
    expect(result.summary).toMatch(/已通过编译型流程执行/);
  });
});
