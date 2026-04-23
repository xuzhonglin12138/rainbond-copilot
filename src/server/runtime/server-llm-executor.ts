import { CustomAnthropicClient } from "../../llm/custom-anthropic-client.js";
import { getLLMConfig } from "../../llm/config.js";
import type {
  ChatCompletionResponse,
  ChatMessage,
  ToolDefinition,
} from "../../llm/types.js";
import { OpenAIClient } from "../../llm/openai-client.js";
import type { ActionAdapter, ActionSkill } from "./skill-types.js";
import type { RequestActor, RiskLevel } from "../../shared/types.js";
import { summarizeLogs } from "../../runtime/runtime-helpers.js";
import { PersistedEventPublisher } from "../events/persisted-event-publisher.js";
import type { SseBroker } from "../events/sse-broker.js";
import {
  buildReadOnlyMcpToolDefinitions,
  filterReadOnlyMcpTools,
  type RainbondQueryToolClient,
} from "../integrations/rainbond-mcp/query-tools.js";
import {
  buildMutableMcpToolDefinitions,
  evaluateMutableToolApproval,
  filterMutableMcpTools,
  isMutableMcpToolName,
} from "../integrations/rainbond-mcp/mutable-tools.js";
import { getMutableToolPolicy } from "../integrations/rainbond-mcp/mutable-tool-policy.js";
import type { McpToolDefinition, McpToolResult } from "../integrations/rainbond-mcp/types.js";
import type { PendingWorkflowAction } from "../stores/session-store.js";
import { createServerActionSkills } from "./server-action-skills.js";
import { buildServerSystemPrompt } from "./server-system-prompt.js";

export interface ServerChatClient {
  chat: (
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ) => Promise<ChatCompletionResponse>;
}

interface ServerLlmExecutorDeps {
  broker: SseBroker;
  eventPublisher: PersistedEventPublisher;
  llmClient?: ServerChatClient | null;
  actionAdapter?: ActionAdapter;
  queryToolClientFactory?: QueryToolClientFactory;
    requestApproval?: (input: {
      actor: RequestActor;
      sessionId: string;
      runId: string;
      pendingAction: PendingWorkflowAction;
      description: string;
      risk: RiskLevel;
      scope?: string;
    }) => Promise<void>;
}

export interface ExecuteServerLlmRunParams {
  actor: RequestActor;
  sessionId: string;
  runId: string;
  message: string;
  sessionContext?: Record<string, unknown>;
}

export type QueryToolClientFactory = (params: {
  actor: RequestActor;
  sessionId: string;
}) => Promise<RainbondQueryToolClient> | RainbondQueryToolClient;

export class ServerLlmExecutor {
  private readonly skills: Record<string, ActionSkill>;
  private resolvedClient: ServerChatClient | null | undefined;

  constructor(private readonly deps: ServerLlmExecutorDeps) {
    this.skills = createServerActionSkills(deps.actionAdapter);
    this.resolvedClient = deps.llmClient;
  }

  async execute(params: ExecuteServerLlmRunParams): Promise<boolean> {
    const llmClient = this.getClient();
    if (!llmClient) {
      return false;
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: await buildServerSystemPrompt(),
      },
      ...(this.buildSessionContextMessages(params.sessionContext) as ChatMessage[]),
      {
        role: "user",
        content: params.message,
      },
    ];

    const mcpToolContext = await this.resolveMcpToolContext(params);
    const tools = this.buildTools(
      mcpToolContext.readOnlyDefinitions,
      mcpToolContext.mutableDefinitions
    );
    let iteration = 0;
    const toolResultCache = new Map<
      string,
      {
        traceOutput: unknown;
        toolMessageContent: string;
      }
    >();

    while (iteration < 8) {
      iteration += 1;
      const response = await llmClient.chat(messages, tools);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        const synthesizedSummary = this.buildAssistantSummaryFromToolResults(
          messages,
          params.message
        );
        const content = this.mergeAssistantContentWithToolResults(
          typeof response.content === "string" ? response.content : "",
          synthesizedSummary
        ) ||
          "我已经完成当前分析，但没有生成额外回复。";

        await this.publishAssistantMessage(params, content);
        await this.publishRunStatus(params, "done");
        return true;
      }

      messages.push({
        role: "assistant",
        content: response.content || null,
        tool_calls: response.tool_calls,
      });

      for (const toolCall of response.tool_calls) {
        const skill = this.skills[toolCall.function.name];
        const toolInput = JSON.parse(toolCall.function.arguments || "{}");
        if (skill) {
          const skillCacheKey = this.buildToolCacheKey(
            toolCall.function.name,
            toolInput
          );
          const cachedSkillResult = toolResultCache.get(skillCacheKey);
          if (cachedSkillResult) {
            messages.push({
              role: "tool",
              content: cachedSkillResult.toolMessageContent,
              name: toolCall.function.name,
              tool_call_id: toolCall.id,
            });
            continue;
          }

          const approvalDecision = this.evaluateSkillApproval(skill, toolInput);
          if (approvalDecision.requiresApproval) {
            if (!this.deps.requestApproval) {
              throw new Error("requestApproval callback is required for protected action skills");
            }
            await this.deps.requestApproval({
              actor: params.actor,
              sessionId: params.sessionId,
              runId: params.runId,
              pendingAction: {
                kind: "action_skill",
                toolName: toolCall.function.name,
                requiresApproval: true,
                risk: approvalDecision.risk,
                description: approvalDecision.reason,
                arguments: toolInput,
              },
              description: approvalDecision.reason,
              risk: approvalDecision.risk,
            });
            return true;
          }

          await this.publishTrace(params, {
            tool_name: skill.name,
            input: toolInput,
          });

          const output = await skill.execute(toolInput);
          const toolMessageContent = JSON.stringify(output);
          toolResultCache.set(skillCacheKey, {
            traceOutput: output,
            toolMessageContent,
          });

          await this.publishTrace(params, {
            tool_name: skill.name,
            input: toolInput,
            output,
          });

          messages.push({
            role: "tool",
            content: toolMessageContent,
            name: toolCall.function.name,
            tool_call_id: toolCall.id,
          });
          continue;
        }

        const mcpTool = mcpToolContext.byName.get(toolCall.function.name);
        if (!mcpTool || !mcpToolContext.client) {
          continue;
        }

        const enrichedInput = this.enrichQueryToolInput(
          mcpTool.name,
          toolInput,
          params.sessionContext,
          params.actor
        );
        if (isMutableMcpToolName(mcpTool.name)) {
          const approvalDecision = evaluateMutableToolApproval(
            mcpTool.name,
            enrichedInput
          );
          if (approvalDecision.requiresApproval) {
            if (!this.deps.requestApproval) {
              throw new Error("requestApproval callback is required for protected MCP tools");
            }
            await this.deps.requestApproval({
              actor: params.actor,
              sessionId: params.sessionId,
              runId: params.runId,
              pendingAction: {
                kind: "mcp_tool",
                toolName: mcpTool.name,
                requiresApproval: true,
                risk: approvalDecision.risk,
                scope: approvalDecision.scope,
                description: approvalDecision.reason,
                arguments: enrichedInput,
              },
              description: approvalDecision.reason,
              risk: approvalDecision.risk,
              scope: approvalDecision.scope,
            });
            return true;
          }
        }
        const mcpCacheKey = this.buildToolCacheKey(
          toolCall.function.name,
          enrichedInput
        );
        const cachedMcpResult = toolResultCache.get(mcpCacheKey);
        if (cachedMcpResult) {
          messages.push({
            role: "tool",
            content: cachedMcpResult.toolMessageContent,
            name: mcpTool.name,
            tool_call_id: toolCall.id,
          });
          continue;
        }

        await this.publishTrace(params, {
          tool_name: mcpTool.name,
          input: enrichedInput,
        });

        const output = await mcpToolContext.client.callTool(
          mcpTool.name,
          enrichedInput
        );
        const toolMessageContent = JSON.stringify(
          this.serializeMcpToolResult(output)
        );
        toolResultCache.set(mcpCacheKey, {
          traceOutput: output,
          toolMessageContent,
        });

        await this.publishTrace(params, {
          tool_name: mcpTool.name,
          input: enrichedInput,
          output,
        });

        messages.push({
          role: "tool",
          content: toolMessageContent,
          name: mcpTool.name,
          tool_call_id: toolCall.id,
        });
      }
    }

    await this.publishAssistantMessage(
      params,
      "本次分析轮次已达上限，请尝试缩小问题范围后重新提问。"
    );
    await this.publishRunStatus(params, "done");
    return true;
  }

  private buildAssistantSummaryFromToolResults(
    messages: ChatMessage[],
    userMessage: string
  ): string | null {
    const trailingToolMessages: ChatMessage[] = [];

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "tool") {
        break;
      }
      trailingToolMessages.unshift(message);
    }

    if (trailingToolMessages.length === 0) {
      return null;
    }

    const combinedSummary = this.summarizeCombinedToolMessages(
      trailingToolMessages,
      userMessage
    );
    if (combinedSummary) {
      return combinedSummary;
    }

    const seenSummaries = new Set<string>();
    const summaries = trailingToolMessages
      .map((message) => this.summarizeToolMessage(message, userMessage))
      .filter((item): item is string => !!item)
      .filter((item) => {
        const normalized = item.trim();
        if (!normalized || seenSummaries.has(normalized)) {
          return false;
        }
        seenSummaries.add(normalized);
        return true;
      });

    if (summaries.length === 0) {
      return null;
    }

    return summaries.join("\n");
  }

  private summarizeCombinedToolMessages(
    toolMessages: ChatMessage[],
    userMessage: string
  ): string | null {
    if (!/(组件|component)/i.test(userMessage || "")) {
      return null;
    }

    const parsedMessages = toolMessages
      .map((message) => ({
        name: message.name || "",
        payload: this.parseToolMessagePayload(message),
      }))
      .filter(
        (
          item
        ): item is {
          name: string;
          payload: Record<string, any>;
        } => !!item.payload
      );

    if (parsedMessages.length === 0) {
      return null;
    }

    const latestSummary = [...parsedMessages]
      .reverse()
      .find((item) => item.name === "rainbond_get_component_summary")?.payload;
    const latestDetail = [...parsedMessages]
      .reverse()
      .find((item) => item.name === "rainbond_get_component_detail")?.payload;

    if (!latestSummary && !latestDetail) {
      return null;
    }

    const summaryService =
      latestSummary && typeof latestSummary.service === "object"
        ? latestSummary.service
        : {};
    const detailService =
      latestDetail && typeof latestDetail === "object" ? latestDetail : {};
    const componentName =
      this.extractDisplayName(summaryService) ||
      this.extractDisplayName(detailService) ||
      "当前组件";
    const status =
      (latestSummary &&
        latestSummary.status &&
        typeof latestSummary.status === "object" &&
        latestSummary.status.status) ||
      (summaryService && summaryService.status) ||
      (detailService && detailService.status) ||
      "";
    const memory =
      typeof summaryService.min_memory === "number"
        ? `${summaryService.min_memory}MB`
        : typeof latestSummary?.memory === "number"
          ? `${latestSummary.memory}MB`
          : typeof detailService.min_memory === "number"
            ? `${detailService.min_memory}MB`
            : "";
    const accessInfos = Array.isArray(summaryService.access_infos)
      ? summaryService.access_infos
      : Array.isArray(detailService.access_infos)
        ? detailService.access_infos
        : [];
    const accessAddress = accessInfos
      .map((item: any) =>
        item && typeof item === "object"
          ? item.url || item.domain_name || item.access_url || ""
          : ""
      )
      .find(Boolean);

    const segments: string[] = [];
    if (status && memory) {
      segments.push(`当前组件 ${componentName} 状态为 ${status}，当前配置内存 ${memory}。`);
    } else if (status) {
      segments.push(`当前组件 ${componentName} 状态为 ${status}。`);
    } else {
      segments.push(`已获取当前组件 ${componentName} 的相关信息。`);
    }
    if (accessAddress) {
      segments.push(`当前可访问地址 ${accessAddress}。`);
    }

    return segments.join(" ");
  }

  private parseToolMessagePayload(
    message: ChatMessage
  ): Record<string, any> | null {
    try {
      const parsed = JSON.parse(String(message.content || "{}")) as Record<
        string,
        any
      >;
      if (parsed.structuredContent && typeof parsed.structuredContent === "object") {
        return parsed.structuredContent;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private buildSessionContextMessages(
    sessionContext?: Record<string, unknown>
  ): ChatMessage[] {
    if (!sessionContext || Object.keys(sessionContext).length === 0) {
      return [];
    }

    const enterpriseId = this.readContextString(
      sessionContext.enterpriseId,
      sessionContext.enterprise_id
    );
    const teamName = this.readContextString(
      sessionContext.teamName,
      sessionContext.team_name
    );
    const regionName = this.readContextString(
      sessionContext.regionName,
      sessionContext.region_name
    );
    const appId = this.readContextString(sessionContext.appId, sessionContext.app_id);
    const componentId = this.readContextString(
      sessionContext.componentId,
      sessionContext.component_id
    );
    const page = this.readContextString(sessionContext.pathname, sessionContext.page);

    const lines = [
      "## Current Session Context",
      enterpriseId ? `- enterprise_id: ${enterpriseId}` : "",
      teamName ? `- team_name: ${teamName}` : "",
      regionName ? `- region_name: ${regionName}` : "",
      appId ? `- app_id: ${appId}` : "",
      componentId ? `- component_id: ${componentId}` : "",
      page ? `- page: ${page}` : "",
      "当 team_name、region_name、app_id、component_id 已经在当前上下文中存在时，优先直接使用这些上下文值。",
      "除非用户明确要求查看团队列表、切换团队或跨团队比较，否则不要为了确认当前团队再次调用 rainbond_query_teams。",
      "除非用户明确要求查看集群列表、切换集群或跨集群比较，否则不要为了确认当前集群再次调用 rainbond_query_regions。",
      "如果上下文已经能唯一定位当前团队、集群、应用或组件，就直接进入对应查询，不要重复向用户索要这些参数。",
    ].filter(Boolean);

    return [
      {
        role: "system",
        content: lines.join("\n"),
      },
    ];
  }

  private enrichQueryToolInput(
    toolName: string,
    input: Record<string, unknown>,
    sessionContext: Record<string, unknown> | undefined,
    actor: RequestActor
  ): Record<string, unknown> {
    const nextInput = { ...(input || {}) };
    const context = sessionContext || {};

    const enterpriseId = this.readContextString(
      context.enterpriseId,
      context.enterprise_id,
      actor.enterpriseId
    );
    const teamName = this.readContextString(
      context.teamName,
      context.team_name,
      actor.tenantName,
      actor.tenantId
    );
    const regionName = this.readContextString(
      context.regionName,
      context.region_name,
      actor.regionName
    );
    const appId = this.readContextString(context.appId, context.app_id);
    const componentId = this.readContextString(
      context.componentId,
      context.component_id
    );

    if (!nextInput.enterprise_id && enterpriseId) {
      nextInput.enterprise_id = enterpriseId;
    }
    if (!nextInput.team_name && teamName) {
      nextInput.team_name = teamName;
    }
    if (!nextInput.region_name && regionName) {
      nextInput.region_name = regionName;
    }
    if (!nextInput.app_id && appId) {
      nextInput.app_id = Number.isNaN(Number(appId)) ? appId : Number(appId);
    }
    if (!nextInput.service_id && componentId) {
      nextInput.service_id = componentId;
    }

    if (toolName === "rainbond_get_team_apps") {
      delete nextInput.enterprise_id;
    }

    return nextInput;
  }

  private mergeAssistantContentWithToolResults(
    content: string,
    synthesizedSummary: string | null
  ): string | null {
    const trimmedContent = (content || "").trim();
    const trimmedSummary = (synthesizedSummary || "").trim();

    if (!trimmedContent) {
      return trimmedSummary || null;
    }

    if (!trimmedSummary) {
      return trimmedContent;
    }

    if (this.isLowInformationAssistantReply(trimmedContent)) {
      return trimmedSummary;
    }

    if (trimmedContent.includes(trimmedSummary)) {
      return trimmedContent;
    }

    return `${trimmedContent}\n\n基于本次查询结果：\n${trimmedSummary}`;
  }

  private isLowInformationAssistantReply(content: string): boolean {
    const normalized = content.trim();

    if (normalized.length <= 20) {
      return true;
    }

    return [
      "已完成查询",
      "已完成调用",
      "这是我查询",
      "这是我获取",
      "以下是查询结果",
      "我已经完成当前分析",
      "没有生成额外回复",
    ].some((pattern) => normalized.includes(pattern));
  }

  private summarizeToolMessage(
    message: ChatMessage,
    userMessage: string
  ): string | null {
    let parsed: Record<string, any>;

    try {
      parsed = JSON.parse(String(message.content || "{}")) as Record<string, any>;
    } catch {
      return null;
    }

    const normalizedPayload =
      parsed.structuredContent && typeof parsed.structuredContent === "object"
        ? parsed.structuredContent
        : parsed;

    switch (message.name) {
      case "get-component-status": {
        const name =
          typeof normalizedPayload.name === "string"
            ? normalizedPayload.name
            : "目标组件";
        const status =
          typeof normalizedPayload.status === "string"
            ? normalizedPayload.status
            : "unknown";
        const memory =
          typeof normalizedPayload.memory === "number"
            ? `${normalizedPayload.memory}MB`
            : "未知";
        return `${name} 当前状态为 ${status}，配置内存 ${memory}。`;
      }
      case "get-component-logs": {
        const name =
          typeof normalizedPayload.name === "string"
            ? normalizedPayload.name
            : "目标组件";
        const logs = Array.isArray(normalizedPayload.logs)
          ? normalizedPayload.logs.filter(
              (item: unknown): item is string => typeof item === "string"
            )
          : [];
        const logSummary =
          logs.length > 0 ? summarizeLogs(logs) : "最近日志中没有明显异常。";
        return `${name} 的日志已读取完成。${logSummary}`;
      }
      case "restart-component": {
        const name =
          typeof normalizedPayload.name === "string"
            ? normalizedPayload.name
            : "目标组件";
        const status =
          typeof normalizedPayload.status === "string"
            ? normalizedPayload.status
            : "未知";
        return `${name} 已完成重启，当前状态为 ${status}。`;
      }
      case "scale-component-memory": {
        const name =
          typeof normalizedPayload.name === "string"
            ? normalizedPayload.name
            : "目标组件";
        const memory =
          typeof normalizedPayload.memory === "number"
            ? `${normalizedPayload.memory}MB`
            : "未知";
        return `${name} 的内存已调整为 ${memory}。`;
      }
      case "rainbond_get_component_summary": {
        return this.summarizeComponentSummaryPayload(normalizedPayload);
      }
      case "rainbond_get_component_detail": {
        return this.summarizeComponentDetailPayload(normalizedPayload);
      }
      case "rainbond_get_component_events": {
        return this.summarizeCollectionPayload("组件事件", normalizedPayload);
      }
      case "rainbond_query_components": {
        return this.summarizeCollectionPayload("组件列表", normalizedPayload);
      }
      case "rainbond_query_apps": {
        return this.summarizeCollectionPayload("应用列表", normalizedPayload);
      }
      case "rainbond_query_teams": {
        return this.summarizeCollectionPayload("团队列表", normalizedPayload);
      }
      case "rainbond_get_app_detail": {
        return this.summarizeAppDetailPayload(normalizedPayload);
      }
      case "rainbond_get_app_version_overview": {
        return this.summarizeAppVersionOverviewPayload(normalizedPayload);
      }
      case "rainbond_list_app_version_snapshots":
      case "rainbond_list_app_version_rollback_records":
      case "rainbond_list_app_share_records":
      case "rainbond_list_app_share_events":
      case "rainbond_query_app_upgrade_records":
      case "rainbond_query_local_app_models":
      case "rainbond_query_cloud_app_models":
      case "rainbond_query_app_model_versions":
      case "rainbond_query_cloud_markets":
      case "rainbond_query_enterprises":
      case "rainbond_query_regions":
      case "rainbond_query_region_nodes":
      case "rainbond_query_region_rbd_components":
      case "rainbond_query_app_monitor":
      case "rainbond_query_app_monitor_range":
      case "rainbond_get_team_apps":
      case "rainbond_get_app_publish_candidates":
      case "rainbond_get_app_rollback_records":
      case "rainbond_get_app_upgrade_changes":
      case "rainbond_get_app_upgrade_detail":
      case "rainbond_get_app_upgrade_info":
      case "rainbond_get_app_upgrade_record":
      case "rainbond_get_app_last_upgrade_record":
      case "rainbond_get_copy_app_info":
      case "rainbond_get_app_share_info":
      case "rainbond_get_app_share_event":
      case "rainbond_get_app_share_record":
      case "rainbond_get_package_upload_status":
      case "rainbond_get_region_detail":
      case "rainbond_get_region_node_detail":
      case "rainbond_get_yaml_app_check_result":
      case "rainbond_get_component_check_result":
      case "rainbond_get_current_user": {
        return this.summarizeGenericQueryPayload(
          message.name || "",
          normalizedPayload,
          userMessage
        );
      }
      default: {
        if (typeof normalizedPayload.msg_show === "string" && normalizedPayload.msg_show) {
          return normalizedPayload.msg_show;
        }
        if (typeof normalizedPayload.message === "string" && normalizedPayload.message) {
          return normalizedPayload.message;
        }
        if (normalizedPayload.deleted === true) {
          const deletedName = this.extractDisplayName(normalizedPayload);
          return deletedName
            ? `已完成删除操作，目标为 ${deletedName}。`
            : `已完成 ${message.name} 删除操作。`;
        }
        if (normalizedPayload.created === true) {
          const createdName = this.extractDisplayName(normalizedPayload);
          return createdName
            ? `已完成创建操作，目标为 ${createdName}。`
            : `已完成 ${message.name} 创建操作。`;
        }
        if (normalizedPayload.updated === true) {
          const updatedName = this.extractDisplayName(normalizedPayload);
          return updatedName
            ? `已完成更新操作，目标为 ${updatedName}。`
            : `已完成 ${message.name} 更新操作。`;
        }
        if (normalizedPayload.installed === true) {
          const installedName = this.extractDisplayName(normalizedPayload);
          return installedName
            ? `已完成安装操作，目标为 ${installedName}。`
            : `已完成 ${message.name} 安装操作。`;
        }
        if (normalizedPayload.event_id) {
          return `已提交 ${message.name}，事件 ID 为 ${String(normalizedPayload.event_id)}。`;
        }
        if (/状态|status/i.test(userMessage) && typeof normalizedPayload.status === "string") {
          return `已获取当前状态：${normalizedPayload.status}。`;
        }
        return null;
      }
    }
  }

  private evaluateSkillApproval(
    skill: ActionSkill,
    input: Record<string, unknown>
  ): {
    requiresApproval: boolean;
    risk: RiskLevel;
    reason: string;
  } {
    if (skill.approvalPolicy) {
      const decision = skill.approvalPolicy.evaluate(input);
      return {
        requiresApproval: !!decision.requiresApproval,
        risk: (decision.risk || skill.risk || "medium") as RiskLevel,
        reason: decision.reason || `执行 ${skill.id}`,
      };
    }

    return {
      requiresApproval: !!skill.requiresApproval,
      risk: (skill.risk || "low") as RiskLevel,
      reason: `执行 ${skill.id}`,
    };
  }

  private async resolveMcpToolContext(
    params: ExecuteServerLlmRunParams
  ): Promise<{
    client: RainbondQueryToolClient | null;
    readOnlyDefinitions: McpToolDefinition[];
    mutableDefinitions: McpToolDefinition[];
    byName: Map<string, McpToolDefinition>;
  }> {
    if (!this.deps.queryToolClientFactory) {
      return {
        client: null,
        readOnlyDefinitions: [],
        mutableDefinitions: [],
        byName: new Map(),
      };
    }

    try {
      const client = await this.deps.queryToolClientFactory({
        actor: params.actor,
        sessionId: params.sessionId,
      });
      const tools = this.filterContextualMcpTools(
        await client.listTools(),
        params.message,
        params.sessionContext
      );

      return {
        client,
        readOnlyDefinitions: filterReadOnlyMcpTools(tools),
        mutableDefinitions: this.filterApprovedMutableMcpTools(tools),
        byName: new Map(
          [
            ...filterReadOnlyMcpTools(tools),
            ...this.filterApprovedMutableMcpTools(tools),
          ].map((tool) => [tool.name, tool])
        ),
      };
    } catch {
      return {
        client: null,
        readOnlyDefinitions: [],
        mutableDefinitions: [],
        byName: new Map(),
      };
    }
  }

  private filterContextualMcpTools(
    tools: McpToolDefinition[],
    userMessage: string,
    sessionContext?: Record<string, unknown>
  ): McpToolDefinition[] {
    const context = sessionContext || {};
    const hasEnterprise = !!this.readContextString(
      context.enterpriseId,
      context.enterprise_id
    );
    const hasTeam = !!this.readContextString(context.teamName, context.team_name);
    const hasRegion = !!this.readContextString(
      context.regionName,
      context.region_name
    );
    const normalizedMessage = (userMessage || "").toLowerCase();

    const wantsEnterpriseList = /企业列表|所有企业|enterprise/i.test(normalizedMessage);
    const wantsTeamList = /团队列表|所有团队|teams|team list|切换团队/i.test(
      normalizedMessage
    );
    const wantsRegionList = /集群列表|所有集群|regions|region list|切换集群/i.test(
      normalizedMessage
    );

    return tools.filter((tool) => {
      if (tool.name === "rainbond_query_enterprises" && hasEnterprise && !wantsEnterpriseList) {
        return false;
      }

      if (tool.name === "rainbond_query_teams" && hasTeam && !wantsTeamList) {
        return false;
      }

      if (tool.name === "rainbond_query_regions" && hasRegion && !wantsRegionList) {
        return false;
      }

      if (tool.name === "rainbond_query_apps" && hasTeam && hasRegion) {
        return false;
      }

      return true;
    });
  }

  private buildTools(
    readOnlyTools: McpToolDefinition[] = [],
    mutableTools: McpToolDefinition[] = []
  ): ToolDefinition[] {
    return [
      ...Object.values(this.skills).map((skill) => ({
        type: "function" as const,
        function: {
          name: skill.id,
          description: skill.description,
          parameters: this.inferParameters(skill.id),
        },
      })),
      ...buildReadOnlyMcpToolDefinitions(readOnlyTools),
      ...buildMutableMcpToolDefinitions(mutableTools),
    ];
  }

  private filterApprovedMutableMcpTools(
    tools: McpToolDefinition[]
  ): McpToolDefinition[] {
    return filterMutableMcpTools(tools).filter((tool) => {
      const policy = getMutableToolPolicy(tool.name);
      return !!policy && policy.scope === "enterprise";
    });
  }

  private serializeMcpToolResult(
    output: McpToolResult<unknown>
  ): Record<string, unknown> {
    return {
      isError: output.isError,
      structuredContent: output.structuredContent as Record<string, unknown>,
    };
  }

  private summarizeCollectionPayload(
    label: string,
    payload: Record<string, any>
  ): string | null {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const total =
      typeof payload.total === "number" ? payload.total : items.length;
    const previewNames = items
      .slice(0, 3)
      .map((item) => this.extractDisplayName(item))
      .filter(Boolean);

    if (previewNames.length > 0) {
      return `已查询${label}，当前返回 ${total} 条记录，前几项包括：${previewNames.join("、")}。`;
    }

    return `已查询${label}，当前返回 ${total} 条记录。`;
  }

  private summarizeComponentSummaryPayload(
    payload: Record<string, any>
  ): string | null {
    const service = payload.service || {};
    const status = payload.status || {};
    const componentName =
      service.component_name || service.service_alias || "目标组件";
    const phase = status.status || "unknown";
    const memory =
      typeof service.min_memory === "number"
        ? `${service.min_memory}MB`
        : typeof payload.memory === "number"
          ? `${payload.memory}MB`
          : "未知";
    return `${componentName} 当前状态为 ${phase}，当前配置内存 ${memory}。`;
  }

  private summarizeComponentDetailPayload(
    payload: Record<string, any>
  ): string | null {
    const service = payload.service || {};
    const componentName =
      service.component_name || service.service_alias || "目标组件";
    const status =
      payload.status?.status ||
      service.status ||
      "unknown";
    return `${componentName} 的详细信息已获取，当前状态为 ${status}。`;
  }

  private summarizeAppDetailPayload(
    payload: Record<string, any>
  ): string | null {
    const appName =
      payload.group_name || payload.app_name || payload.group_alias || "当前应用";
    const status = payload.status || "unknown";
    return `${appName} 当前状态为 ${status}。`;
  }

  private summarizeAppVersionOverviewPayload(
    payload: Record<string, any>
  ): string | null {
    const overview = payload.overview || {};
    if (overview.current_version) {
      return `当前版本中心的当前版本为 ${overview.current_version}。`;
    }
    return "已获取版本中心概览信息。";
  }

  private summarizeGenericQueryPayload(
    toolName: string,
    payload: Record<string, any>,
    userMessage: string
  ): string | null {
    const structuredContent =
      payload.structuredContent && typeof payload.structuredContent === "object"
        ? payload.structuredContent
        : payload;

    if (Array.isArray(structuredContent.items)) {
      return this.summarizeCollectionPayload(toolName, structuredContent);
    }

    if (
      typeof structuredContent.user_id === "string" ||
      typeof structuredContent.user_id === "number"
    ) {
      const displayName =
        structuredContent.nick_name ||
        structuredContent.real_name ||
        String(structuredContent.user_id);
      const email = structuredContent.email
        ? `，邮箱 ${structuredContent.email}`
        : "";
      const enterpriseId = structuredContent.enterprise_id
        ? `，企业 ID ${structuredContent.enterprise_id}`
        : "";
      const enterpriseRole =
        structuredContent.is_enterprise_admin === true
          ? "，当前具有企业管理员权限"
          : "";
      return `当前登录用户是 ${displayName}${email}${enterpriseId}${enterpriseRole}。`;
    }

    if (typeof structuredContent.status === "string" && /状态|status/i.test(userMessage)) {
      return `已获取查询结果，当前状态为 ${structuredContent.status}。`;
    }

    if (typeof structuredContent.msg_show === "string" && structuredContent.msg_show) {
      return structuredContent.msg_show;
    }

    return `已完成 ${toolName} 查询。`;
  }

  private readContextString(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }
    return "";
  }

  private buildToolCacheKey(
    toolName: string,
    input: Record<string, unknown>
  ): string {
    return `${toolName}:${JSON.stringify(input || {})}`;
  }

  private extractDisplayName(item: Record<string, any>): string {
    return (
      item.component_name ||
      item.service_cname ||
      item.service_alias ||
      item.service_id ||
      item.group_name ||
      item.app_name ||
      item.app_id ||
      item.team_alias ||
      item.team_name ||
      item.region_alias ||
      item.region_name ||
      item.app_model_name ||
      item.version ||
      item.name ||
      item.id ||
      ""
    );
  }

  private getClient(): ServerChatClient | null {
    if (this.resolvedClient !== undefined) {
      return this.resolvedClient;
    }

    try {
      const config = getLLMConfig();
      this.resolvedClient =
        config.provider === "anthropic"
          ? new CustomAnthropicClient(config)
          : new OpenAIClient(config);
    } catch {
      this.resolvedClient = null;
    }

    return this.resolvedClient;
  }

  private inferParameters(skillId: string): ToolDefinition["function"]["parameters"] {
    const parameterMap: Record<string, ToolDefinition["function"]["parameters"]> = {
      "get-component-status": {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "组件名称，如 service-web、service-api 等",
          },
        },
        required: ["name"],
      },
      "get-component-logs": {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "组件名称",
          },
          lines: {
            type: "number",
            description: "日志行数，默认 50",
          },
        },
        required: ["name"],
      },
      "restart-component": {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "要重启的组件名称",
          },
        },
        required: ["name"],
      },
      "scale-component-memory": {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "要扩容的组件名称",
          },
          memory: {
            type: "number",
            description: "新的内存大小（MB），如 1024",
          },
        },
        required: ["name", "memory"],
      },
    };

    return (
      parameterMap[skillId] || {
        type: "object",
        properties: {},
      }
    );
  }

  private async publishTrace(
    params: ExecuteServerLlmRunParams,
    data: Record<string, unknown>
  ): Promise<void> {
    await this.deps.eventPublisher.publish({
      type: "chat.trace",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: await this.nextSequence(params.runId, params.actor.tenantId),
      data,
    });
  }

  private async publishAssistantMessage(
    params: ExecuteServerLlmRunParams,
    content: string
  ): Promise<void> {
    await this.deps.eventPublisher.publish({
      type: "chat.message",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: await this.nextSequence(params.runId, params.actor.tenantId),
      data: {
        role: "assistant",
        content,
      },
    });
  }

  private async publishRunStatus(
    params: ExecuteServerLlmRunParams,
    status: string
  ): Promise<void> {
    await this.deps.eventPublisher.publish({
      type: "run.status",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: await this.nextSequence(params.runId, params.actor.tenantId),
      data: {
        status,
      },
    });
  }

  private async nextSequence(runId: string, tenantId: string): Promise<number> {
    const events = await this.deps.broker.replay(runId, tenantId, {
      afterSequence: 0,
    });

    return events.length + 1;
  }
}
