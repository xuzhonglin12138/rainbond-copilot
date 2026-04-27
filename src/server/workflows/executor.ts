import type { RequestActor } from "../../shared/types.js";
import { PersistedEventPublisher } from "../events/persisted-event-publisher.js";
import { buildScopeSignature } from "./context-resolver.js";
import { buildPendingWorkflowActionCompletion } from "./pending-action-result.js";
import { executeRainbondAppAssistant } from "./rainbond-app-assistant.js";
import type { WorkflowRegistry } from "./registry.js";
import { createWorkflowRegistry } from "./registry.js";
import type { SessionRecord, SessionStore } from "../stores/session-store.js";
import type { RunStore } from "../stores/run-store.js";
import type { McpToolResult } from "../integrations/rainbond-mcp/types.js";
import {
  createRunExecutionState,
  type DeferredRunAction,
  type RunExecutionState,
} from "../runtime/run-execution-state.js";

interface WorkflowExecutorDeps {
  eventPublisher: PersistedEventPublisher;
  sessionStore: SessionStore;
  runStore: RunStore;
  workflowRegistry?: WorkflowRegistry;
  workflowToolClientFactory?: WorkflowToolClientFactory;
  enableRainbondAppAssistantWorkflow?: boolean;
}

export interface ExecuteWorkflowParams {
  actor: RequestActor;
  sessionId: string;
  runId: string;
  message: string;
}

interface WorkflowToolClient {
  callTool<T = unknown>(
    name: string,
    arguments_: Record<string, unknown>
  ): Promise<McpToolResult<T>>;
}

export type WorkflowToolClientFactory = (params: {
  actor: RequestActor;
  sessionId: string;
}) => Promise<WorkflowToolClient> | WorkflowToolClient;

function isSnapshotCreationRequested(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }
  return /(创建.*快照|生成.*快照|create.*snapshot)/i.test(normalized);
}

function shouldAutoCreateSnapshot(message: string): boolean {
  return (
    isSnapshotCreationRequested(message) &&
    !/(发布|publish|回滚|rollback)/i.test((message || "").trim())
  );
}

function shouldAutoRollbackSnapshot(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }
  return /(回滚到|回滚当前应用|回滚快照|rollback)/i.test(normalized);
}

function parseSnapshotVersionInput(message: string): string {
  const normalized = (message || "").trim();
  if (!normalized) {
    return "";
  }

  const matched = normalized.match(/\b(v?\d+\.\d+(?:\.\d+)?)\b/i);
  return matched && matched[1] ? matched[1] : "";
}

function suggestNextSnapshotVersion(version: string): string {
  const normalized = (version || "").trim();
  if (!normalized) {
    return "v1.0.1";
  }

  const matched = normalized.match(/^(v?)(\d+)\.(\d+)(?:\.(\d+))?$/i);
  if (!matched) {
    return "v1.0.1";
  }

  const prefix = matched[1] || "v";
  const major = Number(matched[2]);
  const minor = Number(matched[3]);
  const patch = matched[4] ? Number(matched[4]) + 1 : 1;

  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return "v1.0.1";
  }

  return `${prefix || "v"}${major}.${minor}.${patch}`;
}

function suggestRollbackSnapshotVersion(
  items: Array<Record<string, unknown>>
): string {
  if (items.length > 1) {
    return readStructuredString(items[1], "version");
  }

  if (items.length > 0) {
    return readStructuredString(items[0], "version");
  }

  return "v1.0.1";
}

function shouldUseCloudTemplateInstall(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }
  return /(云市场|应用市场|cloud market|market template|云模板)/i.test(normalized);
}

function parseHelmCreationIntent(message: string): {
  name: string;
  repoName: string;
  chartName: string;
  version: string;
} | null {
  const normalized = (message || "").trim();
  if (!normalized || !/(helm|chart)/i.test(normalized)) {
    return null;
  }

  const repoMatch = normalized.match(/repo\s+([A-Za-z0-9._/-]+)/i);
  const chartMatch = normalized.match(/chart\s+([A-Za-z0-9._/-]+)/i);
  const versionMatch = normalized.match(/version\s+([A-Za-z0-9._/-]+)/i);
  if (!repoMatch || !chartMatch || !versionMatch) {
    return null;
  }

  return {
    name: chartMatch[1].split("/").pop() || "helm-app",
    repoName: repoMatch[1],
    chartName: chartMatch[1],
    version: versionMatch[1],
  };
}

function extractLogTexts(payload: Record<string, unknown> | undefined): string[] {
  if (!payload) {
    return [];
  }
  if (Array.isArray((payload as any).items)) {
    return (payload as any).items.filter(
      (item: unknown): item is string => typeof item === "string"
    );
  }
  if (Array.isArray((payload as any).logs)) {
    return (payload as any).logs.filter(
      (item: unknown): item is string => typeof item === "string"
    );
  }
  return [];
}

function logsSuggestDependencyIssue(logs: string[]): boolean {
  const joined = logs.join("\n").toLowerCase();
  if (!joined) {
    return false;
  }
  return (
    joined.includes("connection refused") ||
    joined.includes("econnrefused") ||
    joined.includes("dial tcp") ||
    joined.includes("no route to host") ||
    joined.includes("no such host") ||
    joined.includes("could not connect") ||
    joined.includes("failed to connect") ||
    joined.includes("database") ||
    joined.includes("postgres") ||
    joined.includes("mysql")
  );
}

function logsSuggestEnvCompatibilityIssue(logs: string[]): boolean {
  const joined = logs.join("\n").toLowerCase();
  if (!joined) {
    return false;
  }
  return (
    joined.includes("db_host") ||
    joined.includes("db_port") ||
    joined.includes("missing environment variable") ||
    joined.includes("missing env") ||
    joined.includes("database url") ||
    joined.includes("dsn")
  );
}

function findDatabaseLikeComponent(
  items: Array<Record<string, unknown>>,
  currentServiceId: string
): Record<string, unknown> | undefined {
  return items.find((item) => {
    const serviceId = readStructuredString(item, "service_id");
    if (!serviceId || serviceId === currentServiceId) {
      return false;
    }
    const alias = readStructuredString(item, "service_alias", "service_cname").toLowerCase();
    return /(db|postgres|mysql|redis|database)/i.test(alias);
  });
}

function detectTroubleshooterInspectionTool(message: string): {
  toolName:
    | "rainbond_manage_component_ports"
    | "rainbond_manage_component_connection_envs"
    | "rainbond_manage_component_probe"
    | "rainbond_manage_component_autoscaler"
    | "rainbond_manage_component_storage";
  operation: string;
} | null {
  const normalized = (message || "").trim();
  if (!normalized) {
    return null;
  }

  if (/(端口|port)/i.test(normalized)) {
    return {
      toolName: "rainbond_manage_component_ports",
      operation: "summary",
    };
  }
  if (/(连接信息|connection env|outer env|连接变量)/i.test(normalized)) {
    return {
      toolName: "rainbond_manage_component_connection_envs",
      operation: "summary",
    };
  }
  if (/(探针|probe)/i.test(normalized)) {
    return {
      toolName: "rainbond_manage_component_probe",
      operation: "summary",
    };
  }
  if (/(伸缩|autoscaler|hpa|弹性)/i.test(normalized)) {
    return {
      toolName: "rainbond_manage_component_autoscaler",
      operation: "summary",
    };
  }
  if (/(存储|挂载|volume|mnt)/i.test(normalized)) {
    return {
      toolName: "rainbond_manage_component_storage",
      operation: "summary",
    };
  }
  return null;
}

function readStructuredString(
  payload: Record<string, unknown> | undefined,
  ...keys: string[]
): string {
  if (!payload) {
    return "";
  }
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function parseAppId(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const direct = Number(value);
  if (!Number.isNaN(direct)) {
    return direct;
  }
  const matched = value.match(/(\d+)/);
  if (!matched) {
    return 0;
  }
  return Number(matched[1]);
}

function isAppAssistantPrompt(message: string): boolean {
  return /(rainbond.+跑起来|在 rainbond 上跑起来|部署|修复|恢复服务|卡在哪|排查|探针|probe|端口|port|存储|挂载|volume|autoscaler|伸缩|连接信息|helm|chart|模板|template|市场|安装到当前应用|快照|snapshot|发布|publish|回滚|rollback|版本中心|version center|交付|验收|验证|verify|访问地址|url|你能做什么|可以做什么|有哪些流程|有哪些能力|有哪些工作流|workflow|skill|技能)/i.test(
    message
  );
}

export function isContinueWorkflowActionPrompt(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }

  return /^(继续执行|确认执行|继续|立即执行|execute|confirm|run now|是的|是|好的|好|可以|行|没问题|没错|对)$/i.test(
    normalized
  );
}

function cloneRunExecutionState(
  state: RunExecutionState
): RunExecutionState {
  return {
    ...state,
    messages: state.messages.map((message) => ({
      ...message,
      ...(message.tool_calls
        ? {
            tool_calls: message.tool_calls.map((toolCall) => ({
              ...toolCall,
              function: {
                ...toolCall.function,
              },
            })),
          }
        : {}),
    })),
    pendingApprovals: state.pendingApprovals.map((approval) => ({
      ...approval,
      arguments: { ...approval.arguments },
      followUpActions: approval.followUpActions?.map((item) => ({
        ...item,
        arguments: { ...item.arguments },
      })),
    })),
    deferredAction: state.deferredAction
      ? {
          ...state.deferredAction,
          arguments: { ...state.deferredAction.arguments },
          resolutionTool: state.deferredAction.resolutionTool
            ? {
                ...state.deferredAction.resolutionTool,
                arguments: { ...state.deferredAction.resolutionTool.arguments },
              }
            : undefined,
        }
      : state.deferredAction,
    completedToolCallIds: [...state.completedToolCallIds],
  };
}

export class WorkflowExecutor {
  private readonly registry: WorkflowRegistry;
  private readonly enableRainbondAppAssistantWorkflow: boolean;

  constructor(private readonly deps: WorkflowExecutorDeps) {
    this.registry = deps.workflowRegistry || createWorkflowRegistry();
    this.enableRainbondAppAssistantWorkflow =
      deps.enableRainbondAppAssistantWorkflow === true;
  }

  async execute(params: ExecuteWorkflowParams): Promise<boolean> {
    const session = await this.deps.sessionStore.getById(
      params.sessionId,
      params.actor.tenantId
    );
    if (!session || session.userId !== params.actor.userId) {
      throw new Error("Session not found");
    }
    const run = await this.deps.runStore.getById(
      params.runId,
      params.actor.tenantId
    );
    if (!run) {
      throw new Error("Run not found");
    }

    if (
      session.pendingWorkflowAction &&
      isContinueWorkflowActionPrompt(params.message)
    ) {
      return this.executePendingWorkflowAction(params, session);
    }

    if (!this.enableRainbondAppAssistantWorkflow) {
      return false;
    }

    if (!isAppAssistantPrompt(params.message)) {
      return false;
    }

    const workflow = this.registry.get("rainbond-app-assistant");
    if (!workflow) {
      return false;
    }

    await this.deps.eventPublisher.publish({
      type: "workflow.selected",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 2,
      data: {
        workflow_id: workflow.id,
        workflow_name: workflow.name,
      },
    });

    const result = await executeRainbondAppAssistant({
      message: params.message,
      actor: params.actor,
      sessionContext: session.context,
    });

    if (result.workflowStage !== "resolve-context") {
      const verifiedScope = {
        ...result.candidateScope,
        verified: true as const,
      };
      await this.deps.sessionStore.update({
        ...session,
        lastVerifiedScopeSignature: buildScopeSignature(verifiedScope),
        verifiedScope,
      });
    }

    await this.deps.eventPublisher.publish({
      type: "workflow.stage",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 3,
      data: {
        workflow_id: result.workflowId,
        workflow_stage: result.workflowStage,
        next_action: result.nextAction,
      },
    });

    const subflowExecution = await this.executeSelectedSubflow({
      actor: params.actor,
      sessionId: params.sessionId,
      runId: params.runId,
      result,
      message: params.message,
    });
    const hasSubflowTrace = subflowExecution.toolCalls.length > 0;
    const messageSequence = hasSubflowTrace
      ? (subflowExecution.lastSequence || 5) + 1
      : 4;
    const completedSequence = messageSequence + 1;
    const doneSequence = completedSequence + 1;

    await this.deps.eventPublisher.publish({
      type: "chat.message",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: messageSequence,
      data: {
        role: "assistant",
        content: subflowExecution.summary || result.summary,
      },
    });

    await this.deps.eventPublisher.publish({
      type: "workflow.completed",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: completedSequence,
      data: {
        workflow_id: result.workflowId,
        workflow_stage: result.workflowStage,
        next_action: result.nextAction,
        structured_result: {
          ...result,
          summary: subflowExecution.summary || result.summary,
          tool_calls: subflowExecution.toolCalls,
          subflowData: subflowExecution.subflowData,
          ...(subflowExecution.structuredResultPatch || {}),
        },
      },
    });

    if (subflowExecution.proposedToolAction) {
      await this.deps.sessionStore.update(
        {
          ...session,
          lastVerifiedScopeSignature:
            result.workflowStage !== "resolve-context"
              ? buildScopeSignature({
                  ...result.candidateScope,
                  verified: true,
                })
              : session.lastVerifiedScopeSignature,
          verifiedScope:
            result.workflowStage !== "resolve-context"
              ? {
                  ...result.candidateScope,
                  verified: true,
                }
              : session.verifiedScope,
          pendingWorkflowAction: {
            toolName: subflowExecution.proposedToolAction.toolName,
            requiresApproval: subflowExecution.proposedToolAction.requiresApproval,
            arguments: subflowExecution.proposedToolAction.arguments,
          },
        }
      );
    } else if (session.pendingWorkflowAction) {
      await this.deps.sessionStore.update({
        ...session,
        pendingWorkflowAction: undefined,
      });
    }

    const nextExecutionState = run.executionState
      ? cloneRunExecutionState(run.executionState)
      : createRunExecutionState({
          runId: run.runId,
          sessionId: run.sessionId,
          tenantId: run.tenantId,
          initialMessage: run.messageText,
        });
    nextExecutionState.status = "completed";
    nextExecutionState.finalOutput = subflowExecution.summary || result.summary;
    nextExecutionState.deferredAction =
      subflowExecution.proposedToolAction?.deferredAction || null;
    await this.deps.runStore.update({
      ...run,
      executionState: nextExecutionState,
    });

    await this.deps.eventPublisher.publish({
      type: "run.status",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: doneSequence,
      data: {
        status: "done",
      },
    });

    return true;
  }

  private async executeSelectedSubflow(params: {
    actor: RequestActor;
    sessionId: string;
    runId: string;
    result: Awaited<ReturnType<typeof executeRainbondAppAssistant>>;
    message: string;
  }): Promise<{
    summary?: string;
    toolCalls: Array<{ name: string; status: string }>;
    lastSequence?: number;
    subflowData?: Record<string, unknown>;
    structuredResultPatch?: Record<string, unknown>;
    proposedToolAction?: {
      toolName: string;
      requiresApproval: boolean;
      arguments: Record<string, unknown>;
      deferredAction?: DeferredRunAction;
    };
  }> {
    const { result, actor, sessionId, runId, message } = params;
    if (!result.selectedWorkflow || !this.deps.workflowToolClientFactory) {
      return { toolCalls: [] };
    }

    const client = await this.deps.workflowToolClientFactory({
      actor,
      sessionId,
    });

    if (result.selectedWorkflow === "rainbond-template-installer") {
      const isCloudInstall = shouldUseCloudTemplateInstall(message);
      const enterpriseId = actor.enterpriseId || "";
      let sequenceCursor = 4;
      let marketName = "";
      let toolCalls: Array<{ name: string; status: string }> = [];
      let modelId = "";
      let modelName = "";
      let versionCount = 0;
      let latestVersion = "";

      if (isCloudInstall) {
        const marketInput = {
          enterprise_id: enterpriseId,
          page: 1,
          page_size: 20,
        };
        await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor, {
          tool_name: "rainbond_query_cloud_markets",
          input: marketInput,
        });
        const markets = await client.callTool("rainbond_query_cloud_markets", marketInput);
        await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor + 1, {
          tool_name: "rainbond_query_cloud_markets",
          input: marketInput,
          output: markets,
        });
        sequenceCursor += 2;
        toolCalls.push({ name: "rainbond_query_cloud_markets", status: "success" });

        const marketItems =
          markets.structuredContent &&
          Array.isArray((markets.structuredContent as any).items)
            ? (markets.structuredContent as any).items
            : [];
        marketName = readStructuredString(
          marketItems[0] as Record<string, unknown> | undefined,
          "name",
          "market_name",
          "market_id"
        );

        const cloudModelInput = {
          enterprise_id: enterpriseId,
          market_name: marketName,
          page: 1,
          page_size: 20,
        };
        await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor, {
          tool_name: "rainbond_query_cloud_app_models",
          input: cloudModelInput,
        });
        const cloudModels = await client.callTool(
          "rainbond_query_cloud_app_models",
          cloudModelInput
        );
        await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor + 1, {
          tool_name: "rainbond_query_cloud_app_models",
          input: cloudModelInput,
          output: cloudModels,
        });
        sequenceCursor += 2;
        toolCalls.push({ name: "rainbond_query_cloud_app_models", status: "success" });

        const cloudModelItems =
          cloudModels.structuredContent &&
          Array.isArray((cloudModels.structuredContent as any).items)
            ? (cloudModels.structuredContent as any).items
            : [];
        const selectedCloudModel = cloudModelItems[0] || {};
        modelId = readStructuredString(selectedCloudModel, "app_model_id", "app_id");
        modelName = readStructuredString(selectedCloudModel, "app_model_name", "app_name");

        if (modelId) {
          const versionInput = {
            enterprise_id: enterpriseId,
            source: "cloud",
            market_name: marketName,
            app_model_id: modelId,
            page: 1,
            page_size: 20,
          };
          await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor, {
            tool_name: "rainbond_query_app_model_versions",
            input: versionInput,
          });
          const versions = await client.callTool(
            "rainbond_query_app_model_versions",
            versionInput
          );
          await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor + 1, {
            tool_name: "rainbond_query_app_model_versions",
            input: versionInput,
            output: versions,
          });
          sequenceCursor += 2;
          toolCalls.push({ name: "rainbond_query_app_model_versions", status: "success" });
          versionCount =
            versions.structuredContent &&
            Array.isArray((versions.structuredContent as any).items)
              ? (versions.structuredContent as any).items.length
              : 0;
          latestVersion =
            versions.structuredContent &&
            Array.isArray((versions.structuredContent as any).items) &&
            (versions.structuredContent as any).items.length > 0
              ? readStructuredString(
                  (versions.structuredContent as any).items[
                    (versions.structuredContent as any).items.length - 1
                  ],
                  "version"
                )
              : "";

          return {
            summary: `已查询云市场模板及其版本，建议安装版本为 ${latestVersion}。如接受建议，可直接回复“继续执行”或“是的”；也可以直接回复目标版本号。`,
            toolCalls,
            lastSequence: sequenceCursor - 1,
            subflowData: {
              marketName,
              appModelId: modelId,
              appModelName: modelName,
              versionCount,
              latestVersion,
            },
            proposedToolAction: {
              toolName: "rainbond_install_app_model",
              requiresApproval: true,
              arguments: {
                team_name: result.candidateScope.teamName || actor.tenantId,
                region_name: result.candidateScope.regionName || actor.regionName || "",
                app_id: parseAppId(result.candidateScope.appId),
                source: "cloud",
                market_name: marketName,
                app_model_id: modelId,
                app_model_version: latestVersion,
                is_deploy: true,
                __await_version_input: true,
                suggested_version: latestVersion,
              },
              deferredAction: {
                toolName: "rainbond_install_app_model",
                requiresApproval: true,
                missingArgument: "app_model_version",
                suggestedValue: latestVersion,
                arguments: {
                  team_name: result.candidateScope.teamName || actor.tenantId,
                  region_name:
                    result.candidateScope.regionName || actor.regionName || "",
                  app_id: parseAppId(result.candidateScope.appId),
                  source: "cloud",
                  market_name: marketName,
                  app_model_id: modelId,
                  app_model_version: latestVersion,
                  is_deploy: true,
                },
              },
            },
          };
        }

        return {
          summary: "已查询云市场模板，下一步可继续选择模板版本并执行安装。",
          toolCalls,
          lastSequence: sequenceCursor - 1,
          subflowData: {
            marketName,
          },
        };
      }

      const input = {
        enterprise_id: enterpriseId,
        page: 1,
        page_size: 20,
      };
      await this.publishToolTrace(actor.tenantId, sessionId, runId, 4, {
        tool_name: "rainbond_query_local_app_models",
        input,
      });
      const output = await client.callTool("rainbond_query_local_app_models", input);
      await this.publishToolTrace(actor.tenantId, sessionId, runId, 5, {
        tool_name: "rainbond_query_local_app_models",
        input,
        output,
      });
      modelId =
        output.structuredContent &&
        Array.isArray((output.structuredContent as any).items) &&
        (output.structuredContent as any).items[0] &&
        ((output.structuredContent as any).items[0].app_model_id ||
          (output.structuredContent as any).items[0].app_id);
      if (modelId) {
        const versionInput = {
          enterprise_id: enterpriseId,
          source: "local",
          app_model_id: modelId,
          page: 1,
          page_size: 20,
        };
        await this.publishToolTrace(actor.tenantId, sessionId, runId, 6, {
          tool_name: "rainbond_query_app_model_versions",
          input: versionInput,
        });
        const versions = await client.callTool(
          "rainbond_query_app_model_versions",
          versionInput
        );
        await this.publishToolTrace(actor.tenantId, sessionId, runId, 7, {
          tool_name: "rainbond_query_app_model_versions",
          input: versionInput,
          output: versions,
        });
        return {
          summary: `已查询当前企业下可安装的本地模板及其版本，建议安装版本为 ${versions.structuredContent &&
              Array.isArray((versions.structuredContent as any).items) &&
              (versions.structuredContent as any).items.length > 0
                ? (versions.structuredContent as any).items[
                    (versions.structuredContent as any).items.length - 1
                  ].version
                : ""}。如接受建议，可直接回复“继续执行”或“是的”；也可以直接回复目标版本号。`,
          toolCalls: [
            { name: "rainbond_query_local_app_models", status: "success" },
            { name: "rainbond_query_app_model_versions", status: "success" },
          ],
          lastSequence: 7,
          subflowData: {
            appModelId: modelId,
            appModelName:
              versions.structuredContent &&
              (versions.structuredContent as any).app_model
                ? (versions.structuredContent as any).app_model.app_model_name
                : undefined,
            versionCount:
              versions.structuredContent &&
              Array.isArray((versions.structuredContent as any).items)
                ? (versions.structuredContent as any).items.length
                : 0,
              latestVersion:
                versions.structuredContent &&
                Array.isArray((versions.structuredContent as any).items) &&
                (versions.structuredContent as any).items.length > 0
                  ? (versions.structuredContent as any).items[
                      (versions.structuredContent as any).items.length - 1
                    ].version
                  : undefined,
          },
          proposedToolAction: {
            toolName: "rainbond_install_app_model",
            requiresApproval: true,
            arguments: {
              team_name: result.candidateScope.teamName || actor.tenantId,
              region_name: result.candidateScope.regionName || actor.regionName || "",
              app_id: parseAppId(result.candidateScope.appId),
              source: "local",
              app_model_id: modelId,
              app_model_version:
                versions.structuredContent &&
                Array.isArray((versions.structuredContent as any).items) &&
                (versions.structuredContent as any).items.length > 0
                  ? (versions.structuredContent as any).items[
                      (versions.structuredContent as any).items.length - 1
                    ].version
                  : "",
              is_deploy: true,
              __await_version_input: true,
              suggested_version:
                versions.structuredContent &&
                Array.isArray((versions.structuredContent as any).items) &&
                (versions.structuredContent as any).items.length > 0
                  ? (versions.structuredContent as any).items[
                      (versions.structuredContent as any).items.length - 1
                    ].version
                  : "",
            },
            deferredAction: {
              toolName: "rainbond_install_app_model",
              requiresApproval: true,
              missingArgument: "app_model_version",
              suggestedValue:
                versions.structuredContent &&
                Array.isArray((versions.structuredContent as any).items) &&
                (versions.structuredContent as any).items.length > 0
                  ? (versions.structuredContent as any).items[
                      (versions.structuredContent as any).items.length - 1
                    ].version
                  : "",
              arguments: {
                team_name: result.candidateScope.teamName || actor.tenantId,
                region_name:
                  result.candidateScope.regionName || actor.regionName || "",
                app_id: parseAppId(result.candidateScope.appId),
                source: "local",
                app_model_id: modelId,
                app_model_version:
                  versions.structuredContent &&
                  Array.isArray((versions.structuredContent as any).items) &&
                  (versions.structuredContent as any).items.length > 0
                    ? (versions.structuredContent as any).items[
                        (versions.structuredContent as any).items.length - 1
                      ].version
                    : "",
                is_deploy: true,
              },
            },
          },
        };
      }
      return {
        summary: "已查询当前企业下可安装的本地模板，下一步可继续选择模板版本并执行安装。",
        toolCalls: [{ name: "rainbond_query_local_app_models", status: "success" }],
        lastSequence: 5,
      };
    }

    if (result.selectedWorkflow === "rainbond-app-version-assistant") {
      const input = {
        team_name: result.candidateScope.teamName || actor.tenantId,
        region_name: result.candidateScope.regionName || actor.regionName || "",
        app_id: parseAppId(result.candidateScope.appId),
      };
      await this.publishToolTrace(actor.tenantId, sessionId, runId, 4, {
        tool_name: "rainbond_get_app_version_overview",
        input,
      });
      const output = await client.callTool("rainbond_get_app_version_overview", input);
      await this.publishToolTrace(actor.tenantId, sessionId, runId, 5, {
        tool_name: "rainbond_get_app_version_overview",
        input,
        output,
      });
      await this.publishToolTrace(actor.tenantId, sessionId, runId, 6, {
        tool_name: "rainbond_list_app_version_snapshots",
        input,
      });
      const snapshots = await client.callTool(
        "rainbond_list_app_version_snapshots",
        input
      );
      await this.publishToolTrace(actor.tenantId, sessionId, runId, 7, {
        tool_name: "rainbond_list_app_version_snapshots",
        input,
        output: snapshots,
      });
      const snapshotItems =
        snapshots.structuredContent &&
        Array.isArray((snapshots.structuredContent as any).items)
          ? (snapshots.structuredContent as any).items
          : [];
      const latestSnapshot = snapshotItems[0];
      let latestSnapshotDetail:
        | McpToolResult<Record<string, unknown>>
        | undefined;
      if (latestSnapshot && latestSnapshot.version_id) {
        const detailInput = {
          ...input,
          version_id: latestSnapshot.version_id,
        };
        await this.publishToolTrace(actor.tenantId, sessionId, runId, 8, {
          tool_name: "rainbond_get_app_version_snapshot_detail",
          input: detailInput,
        });
        latestSnapshotDetail = await client.callTool(
          "rainbond_get_app_version_snapshot_detail",
          detailInput
        );
        await this.publishToolTrace(actor.tenantId, sessionId, runId, 9, {
          tool_name: "rainbond_get_app_version_snapshot_detail",
          input: detailInput,
          output: latestSnapshotDetail,
        });
      }
      const overviewPayload =
        output.structuredContent && typeof output.structuredContent === "object"
          ? (output.structuredContent as Record<string, unknown>)
          : {};
      const overviewData =
        overviewPayload.overview && typeof overviewPayload.overview === "object"
          ? (overviewPayload.overview as Record<string, unknown>)
          : overviewPayload;
      const latestSnapshotVersion = readStructuredString(
        latestSnapshot as Record<string, unknown> | undefined,
        "version"
      );
      const latestSnapshotServiceCount =
        latestSnapshotDetail &&
        latestSnapshotDetail.structuredContent &&
        (latestSnapshotDetail.structuredContent as any).detail &&
        Array.isArray((latestSnapshotDetail.structuredContent as any).detail.services)
          ? (latestSnapshotDetail.structuredContent as any).detail.services.length
          : 0;
      const currentVersion = readStructuredString(overviewData, "current_version");
      const createSnapshotInput = {
        team_name: result.candidateScope.teamName || actor.tenantId,
        region_name: result.candidateScope.regionName || actor.regionName || "",
        app_id: parseAppId(result.candidateScope.appId),
      };
      const baseToolCalls: Array<{ name: string; status: string }> = [
        { name: "rainbond_get_app_version_overview", status: "success" },
        { name: "rainbond_list_app_version_snapshots", status: "success" },
        ...(latestSnapshotDetail
          ? [{ name: "rainbond_get_app_version_snapshot_detail", status: "success" as const }]
          : []),
      ];
      const baseSubflowData: Record<string, unknown> = {
        currentVersion,
        snapshotCount: snapshotItems.length,
        latestSnapshotVersion,
        latestSnapshotServiceCount,
      };

      if (shouldAutoCreateSnapshot(message)) {
        const requestedSnapshotVersion = parseSnapshotVersionInput(message);

        if (requestedSnapshotVersion) {
          const createSnapshotWithVersionInput = {
            ...createSnapshotInput,
            version: requestedSnapshotVersion,
          };
          const createSequence = (latestSnapshotDetail ? 9 : 7) + 1;
          await this.publishToolTrace(actor.tenantId, sessionId, runId, createSequence, {
            tool_name: "rainbond_create_app_version_snapshot",
            input: createSnapshotWithVersionInput,
          });
          const createSnapshotOutput = await client.callTool(
            "rainbond_create_app_version_snapshot",
            createSnapshotWithVersionInput
          );
          await this.publishToolTrace(actor.tenantId, sessionId, runId, createSequence + 1, {
            tool_name: "rainbond_create_app_version_snapshot",
            input: createSnapshotWithVersionInput,
            output: createSnapshotOutput,
          });

          return {
            summary: `已创建应用快照 ${requestedSnapshotVersion}，可以继续执行发布或回滚。`,
            toolCalls: [
              ...baseToolCalls,
              { name: "rainbond_create_app_version_snapshot", status: "success" },
            ],
            lastSequence: createSequence + 1,
            subflowData: {
              ...baseSubflowData,
              snapshotVersion: requestedSnapshotVersion,
            },
            structuredResultPatch: {
              executedAction: {
                toolName: "rainbond_create_app_version_snapshot",
                requiresApproval: false,
              },
            },
          };
        }

        const suggestedSnapshotVersion = suggestNextSnapshotVersion(
          latestSnapshotVersion || currentVersion
        );
        return {
          summary: `已读取版本中心概览，建议新快照版本为 ${suggestedSnapshotVersion}。请直接回复版本号，我会为当前运行态创建新的快照。`,
          toolCalls: baseToolCalls,
          lastSequence: latestSnapshotDetail ? 9 : 7,
          subflowData: {
            ...baseSubflowData,
            suggestedSnapshotVersion,
          },
          proposedToolAction: {
            toolName: "rainbond_create_app_version_snapshot",
            requiresApproval: false,
            arguments: {
              ...createSnapshotInput,
              __await_version_input: true,
              suggested_version: suggestedSnapshotVersion,
            },
            deferredAction: {
              toolName: "rainbond_create_app_version_snapshot",
              requiresApproval: false,
              missingArgument: "version",
              suggestedValue: suggestedSnapshotVersion,
              arguments: createSnapshotInput,
            },
          },
        };
      }

      if (shouldAutoRollbackSnapshot(message)) {
        const requestedRollbackVersion = parseSnapshotVersionInput(message);
        if (!requestedRollbackVersion) {
          const suggestedRollbackVersion = suggestRollbackSnapshotVersion(
            snapshotItems as Array<Record<string, unknown>>
          );
          return {
            summary: `已读取版本中心概览，请直接回复要回滚到的快照版本号，例如 ${suggestedRollbackVersion}。`,
            toolCalls: baseToolCalls,
            lastSequence: latestSnapshotDetail ? 9 : 7,
            subflowData: {
              ...baseSubflowData,
              suggestedRollbackVersion,
            },
            proposedToolAction: {
              toolName: "rainbond_rollback_app_version_snapshot",
              requiresApproval: true,
              arguments: {
                ...createSnapshotInput,
                __await_version_input: true,
                suggested_version: suggestedRollbackVersion,
              },
              deferredAction: {
                toolName: "rainbond_rollback_app_version_snapshot",
                requiresApproval: true,
                missingArgument: "version_id",
                suggestedValue: suggestedRollbackVersion,
                arguments: createSnapshotInput,
                resolutionTool: {
                  toolName: "rainbond_list_app_version_snapshots",
                  arguments: createSnapshotInput,
                },
              },
            },
          };
        }
      }

      return {
        summary: "已查询版本中心概览，下一步可继续进入快照、发布或回滚动作。",
        toolCalls: baseToolCalls,
        lastSequence: latestSnapshotDetail ? 9 : 7,
        subflowData: baseSubflowData,
      };
    }

    if (
      result.selectedWorkflow === "rainbond-fullstack-bootstrap" ||
      result.selectedWorkflow === "rainbond-delivery-verifier" ||
      result.selectedWorkflow === "rainbond-fullstack-troubleshooter"
    ) {
      const input = {
        team_name: result.candidateScope.teamName || actor.tenantId,
        region_name: result.candidateScope.regionName || actor.regionName || "",
        app_id: parseAppId(result.candidateScope.appId),
      };
      await this.publishToolTrace(actor.tenantId, sessionId, runId, 4, {
        tool_name: "rainbond_get_app_detail",
        input,
      });
      const output = await client.callTool("rainbond_get_app_detail", input);
      await this.publishToolTrace(actor.tenantId, sessionId, runId, 5, {
        tool_name: "rainbond_get_app_detail",
        input,
        output,
      });

      if (
        (result.selectedWorkflow === "rainbond-fullstack-bootstrap" ||
          result.selectedWorkflow === "rainbond-delivery-verifier" ||
          result.selectedWorkflow === "rainbond-fullstack-troubleshooter") &&
        actor.enterpriseId
      ) {
        const componentInput = {
          enterprise_id: actor.enterpriseId,
          app_id: parseAppId(result.candidateScope.appId),
          page: 1,
          page_size: 20,
        };
        await this.publishToolTrace(actor.tenantId, sessionId, runId, 6, {
          tool_name: "rainbond_query_components",
          input: componentInput,
        });
        const components = await client.callTool(
          "rainbond_query_components",
          componentInput
        );
        await this.publishToolTrace(actor.tenantId, sessionId, runId, 7, {
          tool_name: "rainbond_query_components",
          input: componentInput,
          output: components,
        });

        const componentItems =
          components.structuredContent &&
          Array.isArray((components.structuredContent as any).items)
            ? (components.structuredContent as any).items
            : [];

        if (
          result.selectedWorkflow === "rainbond-fullstack-bootstrap" &&
          componentItems.length === 0
        ) {
          if (!parseHelmCreationIntent(message)) {
            return {
              summary: "已读取当前应用与组件概况，当前应用下暂无组件，可继续补充组件来源信息后再创建首个组件。",
              toolCalls: [
                { name: "rainbond_get_app_detail", status: "success" },
                { name: "rainbond_query_components", status: "success" },
              ],
              lastSequence: 7,
              subflowData: {
                appStatus:
                  output.structuredContent &&
                  (output.structuredContent as any).status
                    ? (output.structuredContent as any).status
                    : undefined,
                componentCount: 0,
              },
            };
          }

          const helmIntent = parseHelmCreationIntent(message);
          if (helmIntent) {
            return {
              summary: "已确认当前应用尚无组件，下一步可继续校验 Helm chart 并生成模板。",
              toolCalls: [
                { name: "rainbond_get_app_detail", status: "success" },
                { name: "rainbond_query_components", status: "success" },
              ],
              lastSequence: 7,
              subflowData: {
                appStatus:
                  output.structuredContent &&
                  (output.structuredContent as any).status
                    ? (output.structuredContent as any).status
                    : undefined,
                componentCount: 0,
              },
            };
          }
        }

        const firstComponent = componentItems[0];
        if (firstComponent && firstComponent.service_id) {
          const summaryInput = {
            team_name: result.candidateScope.teamName || actor.tenantId,
            region_name: result.candidateScope.regionName || actor.regionName || "",
            app_id: parseAppId(result.candidateScope.appId),
            service_id: firstComponent.service_id,
          };
          await this.publishToolTrace(actor.tenantId, sessionId, runId, 8, {
            tool_name: "rainbond_get_component_summary",
            input: summaryInput,
          });
          const summary = await client.callTool(
            "rainbond_get_component_summary",
            summaryInput
          );
          await this.publishToolTrace(actor.tenantId, sessionId, runId, 9, {
            tool_name: "rainbond_get_component_summary",
            input: summaryInput,
            output: summary,
          });

          const summaryMapWithSummary: Record<string, string> = {
            "rainbond-delivery-verifier":
              "已读取应用、组件及关键组件摘要，下一步可继续判断运行态、关键组件和访问路径。",
            "rainbond-fullstack-troubleshooter":
              "已读取应用、组件及关键组件摘要，下一步可继续进入低风险排障流程。",
            "rainbond-fullstack-bootstrap":
              "已读取应用、组件及关键组件摘要，下一步可继续进入拓扑创建、组件复用和部署流程。",
          };

          if (
            result.selectedWorkflow === "rainbond-fullstack-troubleshooter" &&
            /数据库|db|postgres|mysql/i.test(message)
          ) {
            const logsInput = {
              team_name: result.candidateScope.teamName || actor.tenantId,
              region_name: result.candidateScope.regionName || actor.regionName || "",
              app_id: parseAppId(result.candidateScope.appId),
              service_id: firstComponent.service_id,
              lines: 100,
            };
            await this.publishToolTrace(actor.tenantId, sessionId, runId, 10, {
              tool_name: "rainbond_get_component_logs",
              input: logsInput,
            });
            const logsOutput = await client.callTool(
              "rainbond_get_component_logs",
              logsInput
            );
            await this.publishToolTrace(actor.tenantId, sessionId, runId, 11, {
              tool_name: "rainbond_get_component_logs",
              input: logsInput,
              output: logsOutput,
            });

            const logs = extractLogTexts(
              logsOutput.structuredContent as Record<string, unknown>
            );
            const dbComponent = findDatabaseLikeComponent(
              componentItems as Array<Record<string, unknown>>,
              String(firstComponent.service_id)
            );
            if (logsSuggestDependencyIssue(logs) && dbComponent) {
              return {
                summary: "已读取关键组件日志，发现疑似数据库连接问题，可继续根据日志和依赖关系排查。",
                toolCalls: [
                  { name: "rainbond_get_app_detail", status: "success" },
                  { name: "rainbond_query_components", status: "success" },
                  { name: "rainbond_get_component_summary", status: "success" },
                  { name: "rainbond_get_component_logs", status: "success" },
                ],
                lastSequence: 11,
                subflowData: {
                  appStatus:
                    output.structuredContent &&
                    (output.structuredContent as any).status
                      ? (output.structuredContent as any).status
                      : undefined,
                  componentCount: componentItems.length,
                  inspectedComponentStatus:
                    summary.structuredContent &&
                    (summary.structuredContent as any).status
                      ? (summary.structuredContent as any).status.status
                      : undefined,
                  blockerHint: "dependency_missing",
                  runtimeState: "runtime_unhealthy",
                },
              };
            }

            if (logsSuggestEnvCompatibilityIssue(logs) && dbComponent) {
              return {
                summary: "已读取关键组件日志，发现疑似数据库连接环境变量不兼容，可继续检查环境变量配置。",
                toolCalls: [
                  { name: "rainbond_get_app_detail", status: "success" },
                  { name: "rainbond_query_components", status: "success" },
                  { name: "rainbond_get_component_summary", status: "success" },
                  { name: "rainbond_get_component_logs", status: "success" },
                ],
                lastSequence: 11,
                subflowData: {
                  appStatus:
                    output.structuredContent &&
                    (output.structuredContent as any).status
                      ? (output.structuredContent as any).status
                      : undefined,
                  componentCount: componentItems.length,
                  inspectedComponentStatus:
                    summary.structuredContent &&
                    (summary.structuredContent as any).status
                      ? (summary.structuredContent as any).status.status
                      : undefined,
                  blockerHint: "env_naming_incompatibility",
                  runtimeState: "runtime_unhealthy",
                },
              };
            }
          }

          if (result.selectedWorkflow === "rainbond-fullstack-troubleshooter") {
            const inspectionIntent = detectTroubleshooterInspectionTool(message);
            if (inspectionIntent) {
              return {
                summary: "已读取当前应用与关键组件摘要，下一步可继续检查对应配置项。",
                toolCalls: [
                  { name: "rainbond_get_app_detail", status: "success" },
                  { name: "rainbond_query_components", status: "success" },
                  { name: "rainbond_get_component_summary", status: "success" },
                ],
                lastSequence: 9,
                subflowData: {
                  appStatus:
                    output.structuredContent &&
                    (output.structuredContent as any).status
                      ? (output.structuredContent as any).status
                      : undefined,
                  componentCount: componentItems.length,
                  inspectedComponentStatus:
                    summary.structuredContent &&
                    (summary.structuredContent as any).status
                      ? (summary.structuredContent as any).status.status
                      : undefined,
                },
              };
            }
          }

          return {
            summary:
              summaryMapWithSummary[result.selectedWorkflow] || "",
            toolCalls: [
              { name: "rainbond_get_app_detail", status: "success" },
              { name: "rainbond_query_components", status: "success" },
              { name: "rainbond_get_component_summary", status: "success" },
            ],
            lastSequence: 9,
            subflowData: {
              appStatus:
                output.structuredContent &&
                (output.structuredContent as any).status
                  ? (output.structuredContent as any).status
                  : undefined,
              componentCount: componentItems.length,
              inspectedComponentStatus:
                summary.structuredContent &&
                (summary.structuredContent as any).status
                  ? (summary.structuredContent as any).status.status
                  : undefined,
              runtimeState:
                summary.structuredContent &&
                (summary.structuredContent as any).status &&
                (summary.structuredContent as any).status.status === "abnormal"
                  ? "runtime_unhealthy"
                  : summary.structuredContent &&
                      (summary.structuredContent as any).status &&
                      (summary.structuredContent as any).status.status === "running"
                    ? "runtime_healthy"
                    : undefined,
              deliveryState:
                result.selectedWorkflow === "rainbond-delivery-verifier" &&
                summary.structuredContent &&
                (summary.structuredContent as any).status &&
                (summary.structuredContent as any).status.status === "running"
                  ? "delivered-but-needs-manual-validation"
                  : undefined,
              blockerHint:
                result.selectedWorkflow === "rainbond-fullstack-troubleshooter" &&
                summary.structuredContent &&
                (summary.structuredContent as any).status &&
                (summary.structuredContent as any).status.status === "abnormal"
                  ? "runtime_unhealthy"
                  : undefined,
            },
          };
        }

        const summaryMapWithComponents: Record<string, string> = {
          "rainbond-fullstack-bootstrap":
            "已读取应用与组件概况，下一步可继续进入拓扑创建、组件复用和部署流程。",
          "rainbond-delivery-verifier":
            "已读取应用与组件概况，下一步可继续判断运行态、关键组件和访问路径。",
          "rainbond-fullstack-troubleshooter":
            "已读取应用与组件概况，下一步可继续进入低风险排障流程。",
        };

        return {
          summary:
            summaryMapWithComponents[result.selectedWorkflow] || "",
          toolCalls: [
            { name: "rainbond_get_app_detail", status: "success" },
            { name: "rainbond_query_components", status: "success" },
          ],
          lastSequence: 7,
        };
      }

      const summaryMap: Record<string, string> = {
        "rainbond-fullstack-bootstrap":
          "已读取当前应用详情，下一步可继续进入拓扑创建与最小可运行部署。",
        "rainbond-delivery-verifier":
          "已读取当前应用交付概况，下一步可继续判断运行态与访问路径。",
        "rainbond-fullstack-troubleshooter":
          "已读取当前应用运行概况，下一步可继续进入低风险排障流程。",
      };

      return {
        summary: summaryMap[result.selectedWorkflow],
        toolCalls: [{ name: "rainbond_get_app_detail", status: "success" }],
        lastSequence: 5,
      };
    }

    return { toolCalls: [] };
  }

  private async executePendingWorkflowAction(
    params: ExecuteWorkflowParams,
    session: SessionRecord
  ): Promise<boolean> {
    const pending = session.pendingWorkflowAction;
    if (!pending) {
      return false;
    }

    await this.deps.eventPublisher.publish({
      type: "workflow.selected",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 2,
      data: {
        workflow_id: "pending-workflow-action",
        workflow_name: "Pending Workflow Action",
      },
    });

    if (pending.requiresApproval) {
      await this.deps.eventPublisher.publish({
        type: "chat.message",
        tenantId: params.actor.tenantId,
        sessionId: params.sessionId,
        runId: params.runId,
        sequence: 3,
        data: {
          role: "assistant",
          content: "该动作已准备完成，但根据当前策略仍需接入统一审批后才能真正执行。",
        },
      });
      await this.deps.eventPublisher.publish({
        type: "workflow.completed",
        tenantId: params.actor.tenantId,
        sessionId: params.sessionId,
        runId: params.runId,
        sequence: 4,
        data: {
          workflow_id: "pending-workflow-action",
          workflow_stage: "approval-required",
          next_action: "request_approval",
          structured_result: {
            pendingAction: pending,
          },
        },
      });
      await this.deps.eventPublisher.publish({
        type: "run.status",
        tenantId: params.actor.tenantId,
        sessionId: params.sessionId,
        runId: params.runId,
        sequence: 5,
        data: {
          status: "done",
        },
      });
      return true;
    }

    if (!this.deps.workflowToolClientFactory) {
      return false;
    }

    const client = await this.deps.workflowToolClientFactory({
      actor: params.actor,
      sessionId: params.sessionId,
    });
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 3, {
      tool_name: pending.toolName,
      input: pending.arguments,
    });
    const output = await client.callTool(pending.toolName, pending.arguments);
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 4, {
      tool_name: pending.toolName,
      input: pending.arguments,
      output,
    });
    const completion = buildPendingWorkflowActionCompletion(pending, output);

    await this.deps.sessionStore.update({
      ...session,
      pendingWorkflowAction: undefined,
    });

    await this.deps.eventPublisher.publish({
      type: "chat.message",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 5,
      data: {
        role: "assistant",
        content: completion.summary,
      },
    });
    await this.deps.eventPublisher.publish({
      type: "workflow.completed",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 6,
      data: {
        workflow_id: "pending-workflow-action",
        workflow_stage: completion.workflowStage,
        next_action: completion.nextAction,
        structured_result: {
          ...completion.structuredResult,
        },
      },
    });
    await this.deps.eventPublisher.publish({
      type: "run.status",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 7,
      data: {
        status: "done",
      },
    });
    return true;
  }

  private async publishToolTrace(
    tenantId: string,
    sessionId: string,
    runId: string,
    sequence: number,
    data: Record<string, unknown>
  ) {
    const traceSequenceBase =
      data && typeof data.output !== "undefined" ? sequence - 1 : sequence;
    const tracePayload = {
      ...data,
      trace_id:
        typeof data.trace_id === "string" && data.trace_id
          ? data.trace_id
          : `trace_${runId}_${traceSequenceBase}`,
    };
    await this.deps.eventPublisher.publish({
      type: "chat.trace",
      tenantId,
      sessionId,
      runId,
      sequence,
      data: tracePayload,
    });
  }
}
