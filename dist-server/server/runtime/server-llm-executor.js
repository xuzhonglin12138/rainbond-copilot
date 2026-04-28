import { CustomAnthropicClient } from "../../llm/custom-anthropic-client.js";
import { getLLMConfig } from "../../llm/config.js";
import { OpenAIClient } from "../../llm/openai-client.js";
import { summarizeLogs } from "../../runtime/runtime-helpers.js";
import { buildReadOnlyMcpToolDefinitions, filterReadOnlyMcpTools, } from "../integrations/rainbond-mcp/query-tools.js";
import { buildMutableMcpToolDefinitions, evaluateMutableToolApproval, filterMutableMcpTools, isMutableMcpToolName, } from "../integrations/rainbond-mcp/mutable-tools.js";
import { getMutableToolPolicy } from "../integrations/rainbond-mcp/mutable-tool-policy.js";
import { cloneChatMessages, deriveCompletedToolCallIds, toPendingWorkflowActionFromRunApproval, toRunPendingApproval, } from "../stores/session-store.js";
import { advanceRunLoop } from "./run-loop.js";
import { createRunExecutionState, } from "./run-execution-state.js";
import { createServerActionSkills } from "./server-action-skills.js";
import { buildSessionContextPromptMessages } from "./session-context-prompt.js";
import { buildServerSystemPrompt } from "./server-system-prompt.js";
import { createServerId } from "../utils/id.js";
function normalizeK8sAppNameSeed(value) {
    const lowered = (value || "").trim().toLowerCase();
    const replaced = lowered.replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-");
    const trimmed = replaced.replace(/^-+|-+$/g, "");
    if (!trimmed) {
        return "app";
    }
    if (!/^[a-z]/.test(trimmed)) {
        return `app-${trimmed}`;
    }
    return trimmed;
}
function buildGeneratedK8sAppName(value) {
    const seed = normalizeK8sAppNameSeed(value);
    const suffix = Date.now().toString(36).slice(-6);
    const maxSeedLength = 63 - suffix.length - 1;
    const truncatedSeed = seed.slice(0, maxSeedLength).replace(/-+$/g, "") || "app";
    return `${truncatedSeed}-${suffix}`;
}
export class ServerLlmExecutor {
    constructor(deps) {
        this.deps = deps;
        this.enableLegacyActionSkills = deps.enableLegacyActionSkills === true;
        this.skills = this.enableLegacyActionSkills
            ? createServerActionSkills(deps.actionAdapter)
            : {};
        this.resolvedClient = deps.llmClient;
    }
    async execute(params) {
        const llmClient = this.getClient();
        if (!llmClient) {
            return false;
        }
        const mcpToolContext = await this.resolveMcpToolContext(params);
        const tools = this.buildTools(mcpToolContext.readOnlyDefinitions, mcpToolContext.mutableDefinitions);
        const toolResultCache = new Map();
        let lastStreamedAssistantMessageId = null;
        const state = await this.createExecutionState(params);
        const result = await advanceRunLoop({
            state,
            tools,
            chat: async (messages, toolDefinitions) => {
                if (typeof llmClient.streamChat !== "function") {
                    return llmClient.chat(messages, toolDefinitions);
                }
                let streamedMessageId = "";
                let streamedContent = "";
                const response = await llmClient.streamChat(messages, toolDefinitions, async (chunk) => {
                    if (!chunk) {
                        return;
                    }
                    streamedContent += chunk;
                    if (!streamedMessageId) {
                        streamedMessageId = createServerId("msg");
                        await this.publishAssistantMessageStarted(params, streamedMessageId);
                    }
                    await this.publishAssistantMessageDelta(params, streamedMessageId, chunk);
                });
                if (streamedMessageId) {
                    const completedContent = typeof response.content === "string" && response.content
                        ? response.content
                        : streamedContent;
                    await this.publishAssistantMessageCompleted(params, streamedMessageId, completedContent);
                    if (!response.tool_calls || response.tool_calls.length === 0) {
                        lastStreamedAssistantMessageId = streamedMessageId;
                    }
                }
                return response;
            },
            maxIterations: 8,
            maxIterationsFinalOutput: "本次分析轮次已达上限，请尝试缩小问题范围后重新提问。",
            handleToolCall: (loopParams) => this.handleRunLoopToolCall({
                executeParams: params,
                loopParams,
                mcpToolContext,
                toolResultCache,
            }),
        });
        if (result.nextStep.type === "interruption") {
            if (!this.deps.requestApproval) {
                throw new Error("requestApproval callback is required for protected tools");
            }
            const pendingApproval = result.pendingApprovals[0];
            if (!pendingApproval) {
                return true;
            }
            await this.deps.requestApproval({
                actor: params.actor,
                sessionId: params.sessionId,
                runId: params.runId,
                pendingAction: toPendingWorkflowActionFromRunApproval(pendingApproval),
                continuation: {
                    iteration: result.iteration,
                    messages: cloneChatMessages(result.messages),
                },
                description: pendingApproval.description || `执行 ${pendingApproval.toolName}`,
                risk: pendingApproval.risk,
                scope: pendingApproval.scope,
            });
            return true;
        }
        if (result.nextStep.type === "failed") {
            throw new Error(result.finalOutput || "Run loop failed");
        }
        const summaryMessages = result.messages.length > 0 &&
            result.messages[result.messages.length - 1].role === "assistant" &&
            !result.messages[result.messages.length - 1].tool_calls
            ? result.messages.slice(0, -1)
            : result.messages;
        const synthesizedSummary = this.buildAssistantSummaryFromToolResults(summaryMessages, params.message);
        const content = this.mergeAssistantContentWithToolResults(result.finalOutput || "", synthesizedSummary) ||
            "我已经完成当前分析，但没有生成额外回复。";
        await this.publishAssistantMessage(params, content, lastStreamedAssistantMessageId || undefined);
        await this.publishRunStatus(params, "done");
        return true;
    }
    async createExecutionState(params) {
        const state = createRunExecutionState({
            runId: params.runId,
            sessionId: params.sessionId,
            tenantId: params.actor.tenantId,
            initialMessage: params.message,
        });
        state.messages = params.continuation?.messages
            ? cloneChatMessages(params.continuation.messages)
            : [
                {
                    role: "system",
                    content: await buildServerSystemPrompt({
                        currentSkillId: params.currentSkillId,
                    }),
                },
                ...buildSessionContextPromptMessages(params.sessionContext),
                {
                    role: "user",
                    content: params.message,
                },
            ];
        state.iteration = params.continuation?.iteration || 0;
        state.completedToolCallIds = deriveCompletedToolCallIds(state.messages);
        return state;
    }
    async handleRunLoopToolCall(params) {
        const { executeParams, loopParams, mcpToolContext, toolResultCache } = params;
        const { toolCall, toolCalls, toolIndex } = loopParams;
        const toolInput = JSON.parse(toolCall.function.arguments || "{}");
        const skill = this.skills[toolCall.function.name];
        if (skill) {
            const skillCacheKey = this.buildToolCacheKey(toolCall.function.name, toolInput);
            const cachedSkillResult = toolResultCache.get(skillCacheKey);
            if (cachedSkillResult) {
                return {
                    type: "tool_output",
                    content: cachedSkillResult.toolMessageContent,
                    toolName: toolCall.function.name,
                };
            }
            const approvalDecision = this.evaluateSkillApproval(skill, toolInput);
            if (approvalDecision.requiresApproval) {
                const followUpActions = await this.buildFollowUpActionsFromToolCalls({
                    toolCalls,
                    startIndex: toolIndex + 1,
                    executeParams,
                    mcpToolContext,
                });
                return {
                    type: "interruption",
                    pendingApproval: {
                        kind: "action_skill",
                        toolName: toolCall.function.name,
                        toolCallId: toolCall.id,
                        requiresApproval: true,
                        risk: approvalDecision.risk,
                        description: approvalDecision.reason,
                        arguments: toolInput,
                        followUpActions: followUpActions.map((item) => toRunPendingApproval(item)),
                    },
                };
            }
            const traceId = createServerId("trace");
            await this.publishTrace(executeParams, {
                trace_id: traceId,
                tool_call_id: toolCall.id,
                tool_name: skill.name,
                input: toolInput,
            });
            const output = await skill.execute(toolInput);
            const toolMessageContent = JSON.stringify(output);
            toolResultCache.set(skillCacheKey, {
                traceOutput: output,
                toolMessageContent,
            });
            await this.publishTrace(executeParams, {
                trace_id: traceId,
                tool_call_id: toolCall.id,
                tool_name: skill.name,
                input: toolInput,
                output,
            });
            return {
                type: "tool_output",
                content: toolMessageContent,
                toolName: toolCall.function.name,
            };
        }
        const mcpTool = mcpToolContext.byName.get(toolCall.function.name);
        if (!mcpTool || !mcpToolContext.client) {
            return { type: "continue" };
        }
        const enrichedInput = this.enrichQueryToolInput(mcpTool.name, toolInput, executeParams.sessionContext, executeParams.actor);
        const resolvedInput = await this.resolveComponentScopedInput(mcpTool.name, enrichedInput, mcpToolContext.client, executeParams.sessionContext, executeParams.actor);
        if (isMutableMcpToolName(mcpTool.name)) {
            const approvalDecision = evaluateMutableToolApproval(mcpTool.name, resolvedInput);
            if (approvalDecision.requiresApproval) {
                const followUpActions = await this.buildFollowUpActionsFromToolCalls({
                    toolCalls,
                    startIndex: toolIndex + 1,
                    executeParams,
                    mcpToolContext,
                });
                return {
                    type: "interruption",
                    pendingApproval: {
                        kind: "mcp_tool",
                        toolName: mcpTool.name,
                        toolCallId: toolCall.id,
                        requiresApproval: true,
                        risk: approvalDecision.risk,
                        scope: approvalDecision.scope,
                        description: approvalDecision.reason,
                        arguments: resolvedInput,
                        followUpActions: followUpActions.map((item) => toRunPendingApproval(item)),
                    },
                };
            }
        }
        const mcpCacheKey = this.buildToolCacheKey(toolCall.function.name, resolvedInput);
        const cachedMcpResult = toolResultCache.get(mcpCacheKey);
        if (cachedMcpResult) {
            return {
                type: "tool_output",
                content: cachedMcpResult.toolMessageContent,
                toolName: mcpTool.name,
            };
        }
        const traceId = createServerId("trace");
        await this.publishTrace(executeParams, {
            trace_id: traceId,
            tool_call_id: toolCall.id,
            tool_name: mcpTool.name,
            input: resolvedInput,
        });
        const output = await mcpToolContext.client.callTool(mcpTool.name, resolvedInput);
        const toolMessageContent = JSON.stringify(this.serializeMcpToolResult(output));
        toolResultCache.set(mcpCacheKey, {
            traceOutput: output,
            toolMessageContent,
        });
        await this.publishTrace(executeParams, {
            trace_id: traceId,
            tool_call_id: toolCall.id,
            tool_name: mcpTool.name,
            input: resolvedInput,
            output,
        });
        return {
            type: "tool_output",
            content: toolMessageContent,
            toolName: mcpTool.name,
        };
    }
    buildAssistantSummaryFromToolResults(messages, userMessage) {
        const trailingToolMessages = [];
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
        const combinedSummary = this.summarizeCombinedToolMessages(trailingToolMessages, userMessage);
        if (combinedSummary) {
            return combinedSummary;
        }
        const seenSummaries = new Set();
        const summaries = trailingToolMessages
            .map((message) => this.summarizeToolMessage(message, userMessage))
            .filter((item) => !!item)
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
    summarizeCombinedToolMessages(toolMessages, userMessage) {
        if (!/(组件|component)/i.test(userMessage || "")) {
            return null;
        }
        const parsedMessages = toolMessages
            .map((message) => ({
            name: message.name || "",
            payload: this.parseToolMessagePayload(message),
        }))
            .filter((item) => !!item.payload);
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
        const summaryService = latestSummary && typeof latestSummary.service === "object"
            ? latestSummary.service
            : {};
        const detailService = latestDetail && typeof latestDetail === "object" ? latestDetail : {};
        const componentName = this.extractDisplayName(summaryService) ||
            this.extractDisplayName(detailService) ||
            "当前组件";
        const status = (latestSummary &&
            latestSummary.status &&
            typeof latestSummary.status === "object" &&
            latestSummary.status.status) ||
            (summaryService && summaryService.status) ||
            (detailService && detailService.status) ||
            "";
        const memory = typeof summaryService.min_memory === "number"
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
            .map((item) => item && typeof item === "object"
            ? item.url || item.domain_name || item.access_url || ""
            : "")
            .find(Boolean);
        const segments = [];
        if (status && memory) {
            segments.push(`当前组件 ${componentName} 状态为 ${status}，当前配置内存 ${memory}。`);
        }
        else if (status) {
            segments.push(`当前组件 ${componentName} 状态为 ${status}。`);
        }
        else {
            segments.push(`已获取当前组件 ${componentName} 的相关信息。`);
        }
        if (accessAddress) {
            segments.push(`当前可访问地址 ${accessAddress}。`);
        }
        return segments.join(" ");
    }
    parseToolMessagePayload(message) {
        try {
            const parsed = JSON.parse(String(message.content || "{}"));
            if (parsed.structuredContent && typeof parsed.structuredContent === "object") {
                return parsed.structuredContent;
            }
            return parsed;
        }
        catch {
            return null;
        }
    }
    enrichQueryToolInput(toolName, input, sessionContext, actor) {
        const nextInput = { ...(input || {}) };
        const context = sessionContext || {};
        const enterpriseId = this.readContextString(context.enterpriseId, context.enterprise_id, actor.enterpriseId);
        const teamName = this.readContextString(context.teamName, context.team_name, actor.tenantName, actor.tenantId);
        const regionName = this.readContextString(context.regionName, context.region_name, actor.regionName);
        const appId = this.readContextString(context.appId, context.app_id);
        const componentId = this.readContextString(context.componentId, context.component_id);
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
        if (toolName === "rainbond_create_app_from_snapshot_version" &&
            !nextInput.k8s_app) {
            const targetAppName = typeof nextInput.target_app_name === "string"
                ? nextInput.target_app_name
                : "";
            nextInput.k8s_app = buildGeneratedK8sAppName(targetAppName || "app");
        }
        return nextInput;
    }
    async resolveComponentScopedInput(toolName, input, client, sessionContext, actor) {
        if (!this.isComponentScopedToolName(toolName)) {
            return input;
        }
        const nextInput = { ...(input || {}) };
        const enterpriseId = this.readContextString(nextInput.enterprise_id, sessionContext?.enterpriseId, sessionContext?.enterprise_id, actor.enterpriseId);
        const appIdRaw = this.readContextString(nextInput.app_id, sessionContext?.appId, sessionContext?.app_id);
        const contextComponentId = this.readContextString(sessionContext?.componentId, sessionContext?.component_id);
        const contextComponentSource = this.readContextString(sessionContext?.component_source);
        if (!enterpriseId || !appIdRaw) {
            return nextInput;
        }
        const parsedAppId = Number(appIdRaw);
        const appId = Number.isNaN(parsedAppId) ? appIdRaw : parsedAppId;
        if (typeof nextInput.service_id === "string" && nextInput.service_id) {
            nextInput.service_id =
                await this.resolveServiceIdCandidate(client, enterpriseId, appId, nextInput.service_id);
        }
        if (Array.isArray(nextInput.service_ids) && nextInput.service_ids.length > 0) {
            nextInput.service_ids = await Promise.all(nextInput.service_ids.map(async (item) => {
                if (typeof item !== "string" || !item) {
                    return item;
                }
                return this.resolveServiceIdCandidate(client, enterpriseId, appId, item);
            }));
        }
        if (toolName === "rainbond_vertical_scale_component" &&
            typeof nextInput.new_gpu !== "number") {
            nextInput.new_gpu = await this.resolveCurrentComponentGpu(client, nextInput);
        }
        return nextInput;
    }
    async resolveServiceIdCandidate(client, enterpriseId, appId, candidate) {
        try {
            const result = await client.callTool("rainbond_query_components", {
                enterprise_id: enterpriseId,
                app_id: appId,
                query: candidate,
                page: 1,
                page_size: 20,
            });
            const items = Array.isArray(result.structuredContent?.items)
                ? result.structuredContent.items
                : [];
            const matched = items.find((item) => item.service_id === candidate) ||
                items.find((item) => item.service_alias === candidate) ||
                items.find((item) => item.service_cname === candidate) ||
                items[0];
            return matched?.service_id || candidate;
        }
        catch {
            return candidate;
        }
    }
    async resolveCurrentComponentGpu(client, input) {
        try {
            const result = await client.callTool("rainbond_get_component_summary", {
                team_name: input.team_name,
                region_name: input.region_name,
                app_id: input.app_id,
                service_id: input.service_id,
                event_limit: 1,
            });
            const gpu = result.structuredContent?.service?.container_gpu;
            return typeof gpu === "number" ? gpu : 0;
        }
        catch {
            return 0;
        }
    }
    isComponentScopedToolName(toolName) {
        if (/^rainbond_get_component_/.test(toolName)) {
            return true;
        }
        const policy = getMutableToolPolicy(toolName);
        return policy?.scope === "component";
    }
    mergeAssistantContentWithToolResults(content, synthesizedSummary) {
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
    isLowInformationAssistantReply(content) {
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
    summarizeToolMessage(message, userMessage) {
        let parsed;
        try {
            parsed = JSON.parse(String(message.content || "{}"));
        }
        catch {
            return null;
        }
        const normalizedPayload = parsed.structuredContent && typeof parsed.structuredContent === "object"
            ? parsed.structuredContent
            : parsed;
        switch (message.name) {
            case "get-component-status": {
                const name = typeof normalizedPayload.name === "string"
                    ? normalizedPayload.name
                    : "目标组件";
                const status = typeof normalizedPayload.status === "string"
                    ? normalizedPayload.status
                    : "unknown";
                const memory = typeof normalizedPayload.memory === "number"
                    ? `${normalizedPayload.memory}MB`
                    : "未知";
                return `${name} 当前状态为 ${status}，配置内存 ${memory}。`;
            }
            case "get-component-logs": {
                const name = typeof normalizedPayload.name === "string"
                    ? normalizedPayload.name
                    : "目标组件";
                const logs = Array.isArray(normalizedPayload.logs)
                    ? normalizedPayload.logs.filter((item) => typeof item === "string")
                    : [];
                const logSummary = logs.length > 0 ? summarizeLogs(logs) : "最近日志中没有明显异常。";
                return `${name} 的日志已读取完成。${logSummary}`;
            }
            case "restart-component": {
                const name = typeof normalizedPayload.name === "string"
                    ? normalizedPayload.name
                    : "目标组件";
                const status = typeof normalizedPayload.status === "string"
                    ? normalizedPayload.status
                    : "未知";
                return `${name} 已完成重启，当前状态为 ${status}。`;
            }
            case "scale-component-memory": {
                const name = typeof normalizedPayload.name === "string"
                    ? normalizedPayload.name
                    : "目标组件";
                const memory = typeof normalizedPayload.memory === "number"
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
                return this.summarizeGenericQueryPayload(message.name || "", normalizedPayload, userMessage);
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
    evaluateSkillApproval(skill, input) {
        if (skill.approvalPolicy) {
            const decision = skill.approvalPolicy.evaluate(input);
            return {
                requiresApproval: !!decision.requiresApproval,
                risk: (decision.risk || skill.risk || "medium"),
                reason: decision.reason || `执行 ${skill.id}`,
            };
        }
        return {
            requiresApproval: !!skill.requiresApproval,
            risk: (skill.risk || "low"),
            reason: `执行 ${skill.id}`,
        };
    }
    async resolveMcpToolContext(params) {
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
            const tools = this.filterContextualMcpTools(await client.listTools(), params.message, params.sessionContext);
            return {
                client,
                readOnlyDefinitions: filterReadOnlyMcpTools(tools),
                mutableDefinitions: this.filterApprovedMutableMcpTools(tools),
                byName: new Map([
                    ...filterReadOnlyMcpTools(tools),
                    ...this.filterApprovedMutableMcpTools(tools),
                ].map((tool) => [tool.name, tool])),
            };
        }
        catch {
            return {
                client: null,
                readOnlyDefinitions: [],
                mutableDefinitions: [],
                byName: new Map(),
            };
        }
    }
    filterContextualMcpTools(tools, userMessage, sessionContext) {
        const context = sessionContext || {};
        const hasEnterprise = !!this.readContextString(context.enterpriseId, context.enterprise_id);
        const hasTeam = !!this.readContextString(context.teamName, context.team_name);
        const hasRegion = !!this.readContextString(context.regionName, context.region_name);
        const normalizedMessage = (userMessage || "").toLowerCase();
        const wantsEnterpriseList = /企业列表|所有企业|enterprise/i.test(normalizedMessage);
        const wantsTeamList = /团队列表|所有团队|teams|team list|切换团队/i.test(normalizedMessage);
        const wantsRegionList = /集群列表|所有集群|regions|region list|切换集群/i.test(normalizedMessage);
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
    buildTools(readOnlyTools = [], mutableTools = []) {
        return [
            ...(this.enableLegacyActionSkills
                ? Object.values(this.skills).map((skill) => ({
                    type: "function",
                    function: {
                        name: skill.id,
                        description: skill.description,
                        parameters: this.inferParameters(skill.id),
                    },
                }))
                : []),
            ...buildReadOnlyMcpToolDefinitions(readOnlyTools),
            ...buildMutableMcpToolDefinitions(mutableTools),
        ];
    }
    filterApprovedMutableMcpTools(tools) {
        const allowedAppToolNames = new Set([
            "rainbond_check_yaml_app",
            "rainbond_check_helm_app",
            "rainbond_create_app_upgrade_record",
            "rainbond_create_app_version_snapshot",
            "rainbond_init_package_upload",
            "rainbond_upload_package_file",
            "rainbond_delete_package_upload",
            "rainbond_create_app_from_yaml",
            "rainbond_create_app_share_record",
            "rainbond_submit_app_share_info",
            "rainbond_giveup_app_share",
            "rainbond_delete_app_share_record",
            "rainbond_create_app_from_snapshot_version",
            "rainbond_create_gateway_rules",
            "rainbond_build_helm_app",
            "rainbond_close_apps",
            "rainbond_copy_app",
            "rainbond_delete_app",
            "rainbond_delete_app_version_snapshot",
            "rainbond_delete_app_version_rollback_record",
            "rainbond_execute_app_upgrade_record",
            "rainbond_deploy_app_upgrade_record",
            "rainbond_rollback_app_upgrade_record",
            "rainbond_rollback_app_version_snapshot",
            "rainbond_start_app_share_event",
            "rainbond_complete_app_share",
            "rainbond_install_app_model",
            "rainbond_install_app_by_market",
            "rainbond_upgrade_app",
        ]);
        const allowedComponentToolNames = new Set([
            "rainbond_manage_component_envs",
            "rainbond_manage_component_connection_envs",
            "rainbond_manage_component_dependency",
            "rainbond_manage_component_ports",
            "rainbond_manage_component_storage",
            "rainbond_manage_component_autoscaler",
            "rainbond_manage_component_probe",
            "rainbond_horizontal_scale_component",
            "rainbond_vertical_scale_component",
            "rainbond_build_component",
            "rainbond_change_component_image",
            "rainbond_create_component",
            "rainbond_create_component_from_image",
            "rainbond_create_component_from_source",
            "rainbond_create_component_from_local_package",
            "rainbond_create_component_from_package",
            "rainbond_delete_component",
            "rainbond_operate_app",
        ]);
        const allowedTeamToolNames = new Set(["rainbond_create_app"]);
        return filterMutableMcpTools(tools).filter((tool) => {
            const policy = getMutableToolPolicy(tool.name);
            if (!policy) {
                return false;
            }
            return (policy.scope === "enterprise" ||
                allowedAppToolNames.has(tool.name) ||
                allowedComponentToolNames.has(tool.name) ||
                allowedTeamToolNames.has(tool.name));
        });
    }
    serializeMcpToolResult(output) {
        return {
            isError: output.isError,
            structuredContent: output.structuredContent,
        };
    }
    summarizeCollectionPayload(label, payload) {
        const items = Array.isArray(payload.items) ? payload.items : [];
        const total = typeof payload.total === "number" ? payload.total : items.length;
        const previewNames = items
            .slice(0, 3)
            .map((item) => this.extractDisplayName(item))
            .filter(Boolean);
        if (previewNames.length > 0) {
            return `已查询${label}，当前返回 ${total} 条记录，前几项包括：${previewNames.join("、")}。`;
        }
        return `已查询${label}，当前返回 ${total} 条记录。`;
    }
    summarizeComponentSummaryPayload(payload) {
        const service = payload.service || {};
        const status = payload.status || {};
        const componentName = service.component_name || service.service_alias || "目标组件";
        const phase = status.status || "unknown";
        const memory = typeof service.min_memory === "number"
            ? `${service.min_memory}MB`
            : typeof payload.memory === "number"
                ? `${payload.memory}MB`
                : "未知";
        return `${componentName} 当前状态为 ${phase}，当前配置内存 ${memory}。`;
    }
    summarizeComponentDetailPayload(payload) {
        const service = payload.service || {};
        const componentName = service.component_name || service.service_alias || "目标组件";
        const status = payload.status?.status ||
            service.status ||
            "unknown";
        return `${componentName} 的详细信息已获取，当前状态为 ${status}。`;
    }
    summarizeAppDetailPayload(payload) {
        const appName = payload.group_name || payload.app_name || payload.group_alias || "当前应用";
        const status = payload.status || "unknown";
        return `${appName} 当前状态为 ${status}。`;
    }
    summarizeAppVersionOverviewPayload(payload) {
        const overview = payload.overview || {};
        if (overview.current_version) {
            return `当前版本中心的当前版本为 ${overview.current_version}。`;
        }
        return "已获取版本中心概览信息。";
    }
    summarizeGenericQueryPayload(toolName, payload, userMessage) {
        const structuredContent = payload.structuredContent && typeof payload.structuredContent === "object"
            ? payload.structuredContent
            : payload;
        if (Array.isArray(structuredContent.items)) {
            return this.summarizeCollectionPayload(toolName, structuredContent);
        }
        if (typeof structuredContent.user_id === "string" ||
            typeof structuredContent.user_id === "number") {
            const displayName = structuredContent.nick_name ||
                structuredContent.real_name ||
                String(structuredContent.user_id);
            const email = structuredContent.email
                ? `，邮箱 ${structuredContent.email}`
                : "";
            const enterpriseId = structuredContent.enterprise_id
                ? `，企业 ID ${structuredContent.enterprise_id}`
                : "";
            const enterpriseRole = structuredContent.is_enterprise_admin === true
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
    readContextString(...values) {
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
    buildToolCacheKey(toolName, input) {
        return `${toolName}:${JSON.stringify(input || {})}`;
    }
    async buildFollowUpActionsFromToolCalls(params) {
        const { toolCalls, startIndex, executeParams, mcpToolContext } = params;
        const followUps = [];
        for (let index = startIndex; index < toolCalls.length; index += 1) {
            const action = await this.buildPendingActionFromToolCall(toolCalls[index], executeParams, mcpToolContext);
            if (action) {
                followUps.push(action);
            }
        }
        return this.attachFollowUpActions(followUps);
    }
    attachFollowUpActions(actions) {
        return actions.map((action, index) => ({
            ...action,
            followUpActions: index + 1 < actions.length ? actions.slice(index + 1) : undefined,
        }));
    }
    async buildPendingActionFromToolCall(toolCall, params, mcpToolContext) {
        const toolName = toolCall.function.name;
        const toolInput = JSON.parse(toolCall.function.arguments || "{}");
        const skill = this.skills[toolName];
        if (skill) {
            const approvalDecision = this.evaluateSkillApproval(skill, toolInput);
            return {
                kind: "action_skill",
                toolName,
                toolCallId: toolCall.id,
                requiresApproval: approvalDecision.requiresApproval,
                risk: approvalDecision.risk,
                description: approvalDecision.reason,
                arguments: toolInput,
            };
        }
        const mcpTool = mcpToolContext.byName.get(toolName);
        if (!mcpTool || !mcpToolContext.client) {
            return null;
        }
        const enrichedInput = this.enrichQueryToolInput(mcpTool.name, toolInput, params.sessionContext, params.actor);
        const resolvedInput = await this.resolveComponentScopedInput(mcpTool.name, enrichedInput, mcpToolContext.client, params.sessionContext, params.actor);
        if (isMutableMcpToolName(mcpTool.name)) {
            const approvalDecision = evaluateMutableToolApproval(mcpTool.name, resolvedInput);
            return {
                kind: "mcp_tool",
                toolName: mcpTool.name,
                toolCallId: toolCall.id,
                requiresApproval: approvalDecision.requiresApproval,
                risk: approvalDecision.risk,
                scope: approvalDecision.scope,
                description: approvalDecision.reason,
                arguments: resolvedInput,
            };
        }
        return {
            kind: "mcp_tool",
            toolName: mcpTool.name,
            toolCallId: toolCall.id,
            requiresApproval: false,
            risk: "low",
            description: `执行 ${mcpTool.name}`,
            arguments: resolvedInput,
        };
    }
    extractDisplayName(item) {
        return (item.component_name ||
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
            "");
    }
    getClient() {
        if (this.resolvedClient !== undefined) {
            return this.resolvedClient;
        }
        try {
            const config = getLLMConfig();
            this.resolvedClient =
                config.provider === "anthropic"
                    ? new CustomAnthropicClient(config)
                    : new OpenAIClient(config);
        }
        catch {
            this.resolvedClient = null;
        }
        return this.resolvedClient;
    }
    inferParameters(skillId) {
        const parameterMap = {
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
        return (parameterMap[skillId] || {
            type: "object",
            properties: {},
        });
    }
    async publishTrace(params, data) {
        const traceId = typeof data.trace_id === "string" && data.trace_id
            ? data.trace_id
            : createServerId("trace");
        const tracePayload = {
            ...data,
            trace_id: traceId,
        };
        await this.deps.eventPublisher.publish({
            type: "chat.trace",
            tenantId: params.actor.tenantId,
            sessionId: params.sessionId,
            runId: params.runId,
            sequence: await this.nextSequence(params.runId, params.actor.tenantId),
            data: tracePayload,
        });
    }
    async publishAssistantMessage(params, content, messageId) {
        await this.deps.eventPublisher.publish({
            type: "chat.message",
            tenantId: params.actor.tenantId,
            sessionId: params.sessionId,
            runId: params.runId,
            sequence: await this.nextSequence(params.runId, params.actor.tenantId),
            data: {
                role: "assistant",
                content,
                ...(messageId ? { message_id: messageId } : {}),
            },
        });
    }
    async publishAssistantMessageStarted(params, messageId) {
        await this.deps.eventPublisher.publish({
            type: "chat.message.started",
            tenantId: params.actor.tenantId,
            sessionId: params.sessionId,
            runId: params.runId,
            sequence: await this.nextSequence(params.runId, params.actor.tenantId),
            data: {
                message_id: messageId,
                role: "assistant",
            },
        });
    }
    async publishAssistantMessageDelta(params, messageId, delta) {
        await this.deps.eventPublisher.publish({
            type: "chat.message.delta",
            tenantId: params.actor.tenantId,
            sessionId: params.sessionId,
            runId: params.runId,
            sequence: await this.nextSequence(params.runId, params.actor.tenantId),
            data: {
                message_id: messageId,
                delta,
            },
        });
    }
    async publishAssistantMessageCompleted(params, messageId, content) {
        await this.deps.eventPublisher.publish({
            type: "chat.message.completed",
            tenantId: params.actor.tenantId,
            sessionId: params.sessionId,
            runId: params.runId,
            sequence: await this.nextSequence(params.runId, params.actor.tenantId),
            data: {
                message_id: messageId,
                content,
            },
        });
    }
    async publishRunStatus(params, status) {
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
    async nextSequence(runId, tenantId) {
        const events = await this.deps.broker.replay(runId, tenantId, {
            afterSequence: 0,
        });
        return events.length + 1;
    }
}
