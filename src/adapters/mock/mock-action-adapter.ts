import { WorldState } from "./world-state.js";
import type { ActionAdapter } from "../../skills/types.js";

export class MockActionAdapter implements ActionAdapter {
  private world = new WorldState();

  async getComponentStatus(input: { name: string }) {
    const component = this.world.getComponent(input.name);
    if (!component) {
      throw new Error(`Component ${input.name} not found`);
    }
    return {
      name: component.name,
      status: component.status,
      memory: component.memory,
    };
  }

  async getComponentLogs(input: { name: string; lines?: number }) {
    const component = this.world.getComponent(input.name);
    if (!component) {
      throw new Error(`Component ${input.name} not found`);
    }
    const lines = input.lines || 50;
    return {
      name: component.name,
      logs: component.logs.slice(-lines),
    };
  }

  async restartComponent(input: { name: string }) {
    const component = this.world.getComponent(input.name);
    if (!component) {
      throw new Error(`Component ${input.name} not found`);
    }
    this.world.setComponentStatus(input.name, "running");
    this.world.addLog(input.name, `[${new Date().toISOString()}] Component restarted`);
    return {
      name: component.name,
      status: "running",
    };
  }

  async scaleComponentMemory(input: { name: string; memory: number }) {
    const component = this.world.getComponent(input.name);
    if (!component) {
      throw new Error(`Component ${input.name} not found`);
    }
    this.world.setComponentMemory(input.name, input.memory);
    return {
      name: component.name,
      memory: input.memory,
    };
  }
}
