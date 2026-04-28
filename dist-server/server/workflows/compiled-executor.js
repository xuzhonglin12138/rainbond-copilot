import { getRegisteredSkill } from "../skills/skill-registry.js";
import { logWorkflowDebug } from "./workflow-debug.js";
import { selectBranch } from "./branch-selector.js";
const SUPPORTED_STAGE_KINDS = new Set([
    "resolve_context",
    "tool_call",
    "summarize",
    "branch",
]);
function getCompiledSkill(skillId) {
    return getRegisteredSkill(skillId);
}
export function canExecuteCompiledSkill(skillId) {
    const skill = getCompiledSkill(skillId);
    if (!skill) {
        return false;
    }
    return skill.workflow.stages.every((stage) => SUPPORTED_STAGE_KINDS.has(stage.kind));
}
export async function executeCompiledWorkflow(params) {
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
    const toolCalls = [];
    const toolOutputs = new Map();
    let sequence = params.sequenceStart || 4;
    const input = params.input || {};
    const branchContext = {
        input,
        context: {
            team_name: params.candidateScope.teamName ||
                params.actor.tenantName ||
                params.actor.tenantId,
            region_name: params.candidateScope.regionName || params.actor.regionName || "",
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
            const resolvedArgs = resolveTemplateArguments(stage.args || {}, params.actor, params.candidateScope, input);
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
            const resolvedArgs = resolveTemplateArguments(selection.branch.args || {}, params.actor, params.candidateScope, input);
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
        const firstComponent = componentItems[0];
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
            const summaryOutput = await params.client.callTool("rainbond_get_component_summary", summaryInput);
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
    const subflowData = buildCompiledSubflowData(skill.id, toolOutputs, params.candidateScope);
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
function resolveTemplateArguments(value, actor, candidateScope, input) {
    if (typeof value === "string") {
        return resolveTemplateString(value, actor, candidateScope, input);
    }
    if (Array.isArray(value)) {
        return value.map((item) => resolveTemplateArguments(item, actor, candidateScope, input));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [
            key,
            resolveTemplateArguments(entryValue, actor, candidateScope, input),
        ]));
    }
    return value;
}
function resolveTemplateString(value, actor, candidateScope, input) {
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
        return supplied === undefined ? value : supplied;
    }
    return value;
}
async function invokeStageTool(p) {
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
function parseAppId(value) {
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
function buildCompiledSummary(skillId, toolOutputs, candidateScope) {
    if (skillId === "rainbond-delivery-verifier") {
        const appDetail = asRecord(toolOutputs.get("rainbond_get_app_detail"));
        const componentPayload = asRecord(toolOutputs.get("rainbond_query_components"));
        const componentSummary = asRecord(toolOutputs.get("rainbond_get_component_summary"));
        const componentItems = Array.isArray(componentPayload?.items)
            ? componentPayload.items
            : [];
        const appStatus = readStructuredString(appDetail, "status") ||
            readStructuredString(asRecord(appDetail?.status), "status") ||
            "unknown";
        const componentStatus = readStructuredString(asRecord(componentSummary?.status), "status") ||
            readStructuredString(componentSummary, "status") ||
            "unknown";
        const deliveryState = componentStatus === "running"
            ? "delivered-but-needs-manual-validation"
            : componentStatus === "abnormal"
                ? "blocked"
                : "partially-delivered";
        const preferredAccessUrl = extractPreferredAccessUrl(appDetail, candidateScope.teamName || paramsTeamNameFromAppDetail(appDetail), candidateScope.regionName || paramsRegionNameFromAppDetail(appDetail));
        if (preferredAccessUrl) {
            return `已完成交付验收初判：当前应用状态为 ${appStatus}，关键组件状态为 ${componentStatus}，当前结果为 ${deliveryState}。建议访问地址：${preferredAccessUrl}。`;
        }
        return `已完成交付验收初判：当前应用状态为 ${appStatus}，关键组件状态为 ${componentStatus}，当前结果为 ${deliveryState}。当前尚未从平台结果中解析到明确访问地址。`;
    }
    return `已通过编译型流程执行 ${skillId}。`;
}
function buildCompiledSubflowData(skillId, toolOutputs, candidateScope) {
    if (skillId === "rainbond-delivery-verifier") {
        const appDetail = asRecord(toolOutputs.get("rainbond_get_app_detail"));
        const componentPayload = asRecord(toolOutputs.get("rainbond_query_components"));
        const componentSummary = asRecord(toolOutputs.get("rainbond_get_component_summary"));
        const componentItems = Array.isArray(componentPayload?.items)
            ? componentPayload.items
            : [];
        const inspectedComponentStatus = readStructuredString(asRecord(componentSummary?.status), "status") ||
            readStructuredString(componentSummary, "status") ||
            "unknown";
        const runtimeState = inspectedComponentStatus === "running"
            ? "runtime_healthy"
            : inspectedComponentStatus === "abnormal"
                ? "runtime_unhealthy"
                : "topology_building";
        const deliveryState = inspectedComponentStatus === "running"
            ? "delivered-but-needs-manual-validation"
            : inspectedComponentStatus === "abnormal"
                ? "blocked"
                : "partially-delivered";
        const preferredAccessUrl = extractPreferredAccessUrl(appDetail, candidateScope.teamName || paramsTeamNameFromAppDetail(appDetail), candidateScope.regionName || paramsRegionNameFromAppDetail(appDetail));
        return {
            appStatus: readStructuredString(appDetail, "status") ||
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
function extractPreferredAccessUrl(appDetail, teamName, regionName) {
    const direct = readStructuredString(appDetail, "url", "domain_name", "access_url") ||
        readStructuredString(asRecord(appDetail?.visit_info), "url", "domain_name", "access_url");
    if (direct) {
        return direct;
    }
    const appName = readStructuredString(appDetail, "group_name", "app_name", "group_alias");
    if (appName && teamName && regionName) {
        return `https://${teamName}-${regionName}.rainbond.me/${appName}`;
    }
    return null;
}
function paramsTeamNameFromAppDetail(appDetail) {
    return readStructuredString(appDetail, "tenant_id", "team_name");
}
function paramsRegionNameFromAppDetail(appDetail) {
    return readStructuredString(appDetail, "region_name");
}
function asRecord(value) {
    return value !== null && typeof value === "object"
        ? value
        : undefined;
}
function readStructuredString(payload, ...keys) {
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
