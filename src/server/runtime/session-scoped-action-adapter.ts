import type { RequestActor } from "../../shared/types.js";
import { RainbondMcpActionAdapter } from "../integrations/rainbond-mcp/action-adapter.js";
import type {
  LegacyComponentLogsInput,
  LegacyComponentStatusInput,
  LegacyScaleMemoryInput,
} from "./action-types.js";
import type { ResolvedExecutionScope } from "../workflows/types.js";

interface SessionScopedAdapterDeps {
  actor: RequestActor;
  sessionContext?: Record<string, unknown>;
  lastVerifiedScopeSignature?: string;
  verifiedScope?: ResolvedExecutionScope;
}

interface McpLike {
  callTool<T = unknown>(
    name: string,
    arguments_: Record<string, unknown>
  ): Promise<{
    isError: boolean;
    structuredContent: T;
    content: Array<{ type: string; text: string }>;
  }>;
}

interface QueryComponentsResult {
  items?: Array<{
    service_id: string;
    service_alias?: string;
    service_cname?: string;
  }>;
}

export class SessionScopedRainbondActionAdapter {
  private readonly realAdapter: RainbondMcpActionAdapter;

  constructor(
    private readonly client: McpLike,
    private readonly deps: SessionScopedAdapterDeps
  ) {
    this.realAdapter = new RainbondMcpActionAdapter(client as any);
  }

  async getComponentStatus(input: LegacyComponentStatusInput) {
    const scope = await this.resolveScope(input.name);
    return this.realAdapter.getComponentStatus(scope);
  }

  async getComponentLogs(input: LegacyComponentLogsInput) {
    const scope = await this.resolveScope(input.name);
    return this.realAdapter.getComponentLogs({
      ...scope,
      lines: input.lines,
    });
  }

  async restartComponent(input: LegacyComponentStatusInput) {
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

  async scaleComponentMemory(input: LegacyScaleMemoryInput) {
    const scope = await this.resolveScope(input.name);
    return this.realAdapter.scaleComponentMemory({
      ...scope,
      memory: input.memory,
      ...(typeof input.cpu === "number" ? { cpu: input.cpu } : {}),
    });
  }

  private async resolveScope(name: string) {
    const sessionContext = this.deps.sessionContext || {};
    const verifiedScope = this.deps.verifiedScope;
    const teamName =
      (verifiedScope && verifiedScope.teamName) ||
      this.readString(sessionContext.teamName) ||
      this.readString(sessionContext.team_name) ||
      this.deps.actor.tenantName ||
      this.deps.actor.tenantId;
    const regionName =
      (verifiedScope && verifiedScope.regionName) ||
      this.readString(sessionContext.regionName) ||
      this.readString(sessionContext.region_name);
    const appId = this.parseAppId(
      (verifiedScope && verifiedScope.appId) ||
      sessionContext.appId ||
      sessionContext.app_id
    );

    if (!teamName || !regionName || !appId) {
      throw new Error("Missing verified session scope for Rainbond action");
    }

    const directServiceId =
      this.readString(sessionContext.componentId) ||
      this.readString(sessionContext.component_id);
    const componentSource =
      this.readString(sessionContext.componentSource) ||
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

    const queryResult = await this.client.callTool<QueryComponentsResult>(
      "rainbond_query_components",
      {
        enterprise_id: this.deps.actor.enterpriseId,
        app_id: appId,
        query: name,
        page: 1,
        page_size: 20,
      }
    );

    const items = queryResult.structuredContent.items || [];
    const matched =
      items.find(item => item.service_alias === name) ||
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
      serviceLabel:
        matched.service_cname ||
        matched.service_alias ||
        matched.service_id,
    };
  }

  private readString(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  private parseAppId(value: unknown): number {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      return Number(value);
    }
    return 0;
  }
}
