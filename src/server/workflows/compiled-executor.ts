import { getRegisteredSkill } from "../skills/skill-registry.js";
import type { RequestActor } from "../../shared/types.js";
import type { McpToolResult } from "../integrations/rainbond-mcp/types.js";
import type { ExecutionScopeCandidate } from "./types.js";
import { logWorkflowDebug } from "./workflow-debug.js";
import { selectBranch, type BranchEvalContext } from "./branch-selector.js";

type SupportedStageKind =
  | "resolve_context"
  | "tool_call"
  | "summarize"
  | "branch";

const SUPPORTED_STAGE_KINDS = new Set<SupportedStageKind>([
  "resolve_context",
  "tool_call",
  "summarize",
  "branch",
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
  input?: Record<string, unknown>;
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
  return getRegisteredSkill(skillId);
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
  const input = params.input || {};
  const branchContext: BranchEvalContext = {
    input,
    context: {
      team_name:
        params.candidateScope.teamName ||
        params.actor.tenantName ||
        params.actor.tenantId,
      region_name:
        params.candidateScope.regionName || params.actor.regionName || "",
      app_id: String(parseAppId(params.candidateScope.appId)),
      component_id: params.candidateScope.componentId || "",
      enterprise_id: params.actor.enterpriseId || "",
    },
  };

  for (const stage of skill.workflow.stages) {
    if (stage.kind === "resolve_context" || stage.kind === "summarize") {
      continue;
    }

    if (stage.kind === "tool_call" && stage.tool) {
      const resolvedArgs = resolveTemplateArguments(
        stage.args || {},
        params.actor,
        params.candidateScope,
        input
      ) as Record<string, unknown>;

      sequence = await invokeStageTool({
        toolName: stage.tool,
        args: resolvedArgs,
        stageId: stage.id,
        skillId: params.skillId,
        client: params.client,
        publishToolTrace: params.publishToolTrace,
        sequence,
        toolCalls,
        toolOutputs,
      });
    }

    if (stage.kind === "branch" && stage.branches && stage.branches.length > 0) {
      const selection = selectBranch(stage.branches, branchContext);
      if (!selection) {
        logWorkflowDebug("compiled.execute.branch.skip", {
          skillId: params.skillId,
          stageId: stage.id,
          reason: "no branch matched and no default available",
        });
        continue;
      }

      const resolvedArgs = resolveTemplateArguments(
        selection.branch.args || {},
        params.actor,
        params.candidateScope,
        input
      ) as Record<string, unknown>;

      logWorkflowDebug("compiled.execute.branch.selected", {
        skillId: params.skillId,
        stageId: stage.id,
        branchId: selection.branch.id,
        matched: selection.matched,
        toolName: selection.branch.tool,
      });

      sequence = await invokeStageTool({
        toolName: selection.branch.tool,
        args: resolvedArgs,
        stageId: `${stage.id}/${selection.branch.id}`,
        skillId: params.skillId,
        client: params.client,
        publishToolTrace: params.publishToolTrace,
        sequence,
        toolCalls,
        toolOutputs,
      });
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

// Sentinel returned by resolveTemplateString for placeholders that have no
// supplied value. resolveTemplateArguments uses it to omit the corresponding
// object key entirely so we never send literals like "$input.service_id" to
// MCP tools.
const UNRESOLVED_PLACEHOLDER = Symbol("unresolved-placeholder");

function resolveTemplateArguments(
  value: unknown,
  actor: RequestActor,
  candidateScope: ExecutionScopeCandidate,
  input: Record<string, unknown>
): unknown {
  if (typeof value === "string") {
    const resolved = resolveTemplateString(value, actor, candidateScope, input);
    return resolved === UNRESOLVED_PLACEHOLDER ? undefined : resolved;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const resolved = resolveTemplateArguments(item, actor, candidateScope, input);
      if (resolved !== undefined) {
        out.push(resolved);
      }
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      const resolved = resolveTemplateArguments(entryValue, actor, candidateScope, input);
      if (resolved !== undefined) {
        out[key] = resolved;
      }
    }
    return out;
  }
  return value;
}

function resolveTemplateString(
  value: string,
  actor: RequestActor,
  candidateScope: ExecutionScopeCandidate,
  input: Record<string, unknown>
): unknown {
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
  }

  if (value.startsWith("$input.")) {
    const inputKey = value.slice("$input.".length);
    const supplied = input[inputKey];
    if (supplied === undefined || supplied === null || supplied === "") {
      return UNRESOLVED_PLACEHOLDER;
    }
    return supplied;
  }

  return value;
}

interface InvokeStageToolParams {
  toolName: string;
  args: Record<string, unknown>;
  stageId: string;
  skillId: string;
  client: WorkflowToolClient;
  publishToolTrace: ExecuteCompiledWorkflowParams["publishToolTrace"];
  sequence: number;
  toolCalls: Array<{ name: string; status: string }>;
  toolOutputs: Map<string, unknown>;
}

async function invokeStageTool(p: InvokeStageToolParams): Promise<number> {
  logWorkflowDebug("compiled.execute.tool_call.start", {
    skillId: p.skillId,
    stageId: p.stageId,
    toolName: p.toolName,
    args: p.args,
  });

  await p.publishToolTrace({
    sequence: p.sequence,
    tool_name: p.toolName,
    input: p.args,
  });
  const output = await p.client.callTool(p.toolName, p.args);
  logWorkflowDebug("compiled.execute.tool_call.result", {
    skillId: p.skillId,
    stageId: p.stageId,
    toolName: p.toolName,
    output: output.structuredContent,
  });
  await p.publishToolTrace({
    sequence: p.sequence + 1,
    tool_name: p.toolName,
    input: p.args,
    output,
  });

  p.toolCalls.push({ name: p.toolName, status: "success" });
  p.toolOutputs.set(p.toolName, output.structuredContent);
  return p.sequence + 2;
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
