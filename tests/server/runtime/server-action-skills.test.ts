// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createServerActionSkills } from "../../../src/server/runtime/server-action-skills";

describe("createServerActionSkills", () => {
  it("builds server action skills from the provided adapter", async () => {
    const adapter = {
      getComponentStatus: vi.fn(async () => ({
        name: "api",
        status: "running",
        memory: 1024,
      })),
      getComponentLogs: vi.fn(async () => ({
        name: "api",
        logs: ["a", "b"],
      })),
      restartComponent: vi.fn(async () => ({
        name: "api",
        status: "running",
      })),
      scaleComponentMemory: vi.fn(async () => ({
        name: "api",
        memory: 2048,
        cpu: 1000,
      })),
    };

    const skills = createServerActionSkills(adapter as any);
    const result = await skills["get-component-status"].execute({
      name: "api",
    });

    expect(adapter.getComponentStatus).toHaveBeenCalledWith({
      name: "api",
    });
    expect(result).toMatchObject({
      name: "api",
      status: "running",
      memory: 1024,
    });
  });

  it("passes cpu together with memory for scale action skills", async () => {
    const adapter = {
      getComponentStatus: vi.fn(),
      getComponentLogs: vi.fn(),
      restartComponent: vi.fn(),
      scaleComponentMemory: vi.fn(async () => ({
        name: "api",
        memory: 1024,
        cpu: 1000,
      })),
    };

    const skills = createServerActionSkills(adapter as any);
    const result = await skills["scale-component-memory"].execute({
      name: "api",
      memory: 1024,
      cpu: 1000,
    });

    expect(adapter.scaleComponentMemory).toHaveBeenCalledWith({
      name: "api",
      memory: 1024,
      cpu: 1000,
    });
    expect(result).toMatchObject({
      name: "api",
      memory: 1024,
      cpu: 1000,
    });
  });

  it("fails fast when server runtime tries to execute without an action adapter", async () => {
    const skills = createServerActionSkills();

    expect(() =>
      skills["get-component-status"].execute({
        name: "api",
      })
    ).toThrow("Action adapter is required for server runtime execution");
  });
});
