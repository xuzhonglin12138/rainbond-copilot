import type { RainbondMcpClient } from "./client.js";
import type {
  RealComponentLogsInput,
  RealComponentScopeInput,
  RealRestartInput,
  RealScaleMemoryInput,
} from "../../runtime/action-types.js";

interface SummaryPayload {
  component_name?: string;
  service_alias?: string;
  status?: string;
  memory?: number;
}

interface LogsPayload {
  component_name?: string;
  logs?: string[];
}

interface ScalePayload {
  component_name?: string;
  memory?: number;
}

export class RainbondMcpActionAdapter {
  constructor(private readonly client: Pick<RainbondMcpClient, "callTool">) {}

  async getComponentStatus(input: RealComponentScopeInput) {
    const result = await this.client.callTool<SummaryPayload>(
      "rainbond_get_component_summary",
      {
        team_name: input.teamName,
        region_name: input.regionName,
        app_id: input.appId,
        service_id: input.serviceId,
      }
    );

    return {
      name:
        result.structuredContent.component_name ||
        result.structuredContent.service_alias ||
        input.serviceId,
      status: result.structuredContent.status || "unknown",
      memory: result.structuredContent.memory || 0,
    };
  }

  async getComponentLogs(input: RealComponentLogsInput) {
    const result = await this.client.callTool<LogsPayload>(
      "rainbond_get_component_logs",
      {
        team_name: input.teamName,
        region_name: input.regionName,
        app_id: input.appId,
        service_id: input.serviceId,
        lines: input.lines,
      }
    );

    return {
      name: result.structuredContent.component_name || input.serviceId,
      logs: result.structuredContent.logs || [],
    };
  }

  async restartComponent(input: RealRestartInput) {
    await this.client.callTool("rainbond_operate_app", {
      team_name: input.teamName,
      region_name: input.regionName,
      app_id: input.appId,
      action: "restart",
    });

    return {
      name: input.serviceId || String(input.appId),
      status: "running",
    };
  }

  async scaleComponentMemory(input: RealScaleMemoryInput) {
    const result = await this.client.callTool<ScalePayload>(
      "rainbond_vertical_scale_component",
      {
        team_name: input.teamName,
        region_name: input.regionName,
        app_id: input.appId,
        service_id: input.serviceId,
        new_memory: input.memory,
      }
    );

    return {
      name: result.structuredContent.component_name || input.serviceId,
      memory: result.structuredContent.memory || input.memory,
    };
  }
}
