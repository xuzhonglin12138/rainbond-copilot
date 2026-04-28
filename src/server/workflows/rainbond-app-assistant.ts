import { buildExecutionScopeCandidate } from "./context-resolver.js";
import type { ExecutionScopeCandidate } from "./types.js";
import type { RequestActor } from "../../shared/types.js";
import { selectBootstrapSubflow } from "./subflows/bootstrap.js";
import { selectTemplateInstallerSubflow } from "./subflows/template-installer.js";
import { selectVersionAssistantSubflow } from "./subflows/version-assistant.js";
import { selectDeliveryVerifierSubflow } from "./subflows/delivery-verifier.js";
import { selectTroubleshooterSubflow } from "./subflows/troubleshooter.js";

export interface AppAssistantResult {
  workflowId: "rainbond-app-assistant";
  workflowStage: "resolve-context" | "assess-state" | "select-subflow" | "report";
  nextAction:
    | "request_context"
    | "describe_capabilities"
    | "inspect_runtime"
    | "bootstrap_topology"
    | "install_template"
    | "run_version_flow"
    | "verify_delivery";
  summary: string;
  candidateScope: ExecutionScopeCandidate;
  selectedWorkflow?: string;
}

export interface ExecuteRainbondAppAssistantInput {
  message: string;
  actor: RequestActor;
  sessionContext?: Record<string, unknown>;
}

function buildUiScopeFromSessionContext(
  sessionContext: Record<string, unknown> = {}
): ExecutionScopeCandidate {
  const rawAppId = sessionContext.appId || sessionContext.app_id;
  const rawComponentId =
    sessionContext.componentId || sessionContext.component_id;

  return {
    teamName:
      typeof sessionContext.teamName === "string"
        ? sessionContext.teamName
        : typeof sessionContext.team_name === "string"
          ? sessionContext.team_name
        : undefined,
    regionName:
      typeof sessionContext.regionName === "string"
        ? sessionContext.regionName
        : typeof sessionContext.region_name === "string"
          ? sessionContext.region_name
        : undefined,
    appId: typeof rawAppId === "string" ? rawAppId : undefined,
    componentId:
      typeof rawComponentId === "string" ? rawComponentId : undefined,
  };
}

function isCapabilityPrompt(message: string): boolean {
  return /(你能做什么|可以做什么|有哪些流程|有哪些能力|有哪些工作流|workflow|skill|技能)/i.test(
    message || ""
  );
}

function isGenericIssueInspectionPrompt(message: string): boolean {
  return /((这个|当前)?(组件|应用).*(怎么了|怎么回事|什么问题|有问题|出问题|啥情况))|((what'?s|what is).*(wrong|issue))|((component|app).*(wrong|issue))/i.test(
    message || ""
  );
}

function buildCapabilitySummary(): string {
  return [
    "当前独立前端已经切到 Rainbond server workflow 主链路，优先使用以下嵌入式流程：",
    "1. rainbond-app-assistant：总控入口，负责上下文解析和子流程选择。",
    "2. rainbond-fullstack-bootstrap：部署、拉起和最小可运行拓扑流程。",
    "3. rainbond-fullstack-troubleshooter：运行态诊断和低风险修复流程。",
    "4. rainbond-delivery-verifier：交付验收、访问路径和上线确认流程。",
    "5. rainbond-template-installer：模板发现、版本选择和安装流程。",
    "6. rainbond-app-version-assistant：快照、发布、回滚和版本中心流程。",
    "另外，workspace 型流程如 rainbond-project-init、rainbond-env-sync 仍不在嵌入式主链路内。",
  ].join("\n");
}

export async function executeRainbondAppAssistant(
  input: ExecuteRainbondAppAssistantInput
): Promise<AppAssistantResult> {
  const candidateScope = buildExecutionScopeCandidate({
    explicit: {},
    uiContext: buildUiScopeFromSessionContext(input.sessionContext),
    priorScope: {
      teamName: input.actor.tenantName || input.actor.tenantId,
    },
  });

  if (isCapabilityPrompt(input.message)) {
    return {
      workflowId: "rainbond-app-assistant",
      workflowStage: "report",
      nextAction: "describe_capabilities",
      summary: buildCapabilitySummary(),
      candidateScope,
    };
  }

  const isTemplateIntent = /(模板|template|market|市场|安装到当前应用)/i.test(
    input.message
  );

  if (
    isTemplateIntent &&
    candidateScope.teamName &&
    candidateScope.regionName
  ) {
    const subflow = selectTemplateInstallerSubflow();
    return {
      workflowId: "rainbond-app-assistant",
      workflowStage: "select-subflow",
      nextAction: subflow.nextAction,
      summary: subflow.summary,
      candidateScope,
      selectedWorkflow: subflow.selectedWorkflow,
    };
  }

  if (!candidateScope.teamName || !candidateScope.appId) {
    return {
      workflowId: "rainbond-app-assistant",
      workflowStage: "resolve-context",
      nextAction: "request_context",
      summary: "当前会话还缺少完整的团队或应用上下文，暂时无法进入 Rainbond 应用主流程。",
      candidateScope,
    };
  }

  const normalizedMessage = (input.message || "").toLowerCase();

  if (isTemplateIntent) {
    const subflow = selectTemplateInstallerSubflow();
    return {
      workflowId: "rainbond-app-assistant",
      workflowStage: "select-subflow",
      nextAction: subflow.nextAction,
      summary: subflow.summary,
      candidateScope,
      selectedWorkflow: subflow.selectedWorkflow,
    };
  }

  if (/(快照|snapshot|发布|publish|回滚|rollback|版本中心|version center)/i.test(input.message)) {
    const subflow = selectVersionAssistantSubflow();
    return {
      workflowId: "rainbond-app-assistant",
      workflowStage: "select-subflow",
      nextAction: subflow.nextAction,
      summary: subflow.summary,
      candidateScope,
      selectedWorkflow: subflow.selectedWorkflow,
    };
  }

  if (/(交付|验收|验证|verify|访问地址|url)/i.test(input.message)) {
    const subflow = selectDeliveryVerifierSubflow();
    return {
      workflowId: "rainbond-app-assistant",
      workflowStage: "select-subflow",
      nextAction: subflow.nextAction,
      summary: subflow.summary,
      candidateScope,
      selectedWorkflow: subflow.selectedWorkflow,
    };
  }

  if (/(在 rainbond 上跑起来|跑起来|部署|deploy|helm|chart)/i.test(input.message)) {
    const subflow = selectBootstrapSubflow();
    return {
      workflowId: "rainbond-app-assistant",
      workflowStage: "select-subflow",
      nextAction: subflow.nextAction,
      summary: subflow.summary,
      candidateScope,
      selectedWorkflow: subflow.selectedWorkflow,
    };
  }

  if (
    /(修复|恢复服务|故障|异常|启动不起来|排查)/i.test(input.message) ||
    normalizedMessage.includes("fix") ||
    isGenericIssueInspectionPrompt(input.message)
  ) {
    const subflow = selectTroubleshooterSubflow();
    return {
      workflowId: "rainbond-app-assistant",
      workflowStage: "assess-state",
      nextAction: subflow.nextAction,
      summary: subflow.summary,
      candidateScope,
      selectedWorkflow: subflow.selectedWorkflow,
    };
  }

  return {
    workflowId: "rainbond-app-assistant",
    workflowStage: "assess-state",
    nextAction: "inspect_runtime",
    summary: `已识别团队 ${candidateScope.teamName} 和应用 ${candidateScope.appId}，下一步将进入运行态判断。`,
    candidateScope,
  };
}
