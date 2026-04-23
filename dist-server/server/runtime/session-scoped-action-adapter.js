import { RainbondMcpActionAdapter } from "../integrations/rainbond-mcp/action-adapter.js";
export class SessionScopedRainbondActionAdapter {
    constructor(client, deps) {
        this.client = client;
        this.deps = deps;
        this.realAdapter = new RainbondMcpActionAdapter(client);
    }
    async getComponentStatus(input) {
        const scope = await this.resolveScope(input.name);
        return this.realAdapter.getComponentStatus(scope);
    }
    async getComponentLogs(input) {
        const scope = await this.resolveScope(input.name);
        return this.realAdapter.getComponentLogs({
            ...scope,
            lines: input.lines,
        });
    }
    async restartComponent(input) {
        const scope = await this.resolveScope(input.name);
        await this.client.callTool("rainbond_operate_app", {
            team_name: scope.teamName,
            region_name: scope.regionName,
            app_id: scope.appId,
            action: "restart",
            service_ids: [scope.serviceId],
        });
        return {
            name: scope.serviceLabel,
            serviceId: scope.serviceId,
            status: "running",
        };
    }
    async scaleComponentMemory(input) {
        const scope = await this.resolveScope(input.name);
        return this.realAdapter.scaleComponentMemory({
            ...scope,
            memory: input.memory,
        });
    }
    async resolveScope(name) {
        const sessionContext = this.deps.sessionContext || {};
        const verifiedScope = this.deps.verifiedScope;
        const teamName = (verifiedScope && verifiedScope.teamName) ||
            this.readString(sessionContext.teamName) ||
            this.readString(sessionContext.team_name) ||
            this.deps.actor.tenantName ||
            this.deps.actor.tenantId;
        const regionName = (verifiedScope && verifiedScope.regionName) ||
            this.readString(sessionContext.regionName) ||
            this.readString(sessionContext.region_name);
        const appId = this.parseAppId((verifiedScope && verifiedScope.appId) ||
            sessionContext.appId ||
            sessionContext.app_id);
        if (!teamName || !regionName || !appId) {
            throw new Error("Missing verified session scope for Rainbond action");
        }
        const directServiceId = this.readString(sessionContext.componentId) ||
            this.readString(sessionContext.component_id);
        const componentSource = this.readString(sessionContext.componentSource) ||
            this.readString(sessionContext.component_source);
        if (directServiceId && (componentSource || !name || directServiceId === name)) {
            return {
                teamName,
                regionName,
                appId,
                serviceId: directServiceId,
                serviceLabel: directServiceId,
            };
        }
        if (!this.deps.actor.enterpriseId) {
            throw new Error("enterpriseId is required to resolve component names");
        }
        const queryResult = await this.client.callTool("rainbond_query_components", {
            enterprise_id: this.deps.actor.enterpriseId,
            app_id: appId,
            query: name,
            page: 1,
            page_size: 20,
        });
        const items = queryResult.structuredContent.items || [];
        const matched = items.find(item => item.service_alias === name) ||
            items.find(item => item.service_cname === name) ||
            items[0];
        if (!matched || !matched.service_id) {
            if (directServiceId) {
                return {
                    teamName,
                    regionName,
                    appId,
                    serviceId: directServiceId,
                    serviceLabel: directServiceId,
                };
            }
            throw new Error(`Component ${name} not found`);
        }
        return {
            teamName,
            regionName,
            appId,
            serviceId: matched.service_id,
            serviceLabel: matched.service_cname ||
                matched.service_alias ||
                matched.service_id,
        };
    }
    readString(value) {
        return typeof value === "string" ? value : "";
    }
    parseAppId(value) {
        if (typeof value === "number") {
            return value;
        }
        if (typeof value === "string" && value.trim()) {
            return Number(value);
        }
        return 0;
    }
}
