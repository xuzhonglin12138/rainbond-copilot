export interface ComponentState {
  name: string;
  status: "running" | "stopped" | "abnormal" | "building";
  memory: number;
  logs: string[];
}

export class WorldState {
  private components: Map<string, ComponentState> = new Map();

  constructor() {
    this.components.set("frontend-ui", {
      name: "frontend-ui",
      status: "abnormal",
      memory: 512,
      logs: [
        "[2024-01-01 10:00:00] Starting frontend-ui...",
        "[2024-01-01 10:00:05] FATAL: JavaScript heap out of memory",
        "[2024-01-01 10:00:06] Process exited with code 137",
      ],
    });

    this.components.set("backend-api", {
      name: "backend-api",
      status: "running",
      memory: 1024,
      logs: [
        "[2024-01-01 10:00:00] Server listening on port 8080",
        "[2024-01-01 10:00:10] Health check passed",
      ],
    });
  }

  getComponent(name: string): ComponentState | undefined {
    return this.components.get(name);
  }

  setComponentStatus(name: string, status: ComponentState["status"]): void {
    const component = this.components.get(name);
    if (component) {
      component.status = status;
    }
  }

  setComponentMemory(name: string, memory: number): void {
    const component = this.components.get(name);
    if (component) {
      component.memory = memory;
      component.logs.push(`[${new Date().toISOString()}] Memory scaled to ${memory}MB`);
    }
  }

  addLog(name: string, log: string): void {
    const component = this.components.get(name);
    if (component) {
      component.logs.push(log);
    }
  }
}
