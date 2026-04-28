import type { RequestActor } from "../../shared/types.js";
import { PersistedEventPublisher } from "../events/persisted-event-publisher.js";
import { buildScopeSignature } from "./context-resolver.js";
import { buildPendingWorkflowActionCompletion } from "./pending-action-result.js";
import {
  canExecuteCompiledSkill,
  executeCompiledWorkflow,
} from "./compiled-executor.js";
import { executeRainbondAppAssistant } from "./rainbond-app-assistant.js";
import type { WorkflowRegistry } from "./registry.js";
import { createWorkflowRegistry } from "./registry.js";
import type { SessionRecord, SessionStore } from "../stores/session-store.js";
import type { RunRecord, RunStore } from "../stores/run-store.js";
import type { McpToolResult } from "../integrations/rainbond-mcp/types.js";
import {
  createRunExecutionState,
  type DeferredRunAction,
  type RunExecutionState,
} from "../runtime/run-execution-state.js";
import { logWorkflowDebug } from "./workflow-debug.js";
import type { SkillRouter } from "../skills/skill-router.js";

interface WorkflowExecutorDeps {
  eventPublisher: PersistedEventPublisher;
  sessionStore: SessionStore;
  runStore: RunStore;
  workflowRegistry?: WorkflowRegistry;
  workflowToolClientFactory?: WorkflowToolClientFactory;
  enableRainbondAppAssistantWorkflow?: boolean;
  skillRouter?: SkillRouter;
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
  return /((创建|建立|新建|生成|做一个|做个|创建一个|建立一个|新建一个).*(快照|snapshot))|((快照|snapshot).*(创建|建立|新建|生成))/i.test(
    normalized
  );
}

function shouldAutoCreateSnapshot(message: string): boolean {
  return (
    isSnapshotCreationRequested(message) &&
    !/(回滚|rollback)/i.test((message || "").trim())
  );
}

function shouldAutoPublishSnapshot(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }

  return (
    /(发布|publish|上架|分享到|同步到)/i.test(normalized) &&
    !/(发布记录|发布历史|发布事件|查看发布|publish record|publish history|publish event)/i.test(
      normalized
    )
  );
}

function shouldAutoRollbackSnapshot(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }
  return /(回滚|rollback|恢复到|退回到)/i.test(normalized);
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

function requestsRollbackToLatestSnapshot(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized || !/(回滚|rollback)/i.test(normalized)) {
    return false;
  }

  return /(最近快照|最新快照|最近版本|最新版本|latest snapshot|latest version|most recent snapshot)/i.test(
    normalized
  );
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

function prefersCloudPublishScope(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }

  return /(云市场|应用市场|cloud market|goodrain)/i.test(normalized);
}

function shouldUseCloudTemplateInstall(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }
  return /(云市场|应用市场|cloud market|market template|云模板)/i.test(normalized);
}

function extractTemplateSearchHint(message: string): string {
  const normalized = (message || "").trim();
  if (!normalized) {
    return "";
  }

  const explicitPatterns = [
    /模板\s*([A-Za-z][A-Za-z0-9._-]*)/i,
    /install\s+([A-Za-z][A-Za-z0-9._-]*)\s+(?:template|app)/i,
    /(?:template|app)\s+([A-Za-z][A-Za-z0-9._-]*)/i,
  ];
  for (const pattern of explicitPatterns) {
    const matched = normalized.match(pattern);
    if (matched && matched[1]) {
      return matched[1].toLowerCase();
    }
  }

  const stopWords = new Set([
    "rainbond",
    "cloud",
    "market",
    "template",
    "install",
    "app",
    "current",
    "into",
  ]);
  const asciiTokens = normalized.match(/[A-Za-z][A-Za-z0-9._-]*/g) || [];
  for (let index = asciiTokens.length - 1; index >= 0; index -= 1) {
    const token = asciiTokens[index]?.toLowerCase() || "";
    if (token && !stopWords.has(token)) {
      return token;
    }
  }

  return "";
}

function selectBestAppModel(
  items: Array<Record<string, unknown>>,
  hint: string
): Record<string, unknown> {
  if (!hint) {
    return items[0] || {};
  }

  const normalizedHint = hint.toLowerCase();
  const scoredItems = items.map((item) => {
    const candidates = [
      readStructuredString(item, "app_model_name", "app_name", "alias", "name"),
      readStructuredString(item, "group_name"),
    ]
      .map((value) => value.toLowerCase())
      .filter(Boolean);

    let score = 0;
    for (const candidate of candidates) {
      if (candidate === normalizedHint) {
        score = Math.max(score, 100);
      } else if (candidate.includes(normalizedHint)) {
        score = Math.max(score, 60);
      } else if (normalizedHint.includes(candidate) && candidate.length >= 3) {
        score = Math.max(score, 40);
      }
    }

    return { item, score };
  });

  scoredItems.sort((left, right) => right.score - left.score);
  if ((scoredItems[0]?.score || 0) > 0) {
    return scoredItems[0]?.item || {};
  }

  return items[0] || {};
}

function selectPreferredCloudMarket(
  items: Array<Record<string, unknown>>
): Record<string, unknown> | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const preferredByName = items.find(
    (item) => readStructuredString(item, "name") === "RainbondMarket"
  );
  if (preferredByName) {
    return preferredByName;
  }

  const preferredByAlias = items.find(
    (item) => readStructuredString(item, "alias") === "开源应用市场"
  );
  if (preferredByAlias) {
    return preferredByAlias;
  }

  const preferredByDomain = items.find(
    (item) => readStructuredString(item, "domain") === "rainbond"
  );
  if (preferredByDomain) {
    return preferredByDomain;
  }

  return items[0];
}

function extractAppModelVersions(
  model: Record<string, unknown> | undefined
): Array<Record<string, unknown>> {
  if (!model) {
    return [];
  }

  const candidates = [
    model.versions,
    model.versions_info,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object"
      );
    }
  }

  return [];
}

function selectLatestVersion(
  versions: Array<Record<string, unknown>>
): string {
  if (versions.length === 0) {
    return "";
  }

  const last = versions[versions.length - 1];
  return readStructuredString(
    last,
    "version",
    "app_version",
    "version_alias",
    "app_version_alias"
  );
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

function buildComponentIdentitySubflowData(
  component: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!component) {
    return {};
  }

  return {
    resolvedServiceId: readStructuredString(component, "service_id"),
    resolvedServiceAlias: readStructuredString(
      component,
      "service_alias",
      "service_cname"
    ),
    componentName: readStructuredString(
      component,
      "component_name",
      "service_alias",
      "service_cname",
      "service_id"
    ),
  };
}

function computeSuggestedScaleDownTargets(input: {
  currentCpu: number;
  currentMemory: number;
}): { cpu: number; memory: number } {
  const currentCpu = input.currentCpu;
  const currentMemory = input.currentMemory;

  const recommendedCpu =
    currentCpu >= 2000
      ? 250
      : currentCpu >= 1000
        ? 500
        : currentCpu >= 500
          ? 250
          : Math.max(250, currentCpu || 250);

  const recommendedMemory =
    currentMemory >= 4096
      ? 512
      : currentMemory >= 1024
        ? 512
        : currentMemory >= 512
          ? 512
          : Math.max(256, currentMemory || 256);

  return {
    cpu: recommendedCpu,
    memory: recommendedMemory,
  };
}

function selectTroubleshooterTargetComponent(
  items: Array<Record<string, unknown>>,
  preferredCandidate: string
): Record<string, unknown> | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const normalizedCandidate = (preferredCandidate || "").trim();
  if (normalizedCandidate) {
    const matched = items.find((item) =>
      [
        readStructuredString(item, "service_id"),
        readStructuredString(item, "service_alias"),
        readStructuredString(item, "service_cname"),
        readStructuredString(item, "component_name"),
      ].includes(normalizedCandidate)
    );
    if (matched) {
      return matched;
    }
  }

  const waitingOrAbnormal = items.find((item) => {
    const status = readStructuredString(item, "status", "service_status").toLowerCase();
    return status === "waiting" || status === "abnormal" || status === "unknow";
  });
  if (waitingOrAbnormal) {
    return waitingOrAbnormal;
  }

  return items[0];
}

function selectTroubleshooterPod(
  items: Array<Record<string, unknown>>
): Record<string, unknown> | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const newPodsUnhealthy = items.find((item) => {
    const group = readStructuredString(item, "group");
    const status = readStructuredString(item, "pod_status").toUpperCase();
    return group === "new_pods" && status !== "RUNNING";
  });
  if (newPodsUnhealthy) {
    return newPodsUnhealthy;
  }

  const anyUnhealthy = items.find((item) => {
    const status = readStructuredString(item, "pod_status").toUpperCase();
    return status !== "RUNNING";
  });
  if (anyUnhealthy) {
    return anyUnhealthy;
  }

  return items[0];
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

function readStructuredInt(
  payload: Record<string, unknown> | undefined,
  ...keys: string[]
): number {
  if (!payload) {
    return 0;
  }

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
      const matched = value.match(/(\d+)/);
      if (matched && matched[1]) {
        return Number(matched[1]);
      }
    }
  }

  return 0;
}

function findSnapshotVersionId(
  items: Array<Record<string, unknown>>,
  targetVersion: string
): number {
  if (!targetVersion || items.length === 0) {
    return 0;
  }

  const normalizedTarget = String(targetVersion).trim();
  const matched = items.find((item) => {
    const version = readStructuredString(
      item,
      "version",
      "share_version",
      "snapshot_version"
    );
    return version === normalizedTarget;
  });

  return readStructuredInt(matched, "version_id", "ID", "id");
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
  return /(rainbond.+跑起来|在 rainbond 上跑起来|部署|修复|恢复服务|卡在哪|排查|探针|probe|端口|port|存储|挂载|volume|autoscaler|伸缩|连接信息|helm|chart|模板|template|市场|安装到当前应用|快照|snapshot|发布|publish|回滚|rollback|版本中心|version center|交付|验收|验证|verify|访问地址|url|你能做什么|可以做什么|有哪些流程|有哪些能力|有哪些工作流|workflow|skill|技能|((这个|当前)?(组件|应用).*(怎么了|怎么回事|什么问题|有问题|出问题|啥情况))|((what'?s|what is).*(wrong|issue))|((component|app).*(wrong|issue)))/i.test(
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

export function isWorkflowContinuationReferencePrompt(message: string): boolean {
  const normalized = (message || "").trim();
  if (!normalized) {
    return false;
  }

  if (isContinueWorkflowActionPrompt(normalized)) {
    return true;
  }

  return /^(继续排查|继续诊断|继续处理|往下看|下一步|走方案\s*[abAB]|方案\s*[abAB]|按方案\s*[abAB]|选方案\s*[abAB]|走这个|按这个|按建议|就按这个|那就这个|走方案[一二12]|方案[一二12])/.test(
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

    logWorkflowDebug("workflow.route.input", {
      message: params.message,
      hasPendingWorkflowAction: !!session.pendingWorkflowAction,
      hasPendingWorkflowContinuation: !!session.pendingWorkflowContinuation,
      isContinueWorkflowActionPrompt: isContinueWorkflowActionPrompt(
        params.message
      ),
      isWorkflowContinuationReferencePrompt:
        isWorkflowContinuationReferencePrompt(params.message),
      isAppAssistantPrompt: isAppAssistantPrompt(params.message),
      sessionContext: session.context,
    });

    if (
      session.pendingWorkflowAction &&
      isContinueWorkflowActionPrompt(params.message)
    ) {
      logWorkflowDebug("workflow.route.pending_action", {
        toolName: session.pendingWorkflowAction.toolName,
        requiresApproval: session.pendingWorkflowAction.requiresApproval,
      });
      return this.executePendingWorkflowAction(params, session);
    }

    if (
      !session.pendingWorkflowAction &&
      session.pendingWorkflowContinuation &&
      isWorkflowContinuationReferencePrompt(params.message)
    ) {
      logWorkflowDebug("workflow.route.continuation", {
        selectedWorkflow: session.pendingWorkflowContinuation.selectedWorkflow,
        nextAction: session.pendingWorkflowContinuation.nextAction,
        suggestedActionCount:
          session.pendingWorkflowContinuation.suggestedActions?.length || 0,
      });
      return this.executeWorkflowContinuation(params, session, run);
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
      skillRouter: this.deps.skillRouter,
    });

    logWorkflowDebug("workflow.route.result", {
      workflowId: result.workflowId,
      workflowStage: result.workflowStage,
      nextAction: result.nextAction,
      selectedWorkflow: result.selectedWorkflow,
      candidateScope: result.candidateScope,
      summary: result.summary,
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
    if (result.skillInput && Object.keys(result.skillInput).length > 0) {
      subflowExecution.subflowData = {
        ...(subflowExecution.subflowData || {}),
        skillInput: result.skillInput,
      };
    }
    logWorkflowDebug("subflow.execution.result", {
      workflowId: result.workflowId,
      selectedWorkflow: result.selectedWorkflow,
      nextAction: result.nextAction,
      summary: subflowExecution.summary || result.summary,
      toolCalls: subflowExecution.toolCalls,
      subflowData: subflowExecution.subflowData,
      structuredResultPatch: subflowExecution.structuredResultPatch,
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
          pendingWorkflowContinuation: undefined,
        }
      );
    } else {
      await this.deps.sessionStore.update({
        ...session,
        pendingWorkflowAction: undefined,
        pendingWorkflowContinuation: {
          workflowId: result.workflowId,
          selectedWorkflow: result.selectedWorkflow,
          nextAction: result.nextAction,
          summary: subflowExecution.summary || result.summary,
          subflowData: subflowExecution.subflowData,
          toolCalls: subflowExecution.toolCalls,
        },
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

    logWorkflowDebug("subflow.route", {
      selectedWorkflow: result.selectedWorkflow,
      nextAction: result.nextAction,
      candidateScope: result.candidateScope,
      compiledEligible: canExecuteCompiledSkill(result.selectedWorkflow),
    });

    if (canExecuteCompiledSkill(result.selectedWorkflow)) {
      return executeCompiledWorkflow({
        skillId: result.selectedWorkflow,
        actor,
        candidateScope: result.candidateScope,
        client,
        sequenceStart: 4,
        input: result.skillInput,
        publishToolTrace: async (trace) => {
          await this.publishToolTrace(
            actor.tenantId,
            sessionId,
            runId,
            trace.sequence,
            {
              tool_name: trace.tool_name,
              input: trace.input,
              ...(trace.output ? { output: trace.output } : {}),
            }
          );
        },
      });
    }

    if (result.selectedWorkflow === "rainbond-template-installer") {
      const isCloudInstall = shouldUseCloudTemplateInstall(message);
      const templateSearchHint = extractTemplateSearchHint(message);
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
        const selectedMarket = selectPreferredCloudMarket(
          marketItems as Array<Record<string, unknown>>
        );
        marketName = readStructuredString(
          selectedMarket,
          "market_name",
          "name",
          "market_id"
        );

        const cloudModelInput = {
          enterprise_id: enterpriseId,
          market_name: marketName,
          page: 1,
          page_size: 20,
          ...(templateSearchHint ? { query: templateSearchHint } : {}),
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
        let resolvedCloudItems = cloudModelItems as Array<Record<string, unknown>>;
        if (templateSearchHint && resolvedCloudItems.length === 0) {
          const fallbackCloudModelInput = {
            enterprise_id: enterpriseId,
            market_name: marketName,
            page: 1,
            page_size: 20,
          };
          await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor, {
            tool_name: "rainbond_query_cloud_app_models",
            input: fallbackCloudModelInput,
          });
          const fallbackCloudModels = await client.callTool(
            "rainbond_query_cloud_app_models",
            fallbackCloudModelInput
          );
          await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor + 1, {
            tool_name: "rainbond_query_cloud_app_models",
            input: fallbackCloudModelInput,
            output: fallbackCloudModels,
          });
          sequenceCursor += 2;
          toolCalls.push({ name: "rainbond_query_cloud_app_models", status: "success" });
          resolvedCloudItems =
            fallbackCloudModels.structuredContent &&
            Array.isArray((fallbackCloudModels.structuredContent as any).items)
              ? ((fallbackCloudModels.structuredContent as any).items as Array<Record<string, unknown>>)
              : [];
        }
        const selectedCloudModel = selectBestAppModel(
          resolvedCloudItems,
          templateSearchHint
        );
        modelId = readStructuredString(selectedCloudModel, "app_model_id", "app_id");
        modelName = readStructuredString(selectedCloudModel, "app_model_name", "app_name");
        const cloudVersions = extractAppModelVersions(selectedCloudModel);
        versionCount = cloudVersions.length;
        latestVersion = selectLatestVersion(cloudVersions);

        if (modelId && latestVersion) {
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

        if (modelId) {
          return {
            summary: `已匹配到云市场模板 ${modelName || modelId}，但当前列表结果里没有可直接使用的版本信息。请换一个更精确的模板关键词重试，或在控制台中先确认该模板的可用版本。`,
            toolCalls,
            lastSequence: sequenceCursor - 1,
            subflowData: {
              marketName,
              appModelId: modelId,
              appModelName: modelName,
              versionCount,
              latestVersion,
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
        ...(templateSearchHint ? { query: templateSearchHint } : {}),
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
      const localModelItems =
        output.structuredContent &&
        Array.isArray((output.structuredContent as any).items)
          ? ((output.structuredContent as any).items as Array<Record<string, unknown>>)
          : [];
      let resolvedLocalItems = localModelItems;
      if (templateSearchHint && resolvedLocalItems.length === 0) {
        const fallbackLocalInput = {
          enterprise_id: enterpriseId,
          page: 1,
          page_size: 20,
        };
        await this.publishToolTrace(actor.tenantId, sessionId, runId, 6, {
          tool_name: "rainbond_query_local_app_models",
          input: fallbackLocalInput,
        });
        const fallbackOutput = await client.callTool(
          "rainbond_query_local_app_models",
          fallbackLocalInput
        );
        await this.publishToolTrace(actor.tenantId, sessionId, runId, 7, {
          tool_name: "rainbond_query_local_app_models",
          input: fallbackLocalInput,
          output: fallbackOutput,
        });
        resolvedLocalItems =
          fallbackOutput.structuredContent &&
          Array.isArray((fallbackOutput.structuredContent as any).items)
            ? ((fallbackOutput.structuredContent as any).items as Array<Record<string, unknown>>)
            : [];
      }
      const selectedLocalModel = selectBestAppModel(
        resolvedLocalItems,
        templateSearchHint
      );
      modelId =
        readStructuredString(selectedLocalModel, "app_model_id", "app_id");
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
      const preparePublishIntentResult = async (publishVersion: string, params?: {
        toolCallsPrefix?: Array<{ name: string; status: string }>;
        subflowDataPrefix?: Record<string, unknown>;
        sequenceStart?: number;
      }) => {
        const resolvedPublishVersion =
          publishVersion || latestSnapshotVersion || currentVersion;
        if (!resolvedPublishVersion) {
          return {
            summary: "当前还没有可用于发布的快照版本，建议先创建快照。",
            toolCalls: params?.toolCallsPrefix || baseToolCalls,
            lastSequence: params?.sequenceStart || (latestSnapshotDetail ? 9 : 7),
            subflowData: {
              ...baseSubflowData,
              ...(params?.subflowDataPrefix || {}),
            },
          };
        }

        const publishScope = prefersCloudPublishScope(message) ? "goodrain" : "local";
        const preferredAppId = readStructuredString(
          overviewData,
          "template_id",
          "app_model_id",
          "hidden_template_id"
        );
        const publishCandidateInput: Record<string, unknown> = {
          team_name: createSnapshotInput.team_name,
          region_name: createSnapshotInput.region_name,
          app_id: createSnapshotInput.app_id,
          scope: publishScope,
          preferred_version: resolvedPublishVersion,
        };
        if (preferredAppId) {
          publishCandidateInput.preferred_app_id = preferredAppId;
        }

        const publishSequence = (params?.sequenceStart || (latestSnapshotDetail ? 9 : 7)) + 1;
        await this.publishToolTrace(actor.tenantId, sessionId, runId, publishSequence, {
          tool_name: "rainbond_get_app_publish_candidates",
          input: publishCandidateInput,
        });
        const publishCandidates = await client.callTool(
          "rainbond_get_app_publish_candidates",
          publishCandidateInput
        );
        await this.publishToolTrace(actor.tenantId, sessionId, runId, publishSequence + 1, {
          tool_name: "rainbond_get_app_publish_candidates",
          input: publishCandidateInput,
          output: publishCandidates,
        });

        const candidateItems =
          publishCandidates.structuredContent &&
          Array.isArray((publishCandidates.structuredContent as any).items)
            ? ((publishCandidates.structuredContent as any).items as Array<Record<string, unknown>>)
            : [];

        if (publishScope === "goodrain") {
          return {
            summary: `已识别云市场发布意图，并定位到快照 ${resolvedPublishVersion} 的发布候选。当前仍需进一步选择云市场目标后才能继续创建发布草稿。`,
            toolCalls: [
              ...(params?.toolCallsPrefix || baseToolCalls),
              { name: "rainbond_get_app_publish_candidates", status: "success" },
            ],
            lastSequence: publishSequence + 1,
            subflowData: {
              ...baseSubflowData,
              ...(params?.subflowDataPrefix || {}),
              publishScope: "cloud",
              publishVersion: resolvedPublishVersion,
              publishCandidateCount: candidateItems.length,
            },
          };
        }

        return {
          summary: `已识别版本发布意图，并为快照 ${resolvedPublishVersion} 准备本地发布草稿。回复“继续执行”或“是的”即可发起审批并创建发布草稿。`,
          toolCalls: [
            ...(params?.toolCallsPrefix || baseToolCalls),
            { name: "rainbond_get_app_publish_candidates", status: "success" },
          ],
          lastSequence: publishSequence + 1,
          subflowData: {
            ...baseSubflowData,
            ...(params?.subflowDataPrefix || {}),
            publishScope: "local",
            publishVersion: resolvedPublishVersion,
            publishCandidateCount: candidateItems.length,
          },
          proposedToolAction: {
            toolName: "rainbond_create_app_share_record",
            requiresApproval: true,
            arguments: {
              ...createSnapshotInput,
            },
          },
        };
      };

      if (shouldAutoCreateSnapshot(message)) {
        const requestedSnapshotVersion =
          parseSnapshotVersionInput(message) ||
          suggestNextSnapshotVersion(
          latestSnapshotVersion || currentVersion
        );

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

        if (shouldAutoPublishSnapshot(message)) {
          return preparePublishIntentResult(requestedSnapshotVersion, {
            toolCallsPrefix: [
              ...baseToolCalls,
              { name: "rainbond_create_app_version_snapshot", status: "success" },
            ],
            subflowDataPrefix: {
              snapshotVersion: requestedSnapshotVersion,
            },
            sequenceStart: createSequence + 1,
          });
        }

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

      if (shouldAutoPublishSnapshot(message)) {
        return preparePublishIntentResult(
          parseSnapshotVersionInput(message) || latestSnapshotVersion || currentVersion
        );
      }

      if (shouldAutoRollbackSnapshot(message)) {
        const requestedRollbackVersion = parseSnapshotVersionInput(message);
        const latestRollbackVersion = readStructuredString(
          latestSnapshot as Record<string, unknown> | undefined,
          "version"
        );
        const latestRollbackVersionId = readStructuredInt(
          latestSnapshot as Record<string, unknown> | undefined,
          "version_id",
          "ID",
          "id"
        );
        const previousRollbackVersion = suggestRollbackSnapshotVersion(
          snapshotItems as Array<Record<string, unknown>>
        );
        const previousRollbackVersionId = snapshotItems.length > 1
          ? readStructuredInt(snapshotItems[1] as Record<string, unknown>, "version_id", "ID", "id")
          : 0;

        const resolvedRollbackVersion = requestedRollbackVersion
          ? requestedRollbackVersion
          : requestsRollbackToLatestSnapshot(message)
            ? latestRollbackVersion
            : requestsRollbackToPreviousSnapshot(message)
              ? previousRollbackVersion
              : "";
        const resolvedRollbackVersionId = requestedRollbackVersion
          ? findSnapshotVersionId(
              snapshotItems as Array<Record<string, unknown>>,
              requestedRollbackVersion
            )
          : requestsRollbackToLatestSnapshot(message)
            ? latestRollbackVersionId
            : requestsRollbackToPreviousSnapshot(message)
              ? previousRollbackVersionId
              : 0;

        if (resolvedRollbackVersion && resolvedRollbackVersionId > 0) {
          return {
            summary: `已识别回滚意图，目标快照为 ${resolvedRollbackVersion}。回复“继续执行”或“是的”即可发起审批并执行回滚。`,
            toolCalls: baseToolCalls,
            lastSequence: latestSnapshotDetail ? 9 : 7,
            subflowData: {
              ...baseSubflowData,
              rollbackVersion: resolvedRollbackVersion,
            },
            proposedToolAction: {
              toolName: "rainbond_rollback_app_version_snapshot",
              requiresApproval: true,
              arguments: {
                ...createSnapshotInput,
                version_id: resolvedRollbackVersionId,
              },
            },
          };
        }

        if (!requestedRollbackVersion) {
          const suggestedRollbackVersion = suggestRollbackSnapshotVersion(
            snapshotItems as Array<Record<string, unknown>>
          );
          return {
            summary: `已识别回滚意图，请直接回复要回滚到的快照版本号，例如 ${suggestedRollbackVersion}。`,
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

        return {
          summary: `已识别回滚意图，但当前快照列表中没有找到版本 ${requestedRollbackVersion}。请确认目标版本号后重试。`,
          toolCalls: baseToolCalls,
          lastSequence: latestSnapshotDetail ? 9 : 7,
          subflowData: {
            ...baseSubflowData,
            requestedRollbackVersion,
          },
        };
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
            logWorkflowDebug("workflow.shallow_exit", {
              selectedWorkflow: result.selectedWorkflow,
              reason: "bootstrap.no_components",
              toolCalls: [
                "rainbond_get_app_detail",
                "rainbond_query_components",
              ],
              subflowData: {
                appStatus:
                  output.structuredContent &&
                  (output.structuredContent as any).status
                    ? (output.structuredContent as any).status
                    : undefined,
                componentCount: 0,
              },
            });
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
            logWorkflowDebug("workflow.shallow_exit", {
              selectedWorkflow: result.selectedWorkflow,
              reason: "bootstrap.helm_intent_without_components",
              toolCalls: [
                "rainbond_get_app_detail",
                "rainbond_query_components",
              ],
            });
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
                  ...buildComponentIdentitySubflowData(firstComponent),
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
                  ...buildComponentIdentitySubflowData(firstComponent),
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
              logWorkflowDebug("workflow.shallow_exit", {
                selectedWorkflow: result.selectedWorkflow,
                reason: "troubleshooter.explicit_inspection_intent",
                inspectionIntent,
              });
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
                  ...buildComponentIdentitySubflowData(firstComponent),
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
              ...buildComponentIdentitySubflowData(firstComponent),
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

        logWorkflowDebug("workflow.shallow_exit", {
          selectedWorkflow: result.selectedWorkflow,
          reason: "component_list_without_target_component",
          toolCalls: [
            "rainbond_get_app_detail",
            "rainbond_query_components",
          ],
        });

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

      logWorkflowDebug("workflow.shallow_exit", {
        selectedWorkflow: result.selectedWorkflow,
        reason: "app_detail_only",
        toolCalls: ["rainbond_get_app_detail"],
      });

      return {
        summary: summaryMap[result.selectedWorkflow],
        toolCalls: [{ name: "rainbond_get_app_detail", status: "success" }],
        lastSequence: 5,
      };
    }

    return { toolCalls: [] };
  }

  private async executeWorkflowContinuation(
    params: ExecuteWorkflowParams,
    session: SessionRecord,
    run: RunRecord
  ): Promise<boolean> {
    const continuation = session.pendingWorkflowContinuation;
    if (!continuation || !this.deps.workflowToolClientFactory) {
      return false;
    }

    switch (continuation.selectedWorkflow) {
      case "rainbond-fullstack-troubleshooter":
        break;
      case "rainbond-delivery-verifier":
        return this.executeDeliveryVerifierContinuation(
          params,
          session,
          run,
          continuation
        );
      case "rainbond-app-version-assistant":
        return this.executeAppVersionContinuation(
          params,
          session,
          run,
          continuation
        );
      default:
        return false;
    }

    const teamName =
      (typeof session.context?.team_name === "string" && session.context.team_name) ||
      (typeof session.context?.teamName === "string" && session.context.teamName) ||
      params.actor.tenantName ||
      params.actor.tenantId;
    const regionName =
      (typeof session.context?.region_name === "string" && session.context.region_name) ||
      (typeof session.context?.regionName === "string" && session.context.regionName) ||
      params.actor.regionName ||
      "";
    const appId = parseAppId(
      (typeof session.context?.app_id === "string" && session.context.app_id) ||
        (typeof session.context?.appId === "string" && session.context.appId) ||
        ""
    );
    const enterpriseId =
      (typeof session.context?.enterprise_id === "string" &&
        session.context.enterprise_id) ||
      (typeof session.context?.enterpriseId === "string" &&
        session.context.enterpriseId) ||
      params.actor.enterpriseId ||
      "";

    if (!teamName || !regionName || !appId || !enterpriseId) {
      return false;
    }

    const client = await this.deps.workflowToolClientFactory({
      actor: params.actor,
      sessionId: params.sessionId,
    });

    await this.deps.eventPublisher.publish({
      type: "workflow.selected",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 2,
      data: {
        workflow_id: continuation.selectedWorkflow,
        workflow_name: continuation.selectedWorkflow,
      },
    });
    await this.deps.eventPublisher.publish({
      type: "workflow.stage",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 3,
      data: {
        workflow_id: continuation.selectedWorkflow,
        workflow_stage: "inspect-runtime",
        next_action: "continue_runtime_diagnosis",
      },
    });

    const appInput = {
      team_name: teamName,
      region_name: regionName,
      app_id: appId,
    };
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 4, {
      tool_name: "rainbond_get_app_detail",
      input: appInput,
    });
    const appOutput = await client.callTool("rainbond_get_app_detail", appInput);
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 5, {
      tool_name: "rainbond_get_app_detail",
      input: appInput,
      output: appOutput,
    });

    const componentInput = {
      enterprise_id: enterpriseId,
      app_id: appId,
      page: 1,
      page_size: 20,
    };
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 6, {
      tool_name: "rainbond_query_components",
      input: componentInput,
    });
    const componentOutput = await client.callTool(
      "rainbond_query_components",
      componentInput
    );
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 7, {
      tool_name: "rainbond_query_components",
      input: componentInput,
      output: componentOutput,
    });

    const componentItems =
      componentOutput.structuredContent &&
      Array.isArray((componentOutput.structuredContent as any).items)
        ? ((componentOutput.structuredContent as any).items as Array<Record<string, unknown>>)
        : [];
    const preferredCandidate =
      readStructuredString(
        (continuation.subflowData || {}) as Record<string, unknown>,
        "resolvedServiceId",
        "resolvedServiceAlias",
        "componentName"
      ) ||
      (typeof session.context?.component_id === "string" && session.context.component_id) ||
      (typeof session.context?.componentId === "string" && session.context.componentId) ||
      "";
    const targetComponent = selectTroubleshooterTargetComponent(
      componentItems,
      preferredCandidate
    );

    if (!targetComponent) {
      return false;
    }

    const canonicalServiceId = readStructuredString(targetComponent, "service_id");
    const componentAlias = readStructuredString(
      targetComponent,
      "service_alias",
      "service_cname",
      "component_name"
    );
    const podsInput = {
      team_name: teamName,
      region_name: regionName,
      app_id: appId,
      service_id: canonicalServiceId,
    };
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 8, {
      tool_name: "rainbond_get_component_pods",
      input: podsInput,
    });
    const podsOutput = await client.callTool(
      "rainbond_get_component_pods",
      podsInput
    );
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 9, {
      tool_name: "rainbond_get_component_pods",
      input: podsInput,
      output: podsOutput,
    });

    const eventsInput = {
      team_name: teamName,
      region_name: regionName,
      app_id: appId,
      service_id: canonicalServiceId,
      page: 1,
      page_size: 20,
    };
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 10, {
      tool_name: "rainbond_get_component_events",
      input: eventsInput,
    });
    const eventsOutput = await client.callTool(
      "rainbond_get_component_events",
      eventsInput
    );
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 11, {
      tool_name: "rainbond_get_component_events",
      input: eventsInput,
      output: eventsOutput,
    });

    const detailInput = {
      team_name: teamName,
      region_name: regionName,
      app_id: appId,
      service_id: canonicalServiceId,
    };
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 12, {
      tool_name: "rainbond_get_component_detail",
      input: detailInput,
    });
    const detailOutput = await client.callTool(
      "rainbond_get_component_detail",
      detailInput
    );
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 13, {
      tool_name: "rainbond_get_component_detail",
      input: detailInput,
      output: detailOutput,
    });
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 14, {
      tool_name: "rainbond_get_component_summary",
      input: detailInput,
    });
    const refreshedSummaryOutput = await client.callTool(
      "rainbond_get_component_summary",
      detailInput
    );
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 15, {
      tool_name: "rainbond_get_component_summary",
      input: detailInput,
      output: refreshedSummaryOutput,
    });

    const podItems =
      podsOutput.structuredContent &&
      Array.isArray((podsOutput.structuredContent as any).items)
        ? ((podsOutput.structuredContent as any).items as Array<Record<string, unknown>>)
        : [];
    const targetPod = selectTroubleshooterPod(podItems);
    let podDetailOutput: McpToolResult<Record<string, unknown>> | undefined;
    if (targetPod) {
      const podDetailInput = {
        team_name: teamName,
        region_name: regionName,
        app_id: appId,
        service_id: canonicalServiceId,
        pod_name: readStructuredString(targetPod, "pod_name"),
      };
      if (podDetailInput.pod_name) {
        await this.publishToolTrace(
          params.actor.tenantId,
          params.sessionId,
          params.runId,
          16,
          {
            tool_name: "rainbond_get_pod_detail",
            input: podDetailInput,
          }
        );
        podDetailOutput = await client.callTool(
          "rainbond_get_pod_detail",
          podDetailInput
        );
        await this.publishToolTrace(
          params.actor.tenantId,
          params.sessionId,
          params.runId,
          17,
          {
            tool_name: "rainbond_get_pod_detail",
            input: podDetailInput,
            output: podDetailOutput,
          }
        );
      }
    }

    const appStatus =
      appOutput.structuredContent && (appOutput.structuredContent as any).status
        ? (appOutput.structuredContent as any).status
        : undefined;
    const podStatus = targetPod
      ? readStructuredString(targetPod, "pod_status")
      : "";
    const eventItems =
      eventsOutput.structuredContent &&
      Array.isArray((eventsOutput.structuredContent as any).items)
        ? ((eventsOutput.structuredContent as any).items as Array<Record<string, unknown>>)
        : [];
    const warningEvent = eventItems.find((item) => {
      const joined = JSON.stringify(item).toLowerCase();
      return (
        joined.includes("warning") ||
        joined.includes("failed") ||
        joined.includes("unschedulable") ||
        joined.includes("backoff")
      );
    });
    const podReason = podDetailOutput
      ? readStructuredString(
          (podDetailOutput.structuredContent || {}) as Record<string, unknown>,
          "status.reason"
        )
      : "";
    const warningHint = warningEvent
      ? readStructuredString(
          warningEvent,
          "message",
          "reason",
          "event"
        ) || JSON.stringify(warningEvent)
      : "";
    const refreshedSummaryPayload =
      (refreshedSummaryOutput?.structuredContent || {}) as Record<string, unknown>;
    const refreshedSummaryService =
      (refreshedSummaryPayload.service || {}) as Record<string, unknown>;
    const refreshedSummaryResource =
      (refreshedSummaryPayload.resource || {}) as Record<string, unknown>;
    const currentCpu =
      readStructuredInt(
        refreshedSummaryService,
        "min_cpu",
        "container_cpu"
      ) || readStructuredInt(refreshedSummaryResource, "cpu");
    const currentMemory =
      readStructuredInt(
        refreshedSummaryService,
        "min_memory",
        "container_memory"
      ) || readStructuredInt(refreshedSummaryResource, "memory");
    const shouldSuggestScaleDown =
      /cpu资源不足|unschedulable|failedscheduling/i.test(warningHint) ||
      /unschedulable|insufficient cpu/i.test(podReason);
    const suggestedScaleTargets = shouldSuggestScaleDown
      ? computeSuggestedScaleDownTargets({
          currentCpu,
          currentMemory,
        })
      : null;

    const summary = `继续沿着 rainbond-fullstack-troubleshooter → inspect-runtime 阶段推进。组件 ${componentAlias || canonicalServiceId} 的 canonical service_id 已确认是 ${canonicalServiceId}。我重新拉取了 Pod、Events 和组件详情${targetPod ? `，当前重点 Pod 为 ${readStructuredString(targetPod, "pod_name")}（${podStatus || "unknown"}）` : ""}${warningHint ? `，事件里最明显的异常是：${warningHint}` : ""}${podReason ? `，Pod 诊断原因为：${podReason}` : ""}。`;

    await this.deps.sessionStore.update({
      ...session,
      pendingWorkflowAction: undefined,
      pendingWorkflowContinuation: {
        workflowId: continuation.workflowId,
        selectedWorkflow: continuation.selectedWorkflow,
        nextAction: "continue_runtime_diagnosis",
        summary,
        subflowData: {
          appStatus,
          componentCount: componentItems.length,
          inspectedComponentStatus: readStructuredString(
            targetComponent,
            "status",
            "service_status"
          ),
          ...buildComponentIdentitySubflowData(targetComponent),
          podCount: podItems.length,
          selectedPodName: targetPod
            ? readStructuredString(targetPod, "pod_name")
            : "",
          selectedPodStatus: podStatus,
          currentCpu,
          currentMemory,
        },
        toolCalls: [
          { name: "rainbond_get_app_detail", status: "success" },
          { name: "rainbond_query_components", status: "success" },
          { name: "rainbond_get_component_summary", status: "success" },
          { name: "rainbond_get_component_pods", status: "success" },
          { name: "rainbond_get_component_events", status: "success" },
          { name: "rainbond_get_component_detail", status: "success" },
          ...(podDetailOutput
            ? [{ name: "rainbond_get_pod_detail", status: "success" as const }]
            : []),
        ],
        suggestedActions: suggestedScaleTargets
          ? [
              {
                optionKey: "A",
                label: "调回合理资源",
                description: `将组件 ${canonicalServiceId} 调整到 ${suggestedScaleTargets.cpu}m CPU / ${suggestedScaleTargets.memory}MB 内存`,
                recommended: true,
                pendingAction: {
                  kind: "action_skill",
                  toolName: "scale-component-memory",
                  requiresApproval: true,
                  risk: "medium",
                  description: `调整组件 ${canonicalServiceId} 的资源配置`,
                  arguments: {
                    name: canonicalServiceId,
                    cpu: suggestedScaleTargets.cpu,
                    memory: suggestedScaleTargets.memory,
                  },
                },
              },
            ]
          : undefined,
      },
    });

    await this.deps.eventPublisher.publish({
      type: "chat.message",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 18,
      data: {
        role: "assistant",
        content: suggestedScaleTargets
          ? `${summary} 建议优先走方案A：将组件资源调整到 ${suggestedScaleTargets.cpu}m CPU / ${suggestedScaleTargets.memory}MB 内存。若确认执行，直接回复“可以”或“走方案A”。`
          : summary,
      },
    });
    await this.deps.eventPublisher.publish({
      type: "workflow.completed",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 19,
      data: {
        workflow_id: continuation.workflowId,
        workflow_stage: "inspect-runtime",
        next_action: "continue_runtime_diagnosis",
        structured_result: {
          summary: suggestedScaleTargets
            ? `${summary} 建议优先走方案A：将组件资源调整到 ${suggestedScaleTargets.cpu}m CPU / ${suggestedScaleTargets.memory}MB 内存。若确认执行，直接回复“可以”或“走方案A”。`
            : summary,
          selectedWorkflow: continuation.selectedWorkflow,
          subflowData: {
            appStatus,
            componentCount: componentItems.length,
            inspectedComponentStatus: readStructuredString(
              targetComponent,
              "status",
              "service_status"
            ),
            ...buildComponentIdentitySubflowData(targetComponent),
            podCount: podItems.length,
            selectedPodName: targetPod
              ? readStructuredString(targetPod, "pod_name")
              : "",
            selectedPodStatus: podStatus,
            currentCpu,
            currentMemory,
          },
          tool_calls: [
            { name: "rainbond_get_app_detail", status: "success" },
            { name: "rainbond_query_components", status: "success" },
            { name: "rainbond_get_component_summary", status: "success" },
            { name: "rainbond_get_component_pods", status: "success" },
            { name: "rainbond_get_component_events", status: "success" },
            { name: "rainbond_get_component_detail", status: "success" },
            ...(podDetailOutput
              ? [{ name: "rainbond_get_pod_detail", status: "success" as const }]
            : []),
          ],
          suggestedActions: suggestedScaleTargets
            ? [
                {
                  optionKey: "A",
                  label: "调回合理资源",
                  description: `将组件 ${canonicalServiceId} 调整到 ${suggestedScaleTargets.cpu}m CPU / ${suggestedScaleTargets.memory}MB 内存`,
                  recommended: true,
                  pendingAction: {
                    kind: "action_skill",
                    toolName: "scale-component-memory",
                    requiresApproval: true,
                    risk: "medium",
                    description: `调整组件 ${canonicalServiceId} 的资源配置`,
                    arguments: {
                      name: canonicalServiceId,
                      cpu: suggestedScaleTargets.cpu,
                      memory: suggestedScaleTargets.memory,
                    },
                  },
                },
              ]
            : undefined,
        },
      },
    });
    await this.deps.eventPublisher.publish({
      type: "run.status",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 20,
      data: {
        status: "done",
      },
    });

    if (run.executionState) {
      await this.deps.runStore.update({
        ...run,
        executionState: {
          ...cloneRunExecutionState(run.executionState),
          status: "completed",
          finalOutput: summary,
        },
      });
    }

    return true;
  }

  private async executeDeliveryVerifierContinuation(
    params: ExecuteWorkflowParams,
    session: SessionRecord,
    run: RunRecord,
    continuation: NonNullable<SessionRecord["pendingWorkflowContinuation"]>
  ): Promise<boolean> {
    if (!this.deps.workflowToolClientFactory) {
      return false;
    }

    const teamName =
      (typeof session.context?.team_name === "string" && session.context.team_name) ||
      (typeof session.context?.teamName === "string" && session.context.teamName) ||
      params.actor.tenantName ||
      params.actor.tenantId;
    const regionName =
      (typeof session.context?.region_name === "string" && session.context.region_name) ||
      (typeof session.context?.regionName === "string" && session.context.regionName) ||
      params.actor.regionName ||
      "";
    const appId = parseAppId(
      (typeof session.context?.app_id === "string" && session.context.app_id) ||
        (typeof session.context?.appId === "string" && session.context.appId) ||
        ""
    );
    const enterpriseId =
      (typeof session.context?.enterprise_id === "string" &&
        session.context.enterprise_id) ||
      (typeof session.context?.enterpriseId === "string" &&
        session.context.enterpriseId) ||
      params.actor.enterpriseId ||
      "";

    if (!teamName || !regionName || !appId || !enterpriseId) {
      return false;
    }

    const client = await this.deps.workflowToolClientFactory({
      actor: params.actor,
      sessionId: params.sessionId,
    });

    await this.deps.eventPublisher.publish({
      type: "workflow.selected",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 2,
      data: {
        workflow_id: continuation.selectedWorkflow,
        workflow_name: continuation.selectedWorkflow,
      },
    });
    await this.deps.eventPublisher.publish({
      type: "workflow.stage",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 3,
      data: {
        workflow_id: continuation.selectedWorkflow,
        workflow_stage: "continue_delivery_verification",
        next_action: "inspect_delivery_details",
      },
    });

    const appInput = {
      team_name: teamName,
      region_name: regionName,
      app_id: appId,
    };
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 4, {
      tool_name: "rainbond_get_app_detail",
      input: appInput,
    });
    const appOutput = await client.callTool("rainbond_get_app_detail", appInput);
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 5, {
      tool_name: "rainbond_get_app_detail",
      input: appInput,
      output: appOutput,
    });

    const componentInput = {
      enterprise_id: enterpriseId,
      app_id: appId,
      page: 1,
      page_size: 20,
    };
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 6, {
      tool_name: "rainbond_query_components",
      input: componentInput,
    });
    const componentOutput = await client.callTool(
      "rainbond_query_components",
      componentInput
    );
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 7, {
      tool_name: "rainbond_query_components",
      input: componentInput,
      output: componentOutput,
    });

    const componentItems =
      componentOutput.structuredContent &&
      Array.isArray((componentOutput.structuredContent as any).items)
        ? ((componentOutput.structuredContent as any).items as Array<Record<string, unknown>>)
        : [];
    const preferredCandidate =
      readStructuredString(
        (continuation.subflowData || {}) as Record<string, unknown>,
        "resolvedServiceId",
        "resolvedServiceAlias",
        "componentName"
      ) ||
      readStructuredString(componentItems[0], "service_id");
    const targetComponent = selectTroubleshooterTargetComponent(
      componentItems,
      preferredCandidate
    );
    if (!targetComponent) {
      return false;
    }

    const canonicalServiceId = readStructuredString(targetComponent, "service_id");
    const detailInput = {
      team_name: teamName,
      region_name: regionName,
      app_id: appId,
      service_id: canonicalServiceId,
    };
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 8, {
      tool_name: "rainbond_get_component_detail",
      input: detailInput,
    });
    const detailOutput = await client.callTool(
      "rainbond_get_component_detail",
      detailInput
    );
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 9, {
      tool_name: "rainbond_get_component_detail",
      input: detailInput,
      output: detailOutput,
    });

    const logsInput = {
      team_name: teamName,
      region_name: regionName,
      app_id: appId,
      service_id: canonicalServiceId,
      action: "service",
      lines: 50,
    };
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 10, {
      tool_name: "rainbond_get_component_logs",
      input: logsInput,
    });
    const logsOutput = await client.callTool(
      "rainbond_get_component_logs",
      logsInput
    );
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 11, {
      tool_name: "rainbond_get_component_logs",
      input: logsInput,
      output: logsOutput,
    });

    const logItems =
      logsOutput.structuredContent &&
      Array.isArray((logsOutput.structuredContent as any).items)
        ? ((logsOutput.structuredContent as any).items as Array<unknown>)
        : [];

    const summary = `继续沿着 rainbond-delivery-verifier 推进交付校验。组件 ${readStructuredString(targetComponent, "service_alias", "service_cname", "component_name", "service_id")} 的 canonical service_id 已确认是 ${canonicalServiceId}，我补充拉取了组件详情和最近日志，用于继续确认运行态与访问路径。`;

    await this.deps.sessionStore.update({
      ...session,
      pendingWorkflowAction: undefined,
      pendingWorkflowContinuation: {
        workflowId: continuation.workflowId,
        selectedWorkflow: continuation.selectedWorkflow,
        nextAction: "inspect_delivery_details",
        summary,
        subflowData: {
          ...(continuation.subflowData || {}),
          ...buildComponentIdentitySubflowData(targetComponent),
          logLineCount: logItems.length,
        },
        toolCalls: [
          { name: "rainbond_get_app_detail", status: "success" },
          { name: "rainbond_query_components", status: "success" },
          { name: "rainbond_get_component_detail", status: "success" },
          { name: "rainbond_get_component_logs", status: "success" },
        ],
      },
    });

    await this.deps.eventPublisher.publish({
      type: "chat.message",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 12,
      data: {
        role: "assistant",
        content: summary,
      },
    });
    await this.deps.eventPublisher.publish({
      type: "workflow.completed",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 13,
      data: {
        workflow_id: continuation.workflowId,
        workflow_stage: "continue_delivery_verification",
        next_action: "inspect_delivery_details",
        structured_result: {
          summary,
          selectedWorkflow: continuation.selectedWorkflow,
          subflowData: {
            ...(continuation.subflowData || {}),
            ...buildComponentIdentitySubflowData(targetComponent),
            logLineCount: logItems.length,
          },
          tool_calls: [
            { name: "rainbond_get_app_detail", status: "success" },
            { name: "rainbond_query_components", status: "success" },
            { name: "rainbond_get_component_detail", status: "success" },
            { name: "rainbond_get_component_logs", status: "success" },
          ],
        },
      },
    });
    await this.deps.eventPublisher.publish({
      type: "run.status",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 14,
      data: {
        status: "done",
      },
    });

    if (run.executionState) {
      await this.deps.runStore.update({
        ...run,
        executionState: {
          ...cloneRunExecutionState(run.executionState),
          status: "completed",
          finalOutput: summary,
        },
      });
    }

    return true;
  }

  private async executeAppVersionContinuation(
    params: ExecuteWorkflowParams,
    session: SessionRecord,
    run: RunRecord,
    continuation: NonNullable<SessionRecord["pendingWorkflowContinuation"]>
  ): Promise<boolean> {
    if (!this.deps.workflowToolClientFactory) {
      return false;
    }

    const teamName =
      (typeof session.context?.team_name === "string" && session.context.team_name) ||
      (typeof session.context?.teamName === "string" && session.context.teamName) ||
      params.actor.tenantName ||
      params.actor.tenantId;
    const regionName =
      (typeof session.context?.region_name === "string" && session.context.region_name) ||
      (typeof session.context?.regionName === "string" && session.context.regionName) ||
      params.actor.regionName ||
      "";
    const appId = parseAppId(
      (typeof session.context?.app_id === "string" && session.context.app_id) ||
        (typeof session.context?.appId === "string" && session.context.appId) ||
        ""
    );

    if (!teamName || !regionName || !appId) {
      return false;
    }

    const currentVersion = readStructuredString(
      (continuation.subflowData || {}) as Record<string, unknown>,
      "currentVersion"
    );
    const latestSnapshotVersion = readStructuredString(
      (continuation.subflowData || {}) as Record<string, unknown>,
      "latestSnapshotVersion"
    );
    const nextSnapshotVersion = suggestNextSnapshotVersion(
      latestSnapshotVersion || currentVersion
    );

    const client = await this.deps.workflowToolClientFactory({
      actor: params.actor,
      sessionId: params.sessionId,
    });

    await this.deps.eventPublisher.publish({
      type: "workflow.selected",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 2,
      data: {
        workflow_id: continuation.selectedWorkflow,
        workflow_name: continuation.selectedWorkflow,
      },
    });
    await this.deps.eventPublisher.publish({
      type: "workflow.stage",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 3,
      data: {
        workflow_id: continuation.selectedWorkflow,
        workflow_stage: "continue_version_flow",
        next_action: "create_snapshot",
      },
    });

    const snapshotInput = {
      team_name: teamName,
      region_name: regionName,
      app_id: appId,
      version: nextSnapshotVersion,
    };
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 4, {
      tool_name: "rainbond_create_app_version_snapshot",
      input: snapshotInput,
    });
    await client.callTool("rainbond_create_app_version_snapshot", snapshotInput);
    await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 5, {
      tool_name: "rainbond_create_app_version_snapshot",
      input: snapshotInput,
      output: {
        structuredContent: {
          snapshot: {
            version: nextSnapshotVersion,
          },
        },
      },
    });

    const summary = `已创建应用快照 ${nextSnapshotVersion}，可以继续执行发布或回滚。`;
    await this.deps.sessionStore.update({
      ...session,
      pendingWorkflowAction: undefined,
      pendingWorkflowContinuation: {
        workflowId: continuation.workflowId,
        selectedWorkflow: continuation.selectedWorkflow,
        nextAction: "create_snapshot",
        summary,
        subflowData: {
          ...(continuation.subflowData || {}),
          snapshotVersion: nextSnapshotVersion,
        },
        toolCalls: [
          { name: "rainbond_create_app_version_snapshot", status: "success" },
        ],
      },
    });

    await this.deps.eventPublisher.publish({
      type: "chat.message",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 6,
      data: {
        role: "assistant",
        content: summary,
      },
    });
    await this.deps.eventPublisher.publish({
      type: "workflow.completed",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 7,
      data: {
        workflow_id: continuation.workflowId,
        workflow_stage: "continue_version_flow",
        next_action: "create_snapshot",
        structured_result: {
          summary,
          selectedWorkflow: continuation.selectedWorkflow,
          executedAction: {
            toolName: "rainbond_create_app_version_snapshot",
          },
          subflowData: {
            ...(continuation.subflowData || {}),
            snapshotVersion: nextSnapshotVersion,
          },
          tool_calls: [
            { name: "rainbond_create_app_version_snapshot", status: "success" },
          ],
        },
      },
    });
    await this.deps.eventPublisher.publish({
      type: "run.status",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: 8,
      data: {
        status: "done",
      },
    });

    if (run.executionState) {
      await this.deps.runStore.update({
        ...run,
        executionState: {
          ...cloneRunExecutionState(run.executionState),
          status: "completed",
          finalOutput: summary,
        },
      });
    }

    return true;
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
