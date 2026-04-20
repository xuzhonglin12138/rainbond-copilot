import { WorldState } from "./world-state";
export class MockActionAdapter {
    constructor() {
        this.world = new WorldState();
    }
    async getComponentStatus(input) {
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
    async getComponentLogs(input) {
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
    async restartComponent(input) {
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
    async scaleComponentMemory(input) {
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
