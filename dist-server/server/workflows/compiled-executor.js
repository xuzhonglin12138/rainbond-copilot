import { getRegisteredSkill } from "../skills/skill-registry.js";
import { logWorkflowDebug } from "./workflow-debug.js";
import { evalWhenExpression, selectBranch, } from "./branch-selector.js";
import { readWorkflowValueRef } from "./workflow-value-ref.js";
import { createServerId } from "../utils/id.js";
const SUPPORTED_STAGE_KINDS = new Set([
    "resolve_context",
    "tool_call",
    "summarize",
    "branch",
    "loop",
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
    const input = enrichInputWithContextFallbacks(params.input || {}, params.candidateScope);
    const contextPayload = {
        team_name: params.candidateScope.teamName ||
            params.actor.tenantName ||
            params.actor.tenantId,
        region_name: params.candidateScope.regionName || params.actor.regionName || "",
        app_id: String(parseAppId(params.candidateScope.appId)),
        component_id: params.candidateScope.componentId || "",
        enterprise_id: params.actor.enterpriseId || "",
    };
    for (const stage of skill.workflow.stages) {
        if (stage.kind === "resolve_context" || stage.kind === "summarize") {
            continue;
        }
        if (stage.kind === "tool_call" && stage.tool) {
            const resolvedArgs = resolveTemplateArguments(stage.args || {}, params.actor, params.candidateScope, input, toolOutputs);
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
            const branchContext = buildBranchContext(input, contextPayload, toolOutputs);
            const selection = selectBranch(stage.branches, branchContext);
            if (!selection) {
                logWorkflowDebug("compiled.execute.branch.skip", {
                    skillId: params.skillId,
                    stageId: stage.id,
                    reason: "no branch matched and no default available",
                });
                continue;
            }
            const resolvedArgs = resolveTemplateArguments(selection.branch.args || {}, params.actor, params.candidateScope, input, toolOutputs);
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
        if (stage.kind === "loop" && stage.branches && stage.branches.length > 0) {
            const maxIterations = stage.max_iterations || stage.branches.length;
            let iterations = 0;
            while (iterations < maxIterations) {
                const branchContext = buildBranchContext(input, contextPayload, toolOutputs);
                if (stage.while && !evaluateLoopCondition(stage.while, branchContext)) {
                    logWorkflowDebug("compiled.execute.loop.stop", {
                        skillId: params.skillId,
                        stageId: stage.id,
                        reason: "while_false",
                        iterations,
                    });
                    break;
                }
                const selection = selectBranch(stage.branches, branchContext);
                if (!selection) {
                    logWorkflowDebug("compiled.execute.loop.stop", {
                        skillId: params.skillId,
                        stageId: stage.id,
                        reason: "no_branch_match",
                        iterations,
                    });
                    break;
                }
                const resolvedArgs = resolveTemplateArguments(selection.branch.args || {}, params.actor, params.candidateScope, input, toolOutputs);
                logWorkflowDebug("compiled.execute.loop.selected", {
                    skillId: params.skillId,
                    stageId: stage.id,
                    branchId: selection.branch.id,
                    matched: selection.matched,
                    toolName: selection.branch.tool,
                    iteration: iterations + 1,
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
                iterations += 1;
            }
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
    let summary = buildCompiledSummary(skill.id, toolOutputs, params.candidateScope);
    let streamedSummary = false;
    const subflowData = buildCompiledSubflowData(skill.id, toolOutputs, params.candidateScope);
    const hasSummarizeStage = skill.workflow.stages.some((stage) => stage.kind === "summarize");
    if (params.summarizer && hasSummarizeStage) {
        try {
            const summarizerInput = {
                skillId: skill.id,
                skillName: skill.name,
                skillNarrative: skill.narrativeBody,
                userMessage: params.userMessage,
                skillInput: input,
                toolOutputs: Array.from(toolOutputs.entries()).map(([name, output]) => ({
                    name,
                    output,
                })),
            };
            let llmSummary = "";
            if (params.publishSummaryStreamEvent) {
                const messageId = createServerId("msg");
                let streamSequence = sequence;
                await params.publishSummaryStreamEvent({
                    sequence: streamSequence,
                    type: "started",
                    message_id: messageId,
                });
                streamSequence += 1;
                llmSummary = await params.summarizer.summarize(summarizerInput, async (chunk) => {
                    if (!chunk) {
                        return;
                    }
                    await params.publishSummaryStreamEvent?.({
                        sequence: streamSequence,
                        type: "delta",
                        message_id: messageId,
                        delta: chunk,
                    });
                    streamSequence += 1;
                });
                await params.publishSummaryStreamEvent({
                    sequence: streamSequence,
                    type: "completed",
                    message_id: messageId,
                    content: llmSummary,
                });
                streamSequence += 1;
                sequence = streamSequence;
                streamedSummary = true;
            }
            else {
                llmSummary = await params.summarizer.summarize(summarizerInput);
            }
            if (llmSummary) {
                logWorkflowDebug("compiled.execute.summarize.llm", {
                    skillId: params.skillId,
                    chars: llmSummary.length,
                });
                summary = llmSummary;
            }
        }
        catch (error) {
            logWorkflowDebug("compiled.execute.summarize.error", {
                skillId: params.skillId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
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
        streamedSummary,
    };
}
// Sentinel returned by resolveTemplateString for placeholders that have no
// supplied value. resolveTemplateArguments uses it to omit the corresponding
// object key entirely so we never send literals like "$input.service_id" to
// MCP tools.
const UNRESOLVED_PLACEHOLDER = Symbol("unresolved-placeholder");
/**
 * Apply Rainbond-specific fallbacks before the input map is exposed to
 * branch when-expressions and template resolution.
 *
 * Today: when the LLM router cannot extract `service_id` from a Chinese
 * component name like "2048-game组件", fall back to the component identifier
 * the UI already provided in session context. That identifier may still be a
 * route alias rather than a real MCP `service_id`, so later template
 * resolution must canonicalize it against `rainbond_query_components` output
 * before invoking component-scoped MCP tools.
 */
function enrichInputWithContextFallbacks(input, scope) {
    const enriched = { ...input };
    const supplied = enriched.service_id;
    const hasSupplied = typeof supplied === "string" && supplied.trim() !== "";
    if (!hasSupplied && scope.componentId && scope.componentId.trim() !== "") {
        enriched.service_id = scope.componentId;
    }
    return enriched;
}
function resolveTemplateArguments(value, actor, candidateScope, input, toolOutputs) {
    if (typeof value === "string") {
        const resolved = resolveTemplateString(value, actor, candidateScope, input, toolOutputs);
        return resolved === UNRESOLVED_PLACEHOLDER ? undefined : resolved;
    }
    if (Array.isArray(value)) {
        const out = [];
        for (const item of value) {
            const resolved = resolveTemplateArguments(item, actor, candidateScope, input, toolOutputs);
            if (resolved !== undefined) {
                out.push(resolved);
            }
        }
        return out;
    }
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, entryValue] of Object.entries(value)) {
            const resolved = resolveTemplateArguments(entryValue, actor, candidateScope, input, toolOutputs);
            if (resolved !== undefined) {
                out[key] = resolved;
            }
        }
        return out;
    }
    return value;
}
function resolveTemplateString(value, actor, candidateScope, input, toolOutputs) {
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
        if (inputKey === "service_id" && typeof supplied === "string") {
            return resolveComponentScopedServiceId(toolOutputs, supplied);
        }
        if (inputKey === "dep_service_id" && typeof supplied === "string") {
            return resolveComponentScopedServiceId(toolOutputs, supplied);
        }
        return supplied;
    }
    if (value.startsWith("$tool.")) {
        const supplied = readWorkflowValueRef(value, {
            input,
            context: {},
            tool: Object.fromEntries(toolOutputs.entries()),
        });
        if (supplied === undefined || supplied === null || supplied === "") {
            return UNRESOLVED_PLACEHOLDER;
        }
        return supplied;
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
function resolveComponentScopedServiceId(toolOutputs, candidate) {
    const normalizedCandidate = (candidate || "").trim();
    if (!normalizedCandidate) {
        return candidate;
    }
    const componentPayload = asRecord(toolOutputs.get("rainbond_query_components"));
    const items = Array.isArray(componentPayload?.items)
        ? componentPayload.items
        : [];
    if (items.length === 0) {
        return candidate;
    }
    const matched = items.find((item) => readStructuredString(item, "service_id") === normalizedCandidate) ||
        items.find((item) => readStructuredString(item, "service_alias", "service_cname", "component_name", "service_key") === normalizedCandidate);
    if (matched) {
        return readStructuredString(matched, "service_id") || candidate;
    }
    return items.length === 1
        ? readStructuredString(items[0], "service_id") || candidate
        : candidate;
}
function buildBranchContext(input, context, toolOutputs) {
    return {
        input,
        context,
        tool: Object.fromEntries(toolOutputs.entries()),
    };
}
function evaluateLoopCondition(expression, ctx) {
    return evalWhenExpression(expression, ctx);
}
