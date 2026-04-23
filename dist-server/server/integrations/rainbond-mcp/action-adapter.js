export class RainbondMcpActionAdapter {
    constructor(client) {
        this.client = client;
    }
    async getComponentStatus(input) {
        const result = await this.client.callTool("rainbond_get_component_summary", {
            team_name: input.teamName,
            region_name: input.regionName,
            app_id: input.appId,
            service_id: input.serviceId,
        });
        return {
            name: result.structuredContent.component_name ||
                result.structuredContent.service_alias ||
                input.serviceId,
            status: result.structuredContent.status || "unknown",
            memory: result.structuredContent.memory || 0,
        };
    }
    async getComponentLogs(input) {
        const result = await this.client.callTool("rainbond_get_component_logs", {
            team_name: input.teamName,
            region_name: input.regionName,
            app_id: input.appId,
            service_id: input.serviceId,
            lines: input.lines,
        });
        return {
            name: result.structuredContent.component_name || input.serviceId,
            logs: result.structuredContent.logs || [],
        };
    }
    async restartComponent(input) {
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
    async scaleComponentMemory(input) {
        const result = await this.client.callTool("rainbond_vertical_scale_component", {
            team_name: input.teamName,
            region_name: input.regionName,
            app_id: input.appId,
            service_id: input.serviceId,
            new_memory: input.memory,
        });
        return {
            name: result.structuredContent.component_name || input.serviceId,
            memory: result.structuredContent.memory || input.memory,
        };
    }
}
