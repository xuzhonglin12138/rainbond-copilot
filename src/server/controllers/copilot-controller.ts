import type { RequestActor } from "../../shared/types.js";
import { PersistedEventPublisher } from "../events/persisted-event-publisher.js";
import { createSseBroker, type SseBroker } from "../events/sse-broker.js";
import type { RainbondQueryToolClient } from "../integrations/rainbond-mcp/query-tools.js";
import { copilotRoutes } from "../routes/copilot-routes.js";
import {
  createInMemoryRunResumer,
  type RunResumer,
} from "../runtime/run-resumer.js";
import { ServerLlmExecutor, type ServerChatClient } from "../runtime/server-llm-executor.js";
import { ServerRunExecutor } from "../runtime/server-run-executor.js";
import { CopilotApprovalService } from "../services/copilot-approval-service.js";
import {
  createInMemoryApprovalStore,
  type ApprovalStore,
} from "../stores/approval-store.js";
import { createInMemoryEventStore } from "../stores/event-store.js";
import {
  createInMemoryRunStore,
  type RunStore,
} from "../stores/run-store.js";
import {
  createInMemorySessionStore,
  type SessionStore,
} from "../stores/session-store.js";
import {
  CopilotSessionService,
  type CreateSessionInput,
} from "../services/copilot-session-service.js";
import { CopilotRunService } from "../services/copilot-run-service.js";
import type { ActionAdapter } from "../runtime/skill-types.js";
import { createServerActionSkills } from "../runtime/server-action-skills.js";
import { WorkflowExecutor } from "../workflows/executor.js";
import type { WorkflowToolClientFactory } from "../workflows/executor.js";
import { isContinueWorkflowActionPrompt } from "../workflows/executor.js";
import { buildPendingWorkflowActionCompletion } from "../workflows/pending-action-result.js";
import type {
  PendingLlmContinuation,
  PendingWorkflowAction,
} from "../stores/session-store.js";
import { getMutableToolPolicy } from "../integrations/rainbond-mcp/mutable-tool-policy.js";

interface ControllerDeps {
  sessionStore?: SessionStore;
  runStore?: RunStore;
  approvalStore?: ApprovalStore;
  broker?: SseBroker;
  runResumer?: RunResumer;
  llmClient?: ServerChatClient | null;
  actionAdapter?: ActionAdapter;
  actionAdapterFactory?: (params: {
    actor: RequestActor;
    sessionId: string;
  }) => Promise<ActionAdapter> | ActionAdapter;
  workflowToolClientFactory?: WorkflowToolClientFactory;
  queryToolClientFactory?: (params: {
    actor: RequestActor;
    sessionId: string;
  }) => Promise<RainbondQueryToolClient> | RainbondQueryToolClient;
  enableRainbondAppAssistantWorkflow?: boolean;
  enableLegacyActionSkills?: boolean;
}

interface CreateSessionRequest {
  actor: RequestActor;
  body?: {
    context?: Record<string, unknown>;
  };
}

interface CreateMessageRunRequest {
  actor: RequestActor;
  params: {
    sessionId: string;
  };
  body: {
    message: string;
    stream?: boolean;
    context?: Record<string, unknown>;
  };
}

interface StreamRunEventsRequest {
  actor: RequestActor;
  params: {
    sessionId: string;
    runId: string;
  };
  query?: {
    after_sequence?: string;
  };
}

interface DecideApprovalRequest {
  actor: RequestActor;
  params: {
    approvalId: string;
  };
  body: {
    decision: "approved" | "rejected";
    comment?: string;
  };
}

function readContextString(
  context: Record<string, unknown> | undefined,
  ...keys: string[]
): string {
  if (!context) {
    return "";
  }
  for (const key of keys) {
    const value = context[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function readContextInt(
  context: Record<string, unknown> | undefined,
  ...keys: string[]
): number {
  const raw = readContextString(context, ...keys);
  if (!raw) {
    return 0;
  }
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readContextAppId(
  context: Record<string, unknown> | undefined,
  ...keys: string[]
): number {
  const raw = readContextString(context, ...keys);
  if (!raw) {
    return 0;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const matched = raw.match(/(\d+)/);
  return matched && matched[1] ? Number(matched[1]) : 0;
}

function isDeleteCurrentAppIntent(
  message: string,
  context?: Record<string, unknown>
): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }

  const hasAppContext = !!readContextInt(context, "appId", "app_id");
  if (!hasAppContext) {
    return false;
  }

  const mentionsDelete = /(删除|delete|remove|移除)/i.test(normalized);
  const mentionsApp = /(应用|app)/i.test(normalized);
  const mentionsCurrentApp = /(这个应用|当前应用|当前这个应用|该应用)/.test(normalized);

  return mentionsDelete && (mentionsCurrentApp || mentionsApp);
}

function readContextResourceType(
  context?: Record<string, unknown>
): string {
  if (!context || typeof context.resource !== "object" || !context.resource) {
    return "";
  }
  const type = (context.resource as Record<string, unknown>).type;
  return typeof type === "string" ? type.trim() : "";
}

function looksLikeMutationQuestion(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }

  if (/确认/.test(normalized)) {
    return false;
  }

  return (
    /[？?]$/.test(normalized) ||
    /(如何|怎么|为什么|是否|会不会|能否|可否|是什么)/i.test(normalized)
  );
}

type ContextualMutationAction = "delete" | "stop" | "start" | "restart";
type ContextualMutationTarget = "app" | "component";

function parseMemoryScaleTarget(message: string): number | null {
  const normalized = (message || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!/(内存|memory|扩容|scale)/i.test(normalized)) {
    return null;
  }

  const matched = normalized.match(/(\d{1,5})\s*(gb|g|mb|m)?/i);
  if (!matched) {
    return null;
  }

  const value = Number(matched[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const unit = (matched[2] || "mb").toLowerCase();
  if (unit === "gb" || unit === "g") {
    return value * 1024;
  }
  return value;
}

function parseImageTarget(message: string): string {
  const normalized = (message || "").trim();
  if (!normalized || !/(镜像|image)/i.test(normalized)) {
    return "";
  }

  const patterns = [
    /(?:镜像|image)[^。，“”"'`]*?(?:改成|换成|设置为|设为|to)\s*([A-Za-z0-9./:_-]+)/i,
    /(?:改成|换成|设置为|设为)\s*([A-Za-z0-9./:_-]+)[^。，“”"'`]*?(?:镜像|image)/i,
  ];

  for (const pattern of patterns) {
    const matched = normalized.match(pattern);
    if (matched && matched[1]) {
      return matched[1];
    }
  }

  return "";
}

function parsePortManagementIntent(message: string): {
  operation: "enable_inner" | "disable_inner" | "enable_outer" | "disable_outer";
  port: number;
} | null {
  const normalized = (message || "").trim();
  if (!normalized || !/(端口|port)/i.test(normalized)) {
    return null;
  }

  const portMatch = normalized.match(/(\d{2,5})/);
  if (!portMatch) {
    return null;
  }
  const port = Number(portMatch[1]);
  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }

  if (/(开启|打开|启用).*(对内|内网|inner)/i.test(normalized)) {
    return { operation: "enable_inner", port };
  }
  if (/(关闭|禁用).*(对内|内网|inner)/i.test(normalized)) {
    return { operation: "disable_inner", port };
  }
  if (/(开启|打开|启用).*(对外|外网|outer)/i.test(normalized)) {
    return { operation: "enable_outer", port };
  }
  if (/(关闭|禁用).*(对外|外网|outer)/i.test(normalized)) {
    return { operation: "disable_outer", port };
  }

  return null;
}

function parseConnectionEnvIntent(message: string): {
  attrName: string;
  attrValue: string;
} | null {
  const normalized = (message || "").trim();
  if (!normalized || !/(连接信息|outer env|connection env|连接变量)/i.test(normalized)) {
    return null;
  }
  const match = normalized.match(/\b([A-Z][A-Z0-9_]+)\s*=\s*([^\s]+)/);
  if (!match) {
    return null;
  }
  return {
    attrName: match[1],
    attrValue: match[2],
  };
}

function parseInnerEnvIntent(message: string): {
  attrName: string;
  attrValue: string;
} | null {
  const normalized = (message || "").trim();
  if (!normalized || !/(环境变量|env)/i.test(normalized)) {
    return null;
  }
  const match = normalized.match(/\b([A-Z][A-Z0-9_]+)\s*=\s*([A-Za-z0-9._:/-]+)/);
  if (!match) {
    return null;
  }
  return {
    attrName: match[1],
    attrValue: match[2],
  };
}

function requestsSnapshotCreation(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }
  return /(创建.*快照|生成.*快照|create.*snapshot)/i.test(normalized);
}

function parseSnapshotRollbackVersion(message: string): string {
  const normalized = (message || "").trim();
  if (!normalized || !/(回滚|rollback)/i.test(normalized)) {
    return "";
  }

  const matched = normalized.match(/(\d+\.\d+\.\d+|\d+\.\d+)/);
  if (!matched || !matched[1]) {
    return "";
  }

  return matched[1];
}

function parseSnapshotCreateVersionInput(message: string): string {
  const normalized = (message || "").trim();
  if (!normalized) {
    return "";
  }

  const matched = normalized.match(/\b(v?\d+\.\d+(?:\.\d+)?)\b/i);
  return matched && matched[1] ? matched[1] : "";
}

function requestsRollbackToPreviousSnapshot(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized || !/(回滚|rollback)/i.test(normalized)) {
    return false;
  }

  return /(上一个版本|上个版本|上一版本|前一个版本|上一个快照|上个快照|上一快照|previous version|previous snapshot)/i.test(
    normalized
  );
}

function requestsCloseWholeApp(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }

  return /(关闭整个应用|关闭当前应用|关闭应用|停止整个应用|停止当前应用|停止应用|close.*app|stop.*app)/i.test(
    normalized
  );
}

function findPreviousSnapshotVersionId(
  payload: Record<string, unknown>
): number {
  if (!payload || !Array.isArray((payload as any).items)) {
    return 0;
  }

  const items = (payload as any).items as Array<Record<string, unknown>>;
  if (items.length < 2) {
    return 0;
  }

  return readContextInt(items[1], "version_id", "ID", "id");
}

function findPreviousSnapshotVersion(
  payload: Record<string, unknown>
): string {
  if (!payload || !Array.isArray((payload as any).items)) {
    return "";
  }

  const items = (payload as any).items as Array<Record<string, unknown>>;
  if (items.length < 2) {
    return "";
  }

  return readContextString(items[1], "version", "share_version", "snapshot_version");
}

async function hydrateVerticalScaleArguments(
  client: {
    callTool: <T = unknown>(
      name: string,
      arguments_: Record<string, unknown>
    ) => Promise<{ structuredContent: T }>;
  },
  arguments_: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (
    typeof arguments_.new_gpu === "number" ||
    typeof arguments_.team_name !== "string" ||
    typeof arguments_.region_name !== "string" ||
    typeof arguments_.service_id !== "string"
  ) {
    return arguments_;
  }

  try {
    const summary = await client.callTool<{
      service?: { container_gpu?: number | null };
    }>("rainbond_get_component_summary", {
      team_name: arguments_.team_name,
      region_name: arguments_.region_name,
      app_id: arguments_.app_id,
      service_id: arguments_.service_id,
      event_limit: 1,
    });
    const gpu = summary.structuredContent?.service?.container_gpu;

    return {
      ...arguments_,
      new_gpu: typeof gpu === "number" ? gpu : 0,
    };
  } catch {
    return {
      ...arguments_,
      new_gpu: 0,
    };
  }
}

function findSnapshotVersionId(
  payload: Record<string, unknown>,
  targetVersion: string
): number {
  if (!payload || !Array.isArray((payload as any).items) || !targetVersion) {
    return 0;
  }

  const normalizedTarget = String(targetVersion).trim();
  const matched = (payload as any).items.find((item: Record<string, unknown>) => {
    const version =
      readContextString(item, "version", "share_version", "snapshot_version");
    return version === normalizedTarget;
  });

  if (!matched) {
    return 0;
  }

  return readContextInt(matched, "version_id", "ID", "id");
}

function detectContextualMutationIntent(
  message: string,
  context?: Record<string, unknown>
): {
  action: ContextualMutationAction;
  target: ContextualMutationTarget;
} | null {
  const normalized = (message || "").trim();
  if (!normalized || looksLikeMutationQuestion(normalized)) {
    return null;
  }

  let action: ContextualMutationAction | null = null;
  if (/(删除|移除|remove|delete)/i.test(normalized)) {
    action = "delete";
  } else if (/(重启|restart|reboot)/i.test(normalized)) {
    action = "restart";
  } else if (/(关闭|停止|stop|shutdown)/i.test(normalized)) {
    action = "stop";
  } else if (/(启动|开启|start)/i.test(normalized)) {
    action = "start";
  }

  if (!action) {
    return null;
  }

  const resourceType = readContextResourceType(context);
  const hasComponentContext = !!readContextString(
    context,
    "componentId",
    "component_id"
  );
  const hasAppContext = !!readContextInt(context, "appId", "app_id");
  const currentComponentCommand =
    /(确认关闭|确认启动|确认重启|确认删除|关闭当前组件|启动当前组件|重启当前组件|删除当前组件|关闭组件|启动组件|重启组件|删除组件)/i.test(
      normalized
    );
  const currentAppCommand =
    /(删除这个应用|删除当前应用|关闭当前应用|启动当前应用|重启当前应用|删除应用|关闭应用|启动应用|重启应用)/i.test(
      normalized
    );

  if ((resourceType === "component" || hasComponentContext) && currentComponentCommand) {
    return {
      action,
      target: "component",
    };
  }

  if ((resourceType === "app" || hasAppContext) && currentAppCommand) {
    return {
      action,
      target: "app",
    };
  }

  const explicitComponent =
    /(当前组件|这个组件|该组件|当前服务|这个服务|该服务|组件|服务|component|service)/i.test(
      normalized
    );
  const explicitApp = /(当前应用|这个应用|该应用|应用|app)/i.test(normalized);

  let target: ContextualMutationTarget | null = null;
  if (explicitComponent) {
    target = "component";
  } else if (explicitApp) {
    target = "app";
  } else if (resourceType === "component" || hasComponentContext) {
    target = "component";
  } else if (resourceType === "app" || hasAppContext) {
    target = "app";
  }

  if (!target) {
    return null;
  }

  return {
    action,
    target,
  };
}

function buildContextualOperateDescription(
  action: Exclude<ContextualMutationAction, "delete">,
  target: ContextualMutationTarget,
  label: string
): string {
  if (target === "component") {
    if (action === "stop") {
      return `关闭当前组件 ${label}`;
    }
    if (action === "start") {
      return `启动当前组件 ${label}`;
    }
    return `重启当前组件 ${label}`;
  }

  if (action === "stop") {
    return `关闭当前应用 ${label}`;
  }
  if (action === "start") {
    return `启动当前应用 ${label}`;
  }
  return `重启当前应用 ${label}`;
}

export function createCopilotController(deps: ControllerDeps = {}) {
  const enableLegacyActionSkills = deps.enableLegacyActionSkills === true;
  const sessionStore = deps.sessionStore ?? createInMemorySessionStore();
  const runStore = deps.runStore ?? createInMemoryRunStore();
  const approvalStore = deps.approvalStore ?? createInMemoryApprovalStore();
  const broker = deps.broker ?? createSseBroker(createInMemoryEventStore());
  const runResumer = deps.runResumer ?? createInMemoryRunResumer();
  const eventPublisher = new PersistedEventPublisher(broker);
  const sessionService = new CopilotSessionService(sessionStore);
  const runService = new CopilotRunService(runStore, sessionStore);
  const workflowExecutor = new WorkflowExecutor({
    eventPublisher,
    sessionStore,
    workflowToolClientFactory: deps.workflowToolClientFactory,
    enableRainbondAppAssistantWorkflow:
      deps.enableRainbondAppAssistantWorkflow,
  });
  const approvalService = new CopilotApprovalService({
    approvalStore,
    runStore,
    eventPublisher,
    broker,
    runResumer,
  });

  const resolveActionAdapter = async (params: {
    actor: RequestActor;
    sessionId: string;
  }): Promise<ActionAdapter | undefined> => {
    if (deps.actionAdapterFactory) {
      return deps.actionAdapterFactory(params);
    }
    return deps.actionAdapter;
  };

  const resolvePendingMcpClient = async (params: {
    actor: RequestActor;
    sessionId: string;
  }) => {
    const factory = deps.queryToolClientFactory ?? deps.workflowToolClientFactory;
    if (!factory) {
      throw new Error("MCP tool client factory is required");
    }
    return factory(params);
  };

  const createLlmExecutor = async (params: {
    actor: RequestActor;
    sessionId: string;
  }) => {
    const actionAdapter = deps.actionAdapterFactory
      ? await deps.actionAdapterFactory(params)
      : deps.actionAdapter;

    return new ServerLlmExecutor({
      broker,
      eventPublisher,
      llmClient: deps.llmClient,
      actionAdapter,
      queryToolClientFactory: deps.queryToolClientFactory,
      enableLegacyActionSkills,
      requestApproval: async (input) => {
        await queuePendingActionApproval(input);
      },
    });
  };

  const serializeToolResultForContinuation = (params: {
    pendingAction: PendingWorkflowAction;
    output: {
      isError: boolean;
      structuredContent: Record<string, unknown>;
      content: Array<{ type: string; text: string }>;
    };
  }): string => {
    if (params.pendingAction.kind === "action_skill") {
      return JSON.stringify(params.output.structuredContent || {});
    }

    return JSON.stringify({
      isError: params.output.isError,
      structuredContent: params.output.structuredContent || {},
    });
  };

  const executePendingAction = async (params: {
    actor: RequestActor;
    sessionId: string;
    runId: string;
  }) => {
    const currentRun = await runStore.getById(
      params.runId,
      params.actor.tenantId
    );
    if (!currentRun) {
      throw new Error("Run not found");
    }

    let currentSession = await sessionService.getSession(params.sessionId, {
      tenantId: params.actor.tenantId,
      userId: params.actor.userId,
    });
    let pendingAction = currentSession.pendingWorkflowAction;
    if (!pendingAction) {
      throw new Error("Pending workflow action not found");
    }

    const completedEvents = await broker.replay(
      params.runId,
      params.actor.tenantId,
      { afterSequence: 0 }
    );
    let nextSequence = completedEvents.length + 1;
    const completedSummaries: string[] = [];
    const executedToolCalls: Array<{ name: string; status: string }> = [];

    while (pendingAction) {
      let traceToolName = pendingAction.toolName;
      let output: {
        isError: boolean;
        structuredContent: Record<string, unknown>;
        content: Array<{ type: string; text: string }>;
      };

      await eventPublisher.publish({
        type: "chat.trace",
        tenantId: params.actor.tenantId,
        sessionId: params.sessionId,
        runId: params.runId,
        sequence: nextSequence,
        data: {
          tool_name: traceToolName,
          input: pendingAction.arguments,
        },
      });
      nextSequence += 1;

      try {
        if (pendingAction.kind === "action_skill") {
          const actionAdapter = await resolveActionAdapter({
            actor: params.actor,
            sessionId: params.sessionId,
          });
          if (!actionAdapter) {
            throw new Error("Action adapter is required");
          }
          const actionSkills = createServerActionSkills(actionAdapter);
          const skill = actionSkills[pendingAction.toolName];
          if (!skill) {
            throw new Error(`Unsupported action skill: ${pendingAction.toolName}`);
          }
          traceToolName = skill.name;
          const actionResult = (await skill.execute(
            pendingAction.arguments
          )) as Record<string, unknown>;
          output = {
            isError: false,
            structuredContent: actionResult,
            content: [],
          };
        } else {
          const client = await resolvePendingMcpClient({
            actor: params.actor,
            sessionId: params.sessionId,
          });
          const pendingArguments =
            pendingAction.toolName === "rainbond_vertical_scale_component"
              ? await hydrateVerticalScaleArguments(client as any, pendingAction.arguments)
              : pendingAction.arguments;
          output = await client.callTool(
            pendingAction.toolName,
            pendingArguments
          );
          pendingAction.arguments = pendingArguments;
        }
      } catch (error: any) {
        const errorMessage =
          error && typeof error.message === "string" && error.message
            ? error.message
            : "执行过程中发生错误，请稍后重试。";

        await sessionStore.update({
          ...currentSession,
          pendingWorkflowAction: undefined,
        });
        await runStore.update({
          ...currentRun,
          status: "failed",
          errorMessage,
          finishedAt: new Date().toISOString(),
        });

        await eventPublisher.publish({
          type: "run.error",
          tenantId: params.actor.tenantId,
          sessionId: params.sessionId,
          runId: params.runId,
          sequence: nextSequence,
          data: {
            code: "internal_error",
            message: errorMessage,
          },
        });
        nextSequence += 1;

        await eventPublisher.publish({
          type: "run.status",
          tenantId: params.actor.tenantId,
          sessionId: params.sessionId,
          runId: params.runId,
          sequence: nextSequence,
          data: {
            status: "error",
          },
        });
        return;
      }

      await eventPublisher.publish({
        type: "chat.trace",
        tenantId: params.actor.tenantId,
        sessionId: params.sessionId,
        runId: params.runId,
        sequence: nextSequence,
        data: {
          tool_name: traceToolName,
          input: pendingAction.arguments,
          output,
        },
      });
      nextSequence += 1;

      const completion = buildPendingWorkflowActionCompletion(
        pendingAction,
        output
      );
      completedSummaries.push(completion.summary);
      executedToolCalls.push({
        name: pendingAction.toolName,
        status: output.isError ? "error" : "success",
      });
      const nextPendingLlmContinuation =
        currentSession.pendingLlmContinuation && pendingAction.toolCallId
          ? {
              iteration: currentSession.pendingLlmContinuation.iteration,
              messages: [
                ...currentSession.pendingLlmContinuation.messages.map((message) => ({
                  ...message,
                })),
                {
                  role: "tool" as const,
                  content: serializeToolResultForContinuation({
                    pendingAction,
                    output,
                  }),
                  name: pendingAction.toolName,
                  tool_call_id: pendingAction.toolCallId,
                },
              ],
            }
          : currentSession.pendingLlmContinuation;

      const nextPendingAction: PendingWorkflowAction | undefined = pendingAction.followUpActions?.[0]
        ? {
            ...pendingAction.followUpActions[0],
            followUpActions:
              pendingAction.followUpActions.slice(1).length > 0
                ? pendingAction.followUpActions.slice(1)
                : undefined,
          }
        : undefined;

      if (nextPendingAction?.requiresApproval) {
        await sessionStore.update({
          ...currentSession,
          pendingWorkflowAction: nextPendingAction,
          pendingLlmContinuation: nextPendingLlmContinuation,
        });

        await eventPublisher.publish({
          type: "chat.message",
          tenantId: params.actor.tenantId,
          sessionId: params.sessionId,
          runId: params.runId,
          sequence: nextSequence,
          data: {
            role: "assistant",
            content: completedSummaries.join("\n"),
          },
        });
        nextSequence += 1;

        runResumer.register(
          params.actor.tenantId,
          params.runId,
          async ({ runId }) => {
            await executePendingAction({
              actor: params.actor,
              sessionId: params.sessionId,
              runId,
            });
          }
        );

        await approvalService.createPendingApproval({
          actor: params.actor,
          sessionId: params.sessionId,
          runId: params.runId,
          skillId: nextPendingAction.toolName,
          description:
            nextPendingAction.description ||
            `执行 ${nextPendingAction.toolName}`,
          risk: nextPendingAction.risk || "high",
          scope: nextPendingAction.scope,
        });
        return;
      }

      if (!nextPendingAction) {
        if (
          nextPendingLlmContinuation &&
          pendingAction.toolCallId
        ) {
          await sessionStore.update({
            ...currentSession,
            pendingWorkflowAction: undefined,
            pendingLlmContinuation: undefined,
          });

          const llmExecutor = await createLlmExecutor({
            actor: params.actor,
            sessionId: params.sessionId,
          });
          const handledByLlm = await llmExecutor.execute({
            actor: params.actor,
            sessionId: params.sessionId,
            runId: params.runId,
            message: currentRun.messageText,
            sessionContext: currentSession.context,
            continuation: {
              iteration: nextPendingLlmContinuation.iteration,
              messages: nextPendingLlmContinuation.messages,
            },
          });

          if (handledByLlm) {
            return;
          }
        }

        await sessionStore.update({
          ...currentSession,
          pendingWorkflowAction: undefined,
          pendingLlmContinuation: undefined,
        });
        await runStore.update({
          ...currentRun,
          status: "completed",
          finishedAt: new Date().toISOString(),
        });

        await eventPublisher.publish({
          type: "chat.message",
          tenantId: params.actor.tenantId,
          sessionId: params.sessionId,
          runId: params.runId,
          sequence: nextSequence,
          data: {
            role: "assistant",
            content: completedSummaries.join("\n"),
          },
        });
        nextSequence += 1;

        await eventPublisher.publish({
          type: "workflow.completed",
          tenantId: params.actor.tenantId,
          sessionId: params.sessionId,
          runId: params.runId,
          sequence: nextSequence,
          data: {
            workflow_id: "pending-workflow-action",
            workflow_stage: completion.workflowStage,
            next_action: completion.nextAction,
            structured_result: {
              ...completion.structuredResult,
              summary: completedSummaries.join("\n"),
              tool_calls: executedToolCalls,
            },
          },
        });
        nextSequence += 1;

        await eventPublisher.publish({
          type: "run.status",
          tenantId: params.actor.tenantId,
          sessionId: params.sessionId,
          runId: params.runId,
          sequence: nextSequence,
          data: {
            status: "done",
          },
        });
        return;
      }

      currentSession = {
        ...currentSession,
        pendingWorkflowAction: nextPendingAction,
        pendingLlmContinuation: nextPendingLlmContinuation,
      };
      pendingAction = nextPendingAction;
    }
  };

  const queuePendingActionApproval = async (params: {
    actor: RequestActor;
    sessionId: string;
    runId: string;
    pendingAction: PendingWorkflowAction;
    continuation?: PendingLlmContinuation;
    description: string;
    risk: "low" | "medium" | "high";
  }) => {
    const currentSession = await sessionService.getSession(params.sessionId, {
      tenantId: params.actor.tenantId,
      userId: params.actor.userId,
    });
    const normalizedPendingAction: PendingWorkflowAction = {
      kind: params.pendingAction.kind || "mcp_tool",
      toolName: params.pendingAction.toolName,
      toolCallId: params.pendingAction.toolCallId,
      requiresApproval: true,
      risk: params.pendingAction.risk || params.risk,
      scope:
        params.pendingAction.scope ||
        getMutableToolPolicy(params.pendingAction.toolName)?.scope,
      description: params.pendingAction.description || params.description,
      arguments: params.pendingAction.arguments,
      followUpActions: params.pendingAction.followUpActions,
    };

    await sessionStore.update({
      ...currentSession,
      pendingWorkflowAction: normalizedPendingAction,
      pendingLlmContinuation: params.continuation,
    });

    runResumer.register(
      params.actor.tenantId,
      params.runId,
      async ({ runId }) => {
        await executePendingAction({
          actor: params.actor,
          sessionId: params.sessionId,
          runId,
        });
      }
    );

    await approvalService.createPendingApproval({
      actor: params.actor,
      sessionId: params.sessionId,
      runId: params.runId,
      skillId: normalizedPendingAction.toolName,
      description:
        normalizedPendingAction.description ||
        `执行 ${normalizedPendingAction.toolName}`,
      risk: normalizedPendingAction.risk || params.risk,
      scope: normalizedPendingAction.scope,
    });
  };

  return {
    async createSession(request: CreateSessionRequest) {
      const session = await sessionService.createSession({
        actor: request.actor,
        context: request.body?.context,
      } satisfies CreateSessionInput);

      return {
        data: {
          session_id: session.sessionId,
          tenant_id: session.tenantId,
          created_at: session.createdAt,
          status: session.status,
        },
      };
    },

    async getSession(request: {
      actor: RequestActor;
      params: { sessionId: string };
    }) {
      const session = await sessionService.getSession(request.params.sessionId, {
        tenantId: request.actor.tenantId,
        userId: request.actor.userId,
      });
      const pendingApprovals = await approvalStore.listPendingBySession(
        request.params.sessionId,
        request.actor.tenantId
      );

      return {
        data: {
          session_id: session.sessionId,
          tenant_id: session.tenantId,
          status: session.status,
          latest_run_id: session.latestRunId,
          pending_workflow_action: session.pendingWorkflowAction
            ? {
                tool_name: session.pendingWorkflowAction.toolName,
                requires_approval: session.pendingWorkflowAction.requiresApproval,
                arguments: session.pendingWorkflowAction.arguments,
              }
            : null,
          pending_approvals: pendingApprovals.map((approval) => ({
            approval_id: approval.approvalId,
            description: approval.description,
            risk: approval.risk,
            scope: approval.scope,
          })),
        },
      };
    },

    async createMessageRun(request: CreateMessageRunRequest) {
      if (request.body.context && Object.keys(request.body.context).length > 0) {
        await sessionService.updateSessionContext(
          request.params.sessionId,
          {
            tenantId: request.actor.tenantId,
            userId: request.actor.userId,
            tenantName: request.actor.tenantName,
          },
          request.body.context
        );
      }

      const run = await runService.createRun({
        actor: request.actor,
        sessionId: request.params.sessionId,
        message: request.body.message,
      });

      await eventPublisher.publish({
        type: "run.status",
        tenantId: request.actor.tenantId,
        sessionId: request.params.sessionId,
        runId: run.runId,
        sequence: 1,
        data: {
          status: "thinking",
        },
      });

      const session = await sessionService.getSession(request.params.sessionId, {
        tenantId: request.actor.tenantId,
        userId: request.actor.userId,
      });

      if (
        session.pendingWorkflowAction &&
        session.pendingWorkflowAction.requiresApproval &&
        isContinueWorkflowActionPrompt(request.body.message)
      ) {
        await queuePendingActionApproval({
          actor: request.actor,
          sessionId: request.params.sessionId,
          runId: run.runId,
          pendingAction: session.pendingWorkflowAction,
          continuation: session.pendingLlmContinuation,
          description:
            session.pendingWorkflowAction.description ||
            `执行 ${session.pendingWorkflowAction.toolName}`,
          risk: session.pendingWorkflowAction.risk || "high",
        });

        return {
          data: {
            run_id: run.runId,
            session_id: run.sessionId,
            stream_url: copilotRoutes.streamRunEvents(
              request.params.sessionId,
              run.runId
            ),
          },
        };
      }

      const pendingSnapshotVersion = parseSnapshotCreateVersionInput(
        request.body.message
      );
      if (
        session.pendingWorkflowAction &&
        !session.pendingWorkflowAction.requiresApproval &&
        session.pendingWorkflowAction.toolName === "rainbond_create_app_version_snapshot" &&
        session.pendingWorkflowAction.arguments &&
        session.pendingWorkflowAction.arguments.__await_version_input === true &&
        pendingSnapshotVersion
      ) {
        const nextArguments: Record<string, unknown> = {
          ...session.pendingWorkflowAction.arguments,
          version: pendingSnapshotVersion,
        };
        delete nextArguments.__await_version_input;
        delete nextArguments.suggested_version;

        await sessionStore.update({
          ...session,
          pendingWorkflowAction: {
            ...session.pendingWorkflowAction,
            arguments: nextArguments,
          },
        });

        const handledByWorkflow = await workflowExecutor.execute({
          actor: request.actor,
          sessionId: request.params.sessionId,
          runId: run.runId,
          message: "继续执行",
        });
        if (handledByWorkflow) {
          return {
            data: {
              run_id: run.runId,
              session_id: run.sessionId,
              stream_url: copilotRoutes.streamRunEvents(
                request.params.sessionId,
                run.runId
              ),
            },
          };
        }
      }

      if (
        session.pendingWorkflowAction &&
        session.pendingWorkflowAction.arguments &&
        session.pendingWorkflowAction.arguments.__await_version_input === true &&
        pendingSnapshotVersion
      ) {
        if (session.pendingWorkflowAction.toolName === "rainbond_install_app_model") {
          const nextArguments: Record<string, unknown> = {
            ...session.pendingWorkflowAction.arguments,
            app_model_version: pendingSnapshotVersion,
          };
          delete nextArguments.__await_version_input;
          delete nextArguments.suggested_version;

          await sessionStore.update({
            ...session,
            pendingWorkflowAction: {
              ...session.pendingWorkflowAction,
              arguments: nextArguments,
            },
          });

          await queuePendingActionApproval({
            actor: request.actor,
            sessionId: request.params.sessionId,
            runId: run.runId,
            pendingAction: {
              ...session.pendingWorkflowAction,
              arguments: nextArguments,
            },
            description:
              session.pendingWorkflowAction.description ||
              `执行 ${session.pendingWorkflowAction.toolName}`,
            risk: session.pendingWorkflowAction.risk || "high",
          });

          return {
            data: {
              run_id: run.runId,
              session_id: run.sessionId,
              stream_url: copilotRoutes.streamRunEvents(
                request.params.sessionId,
                run.runId
              ),
            },
          };
        }

        if (
          session.pendingWorkflowAction.toolName ===
          "rainbond_rollback_app_version_snapshot"
        ) {
          const teamName =
            readContextString(session.context, "teamName", "team_name") ||
            request.actor.tenantName ||
            request.actor.tenantId;
          const regionName =
            readContextString(session.context, "regionName", "region_name") ||
            request.actor.regionName ||
            "";
          const appId = readContextAppId(session.context, "appId", "app_id");

          if (teamName && regionName && appId) {
            const client = await resolvePendingMcpClient({
              actor: request.actor,
              sessionId: request.params.sessionId,
            });
            const snapshotListResult = await client.callTool<Record<string, unknown>>(
              "rainbond_list_app_version_snapshots",
              {
                team_name: teamName,
                region_name: regionName,
                app_id: appId,
              }
            );
            const versionId = findSnapshotVersionId(
              (snapshotListResult.structuredContent || {}) as Record<string, unknown>,
              pendingSnapshotVersion
            );

            if (versionId > 0) {
              const nextArguments: Record<string, unknown> = {
                ...session.pendingWorkflowAction.arguments,
                version_id: versionId,
              };
              delete nextArguments.__await_version_input;
              delete nextArguments.suggested_version;

              await sessionStore.update({
                ...session,
                pendingWorkflowAction: {
                  ...session.pendingWorkflowAction,
                  arguments: nextArguments,
                },
              });

              await queuePendingActionApproval({
                actor: request.actor,
                sessionId: request.params.sessionId,
                runId: run.runId,
                pendingAction: {
                  ...session.pendingWorkflowAction,
                  description: `回滚当前应用到快照版本 ${pendingSnapshotVersion}`,
                  arguments: nextArguments,
                },
                description: `回滚当前应用到快照版本 ${pendingSnapshotVersion}`,
                risk: session.pendingWorkflowAction.risk || "high",
              });

              return {
                data: {
                  run_id: run.runId,
                  session_id: run.sessionId,
                  stream_url: copilotRoutes.streamRunEvents(
                    request.params.sessionId,
                    run.runId
                  ),
                },
              };
            }
          }
        }
      }

      const targetSnapshotVersion = parseSnapshotRollbackVersion(
        request.body.message
      );
      const rollbackToPreviousSnapshot = requestsRollbackToPreviousSnapshot(
        request.body.message
      );
      if (targetSnapshotVersion || rollbackToPreviousSnapshot) {
        const teamName =
          readContextString(session.context, "teamName", "team_name") ||
          request.actor.tenantName ||
          request.actor.tenantId;
        const regionName =
          readContextString(session.context, "regionName", "region_name") ||
          request.actor.regionName ||
          "";
        const appId = readContextAppId(session.context, "appId", "app_id");

        if (teamName && regionName && appId) {
          const client = await resolvePendingMcpClient({
            actor: request.actor,
            sessionId: request.params.sessionId,
          });
          const snapshotListResult = await client.callTool<Record<string, unknown>>(
            "rainbond_list_app_version_snapshots",
            {
              team_name: teamName,
              region_name: regionName,
              app_id: appId,
            }
          );
          const snapshotPayload = (snapshotListResult.structuredContent ||
            {}) as Record<string, unknown>;
          const versionId = targetSnapshotVersion
            ? findSnapshotVersionId(snapshotPayload, targetSnapshotVersion)
            : findPreviousSnapshotVersionId(snapshotPayload);
          const resolvedVersion = targetSnapshotVersion || findPreviousSnapshotVersion(
            snapshotPayload
          );

          if (versionId > 0) {
            await queuePendingActionApproval({
              actor: request.actor,
              sessionId: request.params.sessionId,
              runId: run.runId,
              pendingAction: {
                kind: "mcp_tool",
                toolName: "rainbond_rollback_app_version_snapshot",
                requiresApproval: true,
                risk: "high",
                scope: "app",
                description: `回滚当前应用到快照版本 ${resolvedVersion}`,
                arguments: {
                  team_name: teamName,
                  region_name: regionName,
                  app_id: appId,
                  version_id: versionId,
                },
                followUpActions: requestsCloseWholeApp(request.body.message)
                  ? [
                      {
                        kind: "mcp_tool",
                        toolName: "rainbond_operate_app",
                        requiresApproval: true,
                        risk: "high",
                        scope: "app",
                        description: "关闭当前应用",
                        arguments: {
                          team_name: teamName,
                          region_name: regionName,
                          app_id: appId,
                          action: "stop",
                        },
                      },
                    ]
                  : undefined,
              },
              description: `回滚当前应用到快照版本 ${resolvedVersion}`,
              risk: "high",
            });

            return {
              data: {
                run_id: run.runId,
                session_id: run.sessionId,
                stream_url: copilotRoutes.streamRunEvents(
                  request.params.sessionId,
                  run.runId
                ),
              },
            };
          }
        }
      }

      const handledByWorkflow = await workflowExecutor.execute({
        actor: request.actor,
        sessionId: request.params.sessionId,
        runId: run.runId,
        message: request.body.message,
      });
      if (handledByWorkflow) {
        return {
          data: {
            run_id: run.runId,
            session_id: run.sessionId,
            stream_url: copilotRoutes.streamRunEvents(
              request.params.sessionId,
              run.runId
            ),
          },
        };
      }

      const actionAdapter = deps.actionAdapterFactory
        ? await deps.actionAdapterFactory({
            actor: request.actor,
            sessionId: request.params.sessionId,
          })
        : deps.actionAdapter;
      const llmExecutor = await createLlmExecutor({
        actor: request.actor,
        sessionId: request.params.sessionId,
      });

      if (enableLegacyActionSkills) {
        const runExecutor = new ServerRunExecutor({
          broker,
          eventPublisher,
          actionAdapter,
        });
        const plan = runExecutor.plan(request.body.message);

        if (plan.requiresApproval) {
          await queuePendingActionApproval({
            actor: request.actor,
            sessionId: request.params.sessionId,
            runId: run.runId,
            pendingAction: {
              kind: "action_skill",
              toolName: plan.skillId,
              requiresApproval: true,
              risk: plan.risk,
              description: plan.description,
              arguments: plan.input,
            },
            description: plan.description,
            risk: plan.risk,
          });
        } else {
          const handledByLlm = await llmExecutor.execute({
            actor: request.actor,
            sessionId: request.params.sessionId,
            runId: run.runId,
            message: request.body.message,
            sessionContext: session.context,
          });

          if (!handledByLlm) {
            await runExecutor.executeLowRisk({
              actor: request.actor,
              sessionId: request.params.sessionId,
              runId: run.runId,
              message: request.body.message,
            });
          }
        }
      } else {
        const handledByLlm = await llmExecutor.execute({
          actor: request.actor,
          sessionId: request.params.sessionId,
          runId: run.runId,
          message: request.body.message,
          sessionContext: session.context,
        });

        if (!handledByLlm) {
          const fallbackEvents = await broker.replay(
            run.runId,
            request.actor.tenantId,
            { afterSequence: 0 }
          );
          let nextSequence = fallbackEvents.length + 1;
          await eventPublisher.publish({
            type: "chat.message",
            tenantId: request.actor.tenantId,
            sessionId: request.params.sessionId,
            runId: run.runId,
            sequence: nextSequence,
            data: {
              role: "assistant",
              content:
                "当前已禁用规则型快捷动作，且本次没有可执行的 MCP 工具调用，请补充更明确的目标对象或操作参数后重试。",
            },
          });
          nextSequence += 1;
          await eventPublisher.publish({
            type: "run.status",
            tenantId: request.actor.tenantId,
            sessionId: request.params.sessionId,
            runId: run.runId,
            sequence: nextSequence,
            data: {
              status: "done",
            },
          });
        }
      }

      return {
        data: {
          run_id: run.runId,
          session_id: run.sessionId,
          stream_url: copilotRoutes.streamRunEvents(
            request.params.sessionId,
            run.runId
          ),
        },
      };
    },

    async streamRunEvents(request: StreamRunEventsRequest) {
      const events = await broker.replay(
        request.params.runId,
        request.actor.tenantId,
        {
          afterSequence: Number(request.query?.after_sequence ?? 0),
        }
      );

      return {
        contentType: "text/event-stream",
        events: events.map((event) => event.payload),
      };
    },

    async decideApproval(request: DecideApprovalRequest) {
      const approval = await approvalService.decide(
        request.params.approvalId,
        {
          actor: request.actor,
          decision: request.body.decision,
          comment: request.body.comment,
        }
      );

      if (approval.status === "rejected") {
        const session = await sessionStore.getById(
          approval.sessionId,
          request.actor.tenantId
        );

        if (
          session &&
          session.userId === request.actor.userId &&
          session.pendingWorkflowAction?.toolName === approval.skillId
        ) {
          await sessionStore.update({
            ...session,
            pendingWorkflowAction: undefined,
            pendingLlmContinuation: undefined,
          });
        }
      }

      return {
        data: {
          approval_id: approval.approvalId,
          status: approval.status,
          resolved_at: approval.resolvedAt,
          resolved_by: {
            user_id: approval.resolvedBy,
          },
        },
      };
    },
  };
}
