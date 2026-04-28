// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { buildServerSystemPrompt } from "../../../src/server/runtime/server-system-prompt";
import { initializeSkillRegistry } from "../../../src/server/skills/skill-registry";

beforeAll(async () => {
  await initializeSkillRegistry();
});

describe("buildServerSystemPrompt", () => {
  it("returns the base prompt when no skill is active", async () => {
    const prompt = await buildServerSystemPrompt();
    expect(prompt).toContain("你是 Rainbond Copilot");
    expect(prompt).not.toContain("当前激活 Skill 指令");
  });

  it("appends the skill narrative section when currentSkillId is set", async () => {
    const prompt = await buildServerSystemPrompt({
      currentSkillId: "rainbond-fullstack-troubleshooter",
    });
    expect(prompt).toContain("当前激活 Skill 指令");
    expect(prompt).toContain("rainbond-fullstack-troubleshooter");
    expect(prompt).toContain("Rainbond Fullstack Troubleshooter");
    expect(prompt).not.toContain("yaml workflow");
    expect(prompt).not.toContain("```yaml workflow");
  });

  it("falls back to base prompt when skill id is unknown", async () => {
    const prompt = await buildServerSystemPrompt({
      currentSkillId: "definitely-not-a-real-skill",
    });
    expect(prompt).toContain("你是 Rainbond Copilot");
    expect(prompt).not.toContain("当前激活 Skill 指令");
  });
});
