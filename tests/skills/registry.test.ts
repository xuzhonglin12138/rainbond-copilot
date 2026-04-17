import { SkillRegistry } from "../../src/skills/registry";

it("loads action skills from registry", async () => {
  const registry = new SkillRegistry();
  const skills = await registry.loadAll();

  expect(skills.some((skill) => skill.kind === "action")).toBe(true);
  expect(skills.length).toBeGreaterThan(0);
});
