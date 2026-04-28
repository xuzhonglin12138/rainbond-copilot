import { compiledRainbondSkills } from "../../generated/rainbond/compiled-skills.js";
import type { RequestActor } from "../../shared/types.js";
import type { McpToolResult } from "../integrations/rainbond-mcp/types.js";
import type { ExecutionScopeCandidate } from "./types.js";
import { logWorkflowDebug } from "./workflow-debug.js";

type SupportedStageKind = "resolve_context" | "tool_call" | "summarize";

const SUPPORTED_STAGE_KINDS = new Set<SupportedStageKind>([
  "resolve_context",
  "tool_call",
  "summarize",
]);

interface WorkflowToolClient {
  callTool<T = unknown>(
    name: string,
    arguments_: Record<string, unknown>
  ): Promise<McpToolResult<T>>;
}

export interface ExecuteCompiledWorkflowParams {
  skillId: string;
  actor: RequestActor;
  candidateScope: ExecutionScopeCandidate;
  client: WorkflowToolClient;
  sequenceStart?: number;
  publishToolTrace: (params: {
    sequence: number;
    tool_name: string;
    input: Record<string, unknown>;
    output?: unknown;
  }) => Promise<void>;
}

export interface ExecuteCompiledWorkflowResult {
  summary: string;
  toolCalls: Array<{ name: string; status: string }>;
  lastSequence: number;
  subflowData: Record<string, unknown>;
  structuredResultPatch: Record<string, unknown>;
}

function getCompiledSkill(skillId: string) {
  return compiledRainbondSkills.find((skill) => skill.id === skillId) || null;
}

export function canExecuteCompiledSkill(skillId: string): boolean {
  const skill = getCompiledSkill(skillId);
  if (!skill) {
    return false;
  }

  return skill.workflow.stages.every(
    (stage) => SUPPORTED_STAGE_KINDS.has(stage.kind as SupportedStageKind)
  );
}

export async function executeCompiledWorkflow(
  params: ExecuteCompiledWorkflowParams
): Promise<ExecuteCompiledWorkflowResult> {
  const skill = getCompiledSkill(params.skillId);
  if (!skill) {
    throw new Error(`Unknown compiled workflow: ${params.skillId}`);
  }
  if (!canExecuteCompiledSkill(params.skillId)) {
    throw new Error(`Unsupported compiled workflow stages: ${params.skillId}`);
  }

  logWorkflowDebug("compiled.execute.begin", {
    skillId: params.skillId,
    stageIds: skill.workflow.stages.map((stage) => stage.id),
    stageKinds: skill.workflow.stages.map((stage) => stage.kind),
    candidateScope: params.candidateScope,
  });

  const toolCalls: Array<{ name: string; status: string }> = [];
  const toolOutputs = new Map<string, unknown>();
  let sequence = params.sequenceStart || 4;

  for (const stage of skill.workflow.stages) {
    if (stage.kind === "resolve_context" || stage.kind === "summarize") {
      continue;
    }

    if (stage.kind === "tool_call" && stage.tool) {
      const resolvedArgs = resolveTemplateArguments(
        stage.args || {},
        params.actor,
        params.candidateScope
      ) as Record<string, unknown>;

      logWorkflowDebug("compiled.execute.tool_call.start", {
        skillId: params.skillId,
        stageId: stage.id,
        toolName: stage.tool,
        args: resolvedArgs,
      });

      await params.publishToolTrace({
        sequence,
        tool_name: stage.tool,
        input: resolvedArgs,
      });
      const output = await params.client.callTool(stage.tool, resolvedArgs);
      logWorkflowDebug("compiled.execute.tool_call.result", {
        skillId: params.skillId,
        stageId: stage.id,
        toolName: stage.tool,
        output: output.structuredContent,
      });
      await params.publishToolTrace({
        sequence: sequence + 1,
        tool_name: stage.tool,
        input: resolvedArgs,
        output,
      });

      toolCalls.push({ name: stage.tool, status: "success" });
      toolOutputs.set(stage.tool, output.structuredContent);
      sequence += 2;
    }
  }

  if (skill.id === "rainbond-delivery-verifier") {
    const componentPayload = asRecord(toolOutputs.get("rainbond_query_components"));
    const componentItems = Array.isArray(componentPayload?.items)
      ? componentPayload.items
      : [];
    const firstComponent = componentItems[0] as Record<string, unknown> | undefined;
    const serviceId = readStructuredString(firstComponent, "service_id");

    if (serviceId) {
      const summaryInput = {
        team_name: params.candidateScope.teamName || params.actor.tenantName || params.actor.tenantId,
        region_name: params.candidateScope.regionName || params.actor.regionName || "",
        app_id: parseAppId(params.candidateScope.appId),
        service_id: serviceId,
      };

      logWorkflowDebug("compiled.execute.tool_call.start", {
        skillId: params.skillId,
        stageId: "inspect-component-summary",
        toolName: "rainbond_get_component_summary",
        args: summaryInput,
      });

      await params.publishToolTrace({
        sequence,
        tool_name: "rainbond_get_component_summary",
        input: summaryInput,
      });
      const summaryOutput = await params.client.callTool(
        "rainbond_get_component_summary",
        summaryInput
      );
      logWorkflowDebug("compiled.execute.tool_call.result", {
        skillId: params.skillId,
        stageId: "inspect-component-summary",
        toolName: "rainbond_get_component_summary",
        output: summaryOutput.structuredContent,
      });
      await params.publishToolTrace({
        sequence: sequence + 1,
        tool_name: "rainbond_get_component_summary",
        input: summaryInput,
        output: summaryOutput,
      });

      toolCalls.push({ name: "rainbond_get_component_summary", status: "success" });
      toolOutputs.set("rainbond_get_component_summary", summaryOutput.structuredContent);
      sequence += 2;
    }
  }

  const summary = buildCompiledSummary(skill.id, toolOutputs, params.candidateScope);
  const subflowData = buildCompiledSubflowData(
    skill.id,
    toolOutputs,
    params.candidateScope
  );

  logWorkflowDebug("compiled.execute.complete", {
    skillId: params.skillId,
    summary,
    toolCalls,
    subflowData,
  });

  return {
    summary,
    toolCalls,
    lastSequence: Math.max(sequence - 1, params.sequenceStart || 4),
    subflowData,
    structuredResultPatch: {
      compiled_skill: true,
      compiled_workflow: skill.id,
    },
  };
}

function resolveTemplateArguments(
  value: unknown,
  actor: RequestActor,
  candidateScope: ExecutionScopeCandidate
): unknown {
  if (typeof value === "string") {
    return resolveTemplateString(value, actor, candidateScope);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      resolveTemplateArguments(item, actor, candidateScope)
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        resolveTemplateArguments(entryValue, actor, candidateScope),
      ])
    );
  }
  return value;
}

function resolveTemplateString(
  value: string,
  actor: RequestActor,
  candidateScope: ExecutionScopeCandidate
): string | number {
  if (!value.startsWith("$")) {
    return value;
  }

  switch (value) {
    case "$context.team_name":
      return candidateScope.teamName || actor.tenantName || actor.tenantId;
    case "$context.region_name":
      return candidateScope.regionName || actor.regionName || "";
    case "$context.app_id":
      return parseAppId(candidateScope.appId);
    case "$context.component_id":
      return candidateScope.componentId || "";
    case "$actor.enterprise_id":
      return actor.enterpriseId || "";
    default:
      return value;
  }
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
  return matched && matched[1] ? Number(matched[1]) : 0;
}

function buildCompiledSummary(
  skillId: string,
  toolOutputs: Map<string, unknown>,
  candidateScope: ExecutionScopeCandidate
): string {
  if (skillId === "rainbond-delivery-verifier") {
    const appDetail = asRecord(toolOutputs.get("rainbond_get_app_detail"));
    const componentPayload = asRecord(toolOutputs.get("rainbond_query_components"));
    const componentSummary = asRecord(
      toolOutputs.get("rainbond_get_component_summary")
    );
    const componentItems = Array.isArray(componentPayload?.items)
      ? componentPayload.items
      : [];
    const appStatus =
      readStructuredString(appDetail, "status") ||
      readStructuredString(asRecord(appDetail?.status), "status") ||
      "unknown";
    const componentStatus =
      readStructuredString(asRecord(componentSummary?.status), "status") ||
      readStructuredString(componentSummary, "status") ||
      "unknown";
    const deliveryState =
      componentStatus === "running"
        ? "delivered-but-needs-manual-validation"
        : componentStatus === "abnormal"
          ? "blocked"
          : "partially-delivered";
    const preferredAccessUrl = extractPreferredAccessUrl(
      appDetail,
      candidateScope.teamName || paramsTeamNameFromAppDetail(appDetail),
      candidateScope.regionName || paramsRegionNameFromAppDetail(appDetail)
    );

    if (preferredAccessUrl) {
      return `已完成交付验收初判：当前应用状态为 ${appStatus}，关键组件状态为 ${componentStatus}，当前结果为 ${deliveryState}。建议访问地址：${preferredAccessUrl}。`;
    }

    return `已完成交付验收初判：当前应用状态为 ${appStatus}，关键组件状态为 ${componentStatus}，当前结果为 ${deliveryState}。当前尚未从平台结果中解析到明确访问地址。`;
  }

  return `已通过编译型流程执行 ${skillId}。`;
}

function buildCompiledSubflowData(
  skillId: string,
  toolOutputs: Map<string, unknown>,
  candidateScope: ExecutionScopeCandidate
): Record<string, unknown> {
  if (skillId === "rainbond-delivery-verifier") {
    const appDetail = asRecord(toolOutputs.get("rainbond_get_app_detail"));
    const componentPayload = asRecord(toolOutputs.get("rainbond_query_components"));
    const componentSummary = asRecord(
      toolOutputs.get("rainbond_get_component_summary")
    );
    const componentItems = Array.isArray(componentPayload?.items)
      ? componentPayload.items
      : [];
    const inspectedComponentStatus =
      readStructuredString(asRecord(componentSummary?.status), "status") ||
      readStructuredString(componentSummary, "status") ||
      "unknown";
    const runtimeState =
      inspectedComponentStatus === "running"
        ? "runtime_healthy"
        : inspectedComponentStatus === "abnormal"
          ? "runtime_unhealthy"
          : "topology_building";
    const deliveryState =
      inspectedComponentStatus === "running"
        ? "delivered-but-needs-manual-validation"
        : inspectedComponentStatus === "abnormal"
          ? "blocked"
          : "partially-delivered";
    const preferredAccessUrl = extractPreferredAccessUrl(
      appDetail,
      candidateScope.teamName || paramsTeamNameFromAppDetail(appDetail),
      candidateScope.regionName || paramsRegionNameFromAppDetail(appDetail)
    );

    return {
      appStatus:
        readStructuredString(appDetail, "status") ||
        readStructuredString(asRecord(appDetail?.status), "status") ||
        "unknown",
      componentCount: componentItems.length,
      inspectedComponentStatus,
      runtimeState,
      deliveryState,
      preferredAccessUrl,
    };
  }

  return {};
}

function extractPreferredAccessUrl(
  appDetail: Record<string, unknown> | undefined,
  teamName: string,
  regionName: string
): string | null {
  const direct =
    readStructuredString(appDetail, "url", "domain_name", "access_url") ||
    readStructuredString(asRecord(appDetail?.visit_info), "url", "domain_name", "access_url");
  if (direct) {
    return direct;
  }

  const appName = readStructuredString(
    appDetail,
    "group_name",
    "app_name",
    "group_alias"
  );
  if (appName && teamName && regionName) {
    return `https://${teamName}-${regionName}.rainbond.me/${appName}`;
  }

  return null;
}

function paramsTeamNameFromAppDetail(
  appDetail: Record<string, unknown> | undefined
): string {
  return readStructuredString(appDetail, "tenant_id", "team_name");
}

function paramsRegionNameFromAppDetail(
  appDetail: Record<string, unknown> | undefined
): string {
  return readStructuredString(appDetail, "region_name");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
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
