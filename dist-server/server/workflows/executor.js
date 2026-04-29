import { buildScopeSignature } from "./context-resolver.js";
import { buildPendingWorkflowActionCompletion } from "./pending-action-result.js";
import { canExecuteCompiledSkill, executeCompiledWorkflow, } from "./compiled-executor.js";
import { executeRainbondAppAssistant } from "./rainbond-app-assistant.js";
import { createWorkflowRegistry } from "./registry.js";
import { createRunExecutionState, } from "../runtime/run-execution-state.js";
import { logWorkflowDebug } from "./workflow-debug.js";
function isSnapshotCreationRequested(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return /((创建|建立|新建|生成|做一个|做个|创建一个|建立一个|新建一个).*(快照|snapshot))|((快照|snapshot).*(创建|建立|新建|生成))/i.test(normalized);
}
function shouldAutoCreateSnapshot(message) {
    return (isSnapshotCreationRequested(message) &&
        !/(回滚|rollback)/i.test((message || "").trim()));
}
function shouldAutoPublishSnapshot(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return (/(发布|publish|上架|分享到|同步到)/i.test(normalized) &&
        !/(发布记录|发布历史|发布事件|查看发布|publish record|publish history|publish event)/i.test(normalized));
}
function shouldAutoRollbackSnapshot(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return /(回滚|rollback|恢复到|退回到)/i.test(normalized);
}
function parseSnapshotVersionInput(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return "";
    }
    const matched = normalized.match(/\b(v?\d+\.\d+(?:\.\d+)?)\b/i);
    return matched && matched[1] ? matched[1] : "";
}
function suggestNextSnapshotVersion(version) {
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
function suggestRollbackSnapshotVersion(items) {
    if (items.length > 1) {
        return readStructuredString(items[1], "version");
    }
    if (items.length > 0) {
        return readStructuredString(items[0], "version");
    }
    return "v1.0.1";
}
function requestsRollbackToLatestSnapshot(message) {
    const normalized = (message || "").trim();
    if (!normalized || !/(回滚|rollback)/i.test(normalized)) {
        return false;
    }
    return /(最近快照|最新快照|最近版本|最新版本|latest snapshot|latest version|most recent snapshot)/i.test(normalized);
}
function requestsRollbackToPreviousSnapshot(message) {
    const normalized = (message || "").trim();
    if (!normalized || !/(回滚|rollback)/i.test(normalized)) {
        return false;
    }
    return /(上一个版本|上个版本|上一版本|前一个版本|上一个快照|上个快照|上一快照|previous version|previous snapshot)/i.test(normalized);
}
function prefersCloudPublishScope(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return /(云市场|应用市场|cloud market|goodrain)/i.test(normalized);
}
function shouldUseCloudTemplateInstall(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return /(云市场|应用市场|cloud market|market template|云模板)/i.test(normalized);
}
function extractTemplateSearchHint(message) {
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
function selectBestAppModel(items, hint) {
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
            }
            else if (candidate.includes(normalizedHint)) {
                score = Math.max(score, 60);
            }
            else if (normalizedHint.includes(candidate) && candidate.length >= 3) {
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
function selectPreferredCloudMarket(items) {
    if (items.length === 0) {
        return undefined;
    }
    const preferredByName = items.find((item) => readStructuredString(item, "name") === "RainbondMarket");
    if (preferredByName) {
        return preferredByName;
    }
    const preferredByAlias = items.find((item) => readStructuredString(item, "alias") === "开源应用市场");
    if (preferredByAlias) {
        return preferredByAlias;
    }
    const preferredByDomain = items.find((item) => readStructuredString(item, "domain") === "rainbond");
    if (preferredByDomain) {
        return preferredByDomain;
    }
    return items[0];
}
function extractAppModelVersions(model) {
    if (!model) {
        return [];
    }
    const candidates = [
        model.versions,
        model.versions_info,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate.filter((item) => item !== null && typeof item === "object");
        }
    }
    return [];
}
function selectLatestVersion(versions) {
    if (versions.length === 0) {
        return "";
    }
    const last = versions[versions.length - 1];
    return readStructuredString(last, "version", "app_version", "version_alias", "app_version_alias");
}
function parseHelmCreationIntent(message) {
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
function extractLogTexts(payload) {
    if (!payload) {
        return [];
    }
    if (Array.isArray(payload.items)) {
        return payload.items.filter((item) => typeof item === "string");
    }
    if (Array.isArray(payload.logs)) {
        return payload.logs.filter((item) => typeof item === "string");
    }
    return [];
}
function logsSuggestDependencyIssue(logs) {
    const joined = logs.join("\n").toLowerCase();
    if (!joined) {
        return false;
    }
    return (joined.includes("connection refused") ||
        joined.includes("econnrefused") ||
        joined.includes("dial tcp") ||
        joined.includes("no route to host") ||
        joined.includes("no such host") ||
        joined.includes("could not connect") ||
        joined.includes("failed to connect") ||
        joined.includes("database") ||
        joined.includes("postgres") ||
        joined.includes("mysql"));
}
function logsSuggestEnvCompatibilityIssue(logs) {
    const joined = logs.join("\n").toLowerCase();
    if (!joined) {
        return false;
    }
    return (joined.includes("db_host") ||
        joined.includes("db_port") ||
        joined.includes("missing environment variable") ||
        joined.includes("missing env") ||
        joined.includes("database url") ||
        joined.includes("dsn"));
}
function findDatabaseLikeComponent(items, currentServiceId) {
    return items.find((item) => {
        const serviceId = readStructuredString(item, "service_id");
        if (!serviceId || serviceId === currentServiceId) {
            return false;
        }
        const alias = readStructuredString(item, "service_alias", "service_cname").toLowerCase();
        return /(db|postgres|mysql|redis|database)/i.test(alias);
    });
}
function buildComponentIdentitySubflowData(component) {
    if (!component) {
        return {};
    }
    return {
        resolvedServiceId: readStructuredString(component, "service_id"),
        resolvedServiceAlias: readStructuredString(component, "service_alias", "service_cname"),
        componentName: readStructuredString(component, "component_name", "service_alias", "service_cname", "service_id"),
    };
}
function selectTroubleshooterTargetComponent(items, preferredCandidate) {
    if (items.length === 0) {
        return undefined;
    }
    const normalizedCandidate = (preferredCandidate || "").trim();
    if (normalizedCandidate) {
        const matched = items.find((item) => [
            readStructuredString(item, "service_id"),
            readStructuredString(item, "service_alias"),
            readStructuredString(item, "service_cname"),
            readStructuredString(item, "component_name"),
        ].includes(normalizedCandidate));
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
function detectTroubleshooterInspectionTool(message) {
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
function readStructuredInt(payload, ...keys) {
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
function findSnapshotVersionId(items, targetVersion) {
    if (!targetVersion || items.length === 0) {
        return 0;
    }
    const normalizedTarget = String(targetVersion).trim();
    const matched = items.find((item) => {
        const version = readStructuredString(item, "version", "share_version", "snapshot_version");
        return version === normalizedTarget;
    });
    return readStructuredInt(matched, "version_id", "ID", "id");
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
    if (!matched) {
        return 0;
    }
    return Number(matched[1]);
}
function isAppAssistantPrompt(message) {
    return /(rainbond.+跑起来|在 rainbond 上跑起来|部署|修复|恢复服务|卡在哪|排查|探针|probe|端口|port|存储|挂载|volume|autoscaler|伸缩|连接信息|helm|chart|模板|template|市场|安装到当前应用|快照|snapshot|发布|publish|回滚|rollback|版本中心|version center|交付|验收|验证|verify|访问地址|url|你能做什么|可以做什么|有哪些流程|有哪些能力|有哪些工作流|workflow|skill|技能|((这个|当前)?(组件|应用).*(怎么了|怎么回事|什么问题|有问题|出问题|啥情况))|((what'?s|what is).*(wrong|issue))|((component|app).*(wrong|issue)))/i.test(message);
}
export function isContinueWorkflowActionPrompt(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return /^(继续执行|确认执行|继续|立即执行|execute|confirm|run now|是的|是|好的|好|可以|行|没问题|没错|对)$/i.test(normalized);
}
export function isWorkflowContinuationReferencePrompt(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    if (isContinueWorkflowActionPrompt(normalized)) {
        return true;
    }
    return /^(继续排查|继续诊断|继续处理|往下看|下一步|走方案\s*[abAB]|方案\s*[abAB]|按方案\s*[abAB]|选方案\s*[abAB]|走这个|按这个|按建议|就按这个|那就这个|走方案[一二12]|方案[一二12])/.test(normalized);
}
function cloneRunExecutionState(state) {
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
    constructor(deps) {
        this.deps = deps;
        this.registry = deps.workflowRegistry || createWorkflowRegistry();
        this.enableRainbondAppAssistantWorkflow =
            deps.enableRainbondAppAssistantWorkflow === true;
    }
    async execute(params) {
        const session = await this.deps.sessionStore.getById(params.sessionId, params.actor.tenantId);
        if (!session || session.userId !== params.actor.userId) {
            throw new Error("Session not found");
        }
        const run = await this.deps.runStore.getById(params.runId, params.actor.tenantId);
        if (!run) {
            throw new Error("Run not found");
        }
        logWorkflowDebug("workflow.route.input", {
            message: params.message,
            hasPendingWorkflowAction: !!session.pendingWorkflowAction,
            hasPendingWorkflowContinuation: !!session.pendingWorkflowContinuation,
            isContinueWorkflowActionPrompt: isContinueWorkflowActionPrompt(params.message),
            isWorkflowContinuationReferencePrompt: isWorkflowContinuationReferencePrompt(params.message),
            isAppAssistantPrompt: isAppAssistantPrompt(params.message),
            sessionContext: session.context,
        });
        if (session.pendingWorkflowAction &&
            isContinueWorkflowActionPrompt(params.message)) {
            logWorkflowDebug("workflow.route.pending_action", {
                toolName: session.pendingWorkflowAction.toolName,
                requiresApproval: session.pendingWorkflowAction.requiresApproval,
            });
            return this.executePendingWorkflowAction(params, session);
        }
        if (!session.pendingWorkflowAction &&
            session.pendingWorkflowContinuation &&
            isWorkflowContinuationReferencePrompt(params.message)) {
            logWorkflowDebug("workflow.route.continuation", {
                selectedWorkflow: session.pendingWorkflowContinuation.selectedWorkflow,
                nextAction: session.pendingWorkflowContinuation.nextAction,
                suggestedActionCount: session.pendingWorkflowContinuation.suggestedActions?.length || 0,
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
                verified: true,
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
        const messageSequence = subflowExecution.streamedSummary
            ? 0
            : hasSubflowTrace
                ? (subflowExecution.lastSequence || 5) + 1
                : 4;
        const completedSequence = subflowExecution.streamedSummary
            ? (subflowExecution.lastSequence || 5) + 1
            : messageSequence + 1;
        const doneSequence = completedSequence + 1;
        if (!subflowExecution.streamedSummary) {
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
        }
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
            await this.deps.sessionStore.update({
                ...session,
                lastVerifiedScopeSignature: result.workflowStage !== "resolve-context"
                    ? buildScopeSignature({
                        ...result.candidateScope,
                        verified: true,
                    })
                    : session.lastVerifiedScopeSignature,
                verifiedScope: result.workflowStage !== "resolve-context"
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
            });
        }
        else {
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
    async executeSelectedSubflow(params) {
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
                userMessage: message,
                summarizer: this.deps.workflowSummarizer,
                publishToolTrace: async (trace) => {
                    await this.publishToolTrace(actor.tenantId, sessionId, runId, trace.sequence, {
                        tool_name: trace.tool_name,
                        input: trace.input,
                        ...(trace.output ? { output: trace.output } : {}),
                    });
                },
                publishSummaryStreamEvent: async (event) => {
                    const eventType = event.type === "started"
                        ? "chat.message.started"
                        : event.type === "delta"
                            ? "chat.message.delta"
                            : "chat.message.completed";
                    await this.deps.eventPublisher.publish({
                        type: eventType,
                        tenantId: actor.tenantId,
                        sessionId,
                        runId,
                        sequence: event.sequence,
                        data: event.type === "started"
                            ? {
                                message_id: event.message_id,
                                role: "assistant",
                            }
                            : event.type === "delta"
                                ? {
                                    message_id: event.message_id,
                                    delta: event.delta || "",
                                }
                                : {
                                    message_id: event.message_id,
                                    content: event.content || "",
                                },
                    });
                },
            });
        }
        if (result.selectedWorkflow === "rainbond-template-installer") {
            const isCloudInstall = shouldUseCloudTemplateInstall(message);
            const templateSearchHint = extractTemplateSearchHint(message);
            const enterpriseId = actor.enterpriseId || "";
            let sequenceCursor = 4;
            let marketName = "";
            let toolCalls = [];
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
                const marketItems = markets.structuredContent &&
                    Array.isArray(markets.structuredContent.items)
                    ? markets.structuredContent.items
                    : [];
                const selectedMarket = selectPreferredCloudMarket(marketItems);
                marketName = readStructuredString(selectedMarket, "market_name", "name", "market_id");
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
                const cloudModels = await client.callTool("rainbond_query_cloud_app_models", cloudModelInput);
                await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor + 1, {
                    tool_name: "rainbond_query_cloud_app_models",
                    input: cloudModelInput,
                    output: cloudModels,
                });
                sequenceCursor += 2;
                toolCalls.push({ name: "rainbond_query_cloud_app_models", status: "success" });
                const cloudModelItems = cloudModels.structuredContent &&
                    Array.isArray(cloudModels.structuredContent.items)
                    ? cloudModels.structuredContent.items
                    : [];
                let resolvedCloudItems = cloudModelItems;
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
                    const fallbackCloudModels = await client.callTool("rainbond_query_cloud_app_models", fallbackCloudModelInput);
                    await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor + 1, {
                        tool_name: "rainbond_query_cloud_app_models",
                        input: fallbackCloudModelInput,
                        output: fallbackCloudModels,
                    });
                    sequenceCursor += 2;
                    toolCalls.push({ name: "rainbond_query_cloud_app_models", status: "success" });
                    resolvedCloudItems =
                        fallbackCloudModels.structuredContent &&
                            Array.isArray(fallbackCloudModels.structuredContent.items)
                            ? fallbackCloudModels.structuredContent.items
                            : [];
                }
                const selectedCloudModel = selectBestAppModel(resolvedCloudItems, templateSearchHint);
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
                                    region_name: result.candidateScope.regionName || actor.regionName || "",
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
            const localModelItems = output.structuredContent &&
                Array.isArray(output.structuredContent.items)
                ? output.structuredContent.items
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
                const fallbackOutput = await client.callTool("rainbond_query_local_app_models", fallbackLocalInput);
                await this.publishToolTrace(actor.tenantId, sessionId, runId, 7, {
                    tool_name: "rainbond_query_local_app_models",
                    input: fallbackLocalInput,
                    output: fallbackOutput,
                });
                resolvedLocalItems =
                    fallbackOutput.structuredContent &&
                        Array.isArray(fallbackOutput.structuredContent.items)
                        ? fallbackOutput.structuredContent.items
                        : [];
            }
            const selectedLocalModel = selectBestAppModel(resolvedLocalItems, templateSearchHint);
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
                const versions = await client.callTool("rainbond_query_app_model_versions", versionInput);
                await this.publishToolTrace(actor.tenantId, sessionId, runId, 7, {
                    tool_name: "rainbond_query_app_model_versions",
                    input: versionInput,
                    output: versions,
                });
                return {
                    summary: `已查询当前企业下可安装的本地模板及其版本，建议安装版本为 ${versions.structuredContent &&
                        Array.isArray(versions.structuredContent.items) &&
                        versions.structuredContent.items.length > 0
                        ? versions.structuredContent.items[versions.structuredContent.items.length - 1].version
                        : ""}。如接受建议，可直接回复“继续执行”或“是的”；也可以直接回复目标版本号。`,
                    toolCalls: [
                        { name: "rainbond_query_local_app_models", status: "success" },
                        { name: "rainbond_query_app_model_versions", status: "success" },
                    ],
                    lastSequence: 7,
                    subflowData: {
                        appModelId: modelId,
                        appModelName: versions.structuredContent &&
                            versions.structuredContent.app_model
                            ? versions.structuredContent.app_model.app_model_name
                            : undefined,
                        versionCount: versions.structuredContent &&
                            Array.isArray(versions.structuredContent.items)
                            ? versions.structuredContent.items.length
                            : 0,
                        latestVersion: versions.structuredContent &&
                            Array.isArray(versions.structuredContent.items) &&
                            versions.structuredContent.items.length > 0
                            ? versions.structuredContent.items[versions.structuredContent.items.length - 1].version
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
                            app_model_version: versions.structuredContent &&
                                Array.isArray(versions.structuredContent.items) &&
                                versions.structuredContent.items.length > 0
                                ? versions.structuredContent.items[versions.structuredContent.items.length - 1].version
                                : "",
                            is_deploy: true,
                            __await_version_input: true,
                            suggested_version: versions.structuredContent &&
                                Array.isArray(versions.structuredContent.items) &&
                                versions.structuredContent.items.length > 0
                                ? versions.structuredContent.items[versions.structuredContent.items.length - 1].version
                                : "",
                        },
                        deferredAction: {
                            toolName: "rainbond_install_app_model",
                            requiresApproval: true,
                            missingArgument: "app_model_version",
                            suggestedValue: versions.structuredContent &&
                                Array.isArray(versions.structuredContent.items) &&
                                versions.structuredContent.items.length > 0
                                ? versions.structuredContent.items[versions.structuredContent.items.length - 1].version
                                : "",
                            arguments: {
                                team_name: result.candidateScope.teamName || actor.tenantId,
                                region_name: result.candidateScope.regionName || actor.regionName || "",
                                app_id: parseAppId(result.candidateScope.appId),
                                source: "local",
                                app_model_id: modelId,
                                app_model_version: versions.structuredContent &&
                                    Array.isArray(versions.structuredContent.items) &&
                                    versions.structuredContent.items.length > 0
                                    ? versions.structuredContent.items[versions.structuredContent.items.length - 1].version
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
            const snapshots = await client.callTool("rainbond_list_app_version_snapshots", input);
            await this.publishToolTrace(actor.tenantId, sessionId, runId, 7, {
                tool_name: "rainbond_list_app_version_snapshots",
                input,
                output: snapshots,
            });
            const snapshotItems = snapshots.structuredContent &&
                Array.isArray(snapshots.structuredContent.items)
                ? snapshots.structuredContent.items
                : [];
            const latestSnapshot = snapshotItems[0];
            let latestSnapshotDetail;
            if (latestSnapshot && latestSnapshot.version_id) {
                const detailInput = {
                    ...input,
                    version_id: latestSnapshot.version_id,
                };
                await this.publishToolTrace(actor.tenantId, sessionId, runId, 8, {
                    tool_name: "rainbond_get_app_version_snapshot_detail",
                    input: detailInput,
                });
                latestSnapshotDetail = await client.callTool("rainbond_get_app_version_snapshot_detail", detailInput);
                await this.publishToolTrace(actor.tenantId, sessionId, runId, 9, {
                    tool_name: "rainbond_get_app_version_snapshot_detail",
                    input: detailInput,
                    output: latestSnapshotDetail,
                });
            }
            const overviewPayload = output.structuredContent && typeof output.structuredContent === "object"
                ? output.structuredContent
                : {};
            const overviewData = overviewPayload.overview && typeof overviewPayload.overview === "object"
                ? overviewPayload.overview
                : overviewPayload;
            const latestSnapshotVersion = readStructuredString(latestSnapshot, "version");
            const latestSnapshotServiceCount = latestSnapshotDetail &&
                latestSnapshotDetail.structuredContent &&
                latestSnapshotDetail.structuredContent.detail &&
                Array.isArray(latestSnapshotDetail.structuredContent.detail.services)
                ? latestSnapshotDetail.structuredContent.detail.services.length
                : 0;
            const currentVersion = readStructuredString(overviewData, "current_version");
            const createSnapshotInput = {
                team_name: result.candidateScope.teamName || actor.tenantId,
                region_name: result.candidateScope.regionName || actor.regionName || "",
                app_id: parseAppId(result.candidateScope.appId),
            };
            const baseToolCalls = [
                { name: "rainbond_get_app_version_overview", status: "success" },
                { name: "rainbond_list_app_version_snapshots", status: "success" },
                ...(latestSnapshotDetail
                    ? [{ name: "rainbond_get_app_version_snapshot_detail", status: "success" }]
                    : []),
            ];
            const baseSubflowData = {
                currentVersion,
                snapshotCount: snapshotItems.length,
                latestSnapshotVersion,
                latestSnapshotServiceCount,
            };
            const preparePublishIntentResult = async (publishVersion, params) => {
                const resolvedPublishVersion = publishVersion || latestSnapshotVersion || currentVersion;
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
                const preferredAppId = readStructuredString(overviewData, "template_id", "app_model_id", "hidden_template_id");
                const publishCandidateInput = {
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
                const publishCandidates = await client.callTool("rainbond_get_app_publish_candidates", publishCandidateInput);
                await this.publishToolTrace(actor.tenantId, sessionId, runId, publishSequence + 1, {
                    tool_name: "rainbond_get_app_publish_candidates",
                    input: publishCandidateInput,
                    output: publishCandidates,
                });
                const candidateItems = publishCandidates.structuredContent &&
                    Array.isArray(publishCandidates.structuredContent.items)
                    ? publishCandidates.structuredContent.items
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
                const requestedSnapshotVersion = parseSnapshotVersionInput(message) ||
                    suggestNextSnapshotVersion(latestSnapshotVersion || currentVersion);
                const createSnapshotWithVersionInput = {
                    ...createSnapshotInput,
                    version: requestedSnapshotVersion,
                };
                const createSequence = (latestSnapshotDetail ? 9 : 7) + 1;
                await this.publishToolTrace(actor.tenantId, sessionId, runId, createSequence, {
                    tool_name: "rainbond_create_app_version_snapshot",
                    input: createSnapshotWithVersionInput,
                });
                const createSnapshotOutput = await client.callTool("rainbond_create_app_version_snapshot", createSnapshotWithVersionInput);
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
                return preparePublishIntentResult(parseSnapshotVersionInput(message) || latestSnapshotVersion || currentVersion);
            }
            if (shouldAutoRollbackSnapshot(message)) {
                const requestedRollbackVersion = parseSnapshotVersionInput(message);
                const latestRollbackVersion = readStructuredString(latestSnapshot, "version");
                const latestRollbackVersionId = readStructuredInt(latestSnapshot, "version_id", "ID", "id");
                const previousRollbackVersion = suggestRollbackSnapshotVersion(snapshotItems);
                const previousRollbackVersionId = snapshotItems.length > 1
                    ? readStructuredInt(snapshotItems[1], "version_id", "ID", "id")
                    : 0;
                const resolvedRollbackVersion = requestedRollbackVersion
                    ? requestedRollbackVersion
                    : requestsRollbackToLatestSnapshot(message)
                        ? latestRollbackVersion
                        : requestsRollbackToPreviousSnapshot(message)
                            ? previousRollbackVersion
                            : "";
                const resolvedRollbackVersionId = requestedRollbackVersion
                    ? findSnapshotVersionId(snapshotItems, requestedRollbackVersion)
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
                    const suggestedRollbackVersion = suggestRollbackSnapshotVersion(snapshotItems);
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
        if (result.selectedWorkflow === "rainbond-fullstack-bootstrap" ||
            result.selectedWorkflow === "rainbond-delivery-verifier" ||
            result.selectedWorkflow === "rainbond-fullstack-troubleshooter") {
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
            if ((result.selectedWorkflow === "rainbond-fullstack-bootstrap" ||
                result.selectedWorkflow === "rainbond-delivery-verifier" ||
                result.selectedWorkflow === "rainbond-fullstack-troubleshooter") &&
                actor.enterpriseId) {
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
                const components = await client.callTool("rainbond_query_components", componentInput);
                await this.publishToolTrace(actor.tenantId, sessionId, runId, 7, {
                    tool_name: "rainbond_query_components",
                    input: componentInput,
                    output: components,
                });
                const componentItems = components.structuredContent &&
                    Array.isArray(components.structuredContent.items)
                    ? components.structuredContent.items
                    : [];
                if (result.selectedWorkflow === "rainbond-fullstack-bootstrap" &&
                    componentItems.length === 0) {
                    if (!parseHelmCreationIntent(message)) {
                        logWorkflowDebug("workflow.shallow_exit", {
                            selectedWorkflow: result.selectedWorkflow,
                            reason: "bootstrap.no_components",
                            toolCalls: [
                                "rainbond_get_app_detail",
                                "rainbond_query_components",
                            ],
                            subflowData: {
                                appStatus: output.structuredContent &&
                                    output.structuredContent.status
                                    ? output.structuredContent.status
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
                                appStatus: output.structuredContent &&
                                    output.structuredContent.status
                                    ? output.structuredContent.status
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
                                appStatus: output.structuredContent &&
                                    output.structuredContent.status
                                    ? output.structuredContent.status
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
                    const summary = await client.callTool("rainbond_get_component_summary", summaryInput);
                    await this.publishToolTrace(actor.tenantId, sessionId, runId, 9, {
                        tool_name: "rainbond_get_component_summary",
                        input: summaryInput,
                        output: summary,
                    });
                    const summaryMapWithSummary = {
                        "rainbond-delivery-verifier": "已读取应用、组件及关键组件摘要，下一步可继续判断运行态、关键组件和访问路径。",
                        "rainbond-fullstack-troubleshooter": "已读取应用、组件及关键组件摘要，下一步可继续进入低风险排障流程。",
                        "rainbond-fullstack-bootstrap": "已读取应用、组件及关键组件摘要，下一步可继续进入拓扑创建、组件复用和部署流程。",
                    };
                    if (result.selectedWorkflow === "rainbond-fullstack-troubleshooter" &&
                        /数据库|db|postgres|mysql/i.test(message)) {
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
                        const logsOutput = await client.callTool("rainbond_get_component_logs", logsInput);
                        await this.publishToolTrace(actor.tenantId, sessionId, runId, 11, {
                            tool_name: "rainbond_get_component_logs",
                            input: logsInput,
                            output: logsOutput,
                        });
                        const logs = extractLogTexts(logsOutput.structuredContent);
                        const dbComponent = findDatabaseLikeComponent(componentItems, String(firstComponent.service_id));
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
                                    appStatus: output.structuredContent &&
                                        output.structuredContent.status
                                        ? output.structuredContent.status
                                        : undefined,
                                    ...buildComponentIdentitySubflowData(firstComponent),
                                    componentCount: componentItems.length,
                                    inspectedComponentStatus: summary.structuredContent &&
                                        summary.structuredContent.status
                                        ? summary.structuredContent.status.status
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
                                    appStatus: output.structuredContent &&
                                        output.structuredContent.status
                                        ? output.structuredContent.status
                                        : undefined,
                                    ...buildComponentIdentitySubflowData(firstComponent),
                                    componentCount: componentItems.length,
                                    inspectedComponentStatus: summary.structuredContent &&
                                        summary.structuredContent.status
                                        ? summary.structuredContent.status.status
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
                                    appStatus: output.structuredContent &&
                                        output.structuredContent.status
                                        ? output.structuredContent.status
                                        : undefined,
                                    ...buildComponentIdentitySubflowData(firstComponent),
                                    componentCount: componentItems.length,
                                    inspectedComponentStatus: summary.structuredContent &&
                                        summary.structuredContent.status
                                        ? summary.structuredContent.status.status
                                        : undefined,
                                },
                            };
                        }
                    }
                    return {
                        summary: summaryMapWithSummary[result.selectedWorkflow] || "",
                        toolCalls: [
                            { name: "rainbond_get_app_detail", status: "success" },
                            { name: "rainbond_query_components", status: "success" },
                            { name: "rainbond_get_component_summary", status: "success" },
                        ],
                        lastSequence: 9,
                        subflowData: {
                            appStatus: output.structuredContent &&
                                output.structuredContent.status
                                ? output.structuredContent.status
                                : undefined,
                            ...buildComponentIdentitySubflowData(firstComponent),
                            componentCount: componentItems.length,
                            inspectedComponentStatus: summary.structuredContent &&
                                summary.structuredContent.status
                                ? summary.structuredContent.status.status
                                : undefined,
                            runtimeState: summary.structuredContent &&
                                summary.structuredContent.status &&
                                summary.structuredContent.status.status === "abnormal"
                                ? "runtime_unhealthy"
                                : summary.structuredContent &&
                                    summary.structuredContent.status &&
                                    summary.structuredContent.status.status === "running"
                                    ? "runtime_healthy"
                                    : undefined,
                            deliveryState: result.selectedWorkflow === "rainbond-delivery-verifier" &&
                                summary.structuredContent &&
                                summary.structuredContent.status &&
                                summary.structuredContent.status.status === "running"
                                ? "delivered-but-needs-manual-validation"
                                : undefined,
                            blockerHint: result.selectedWorkflow === "rainbond-fullstack-troubleshooter" &&
                                summary.structuredContent &&
                                summary.structuredContent.status &&
                                summary.structuredContent.status.status === "abnormal"
                                ? "runtime_unhealthy"
                                : undefined,
                        },
                    };
                }
                const summaryMapWithComponents = {
                    "rainbond-fullstack-bootstrap": "已读取应用与组件概况，下一步可继续进入拓扑创建、组件复用和部署流程。",
                    "rainbond-delivery-verifier": "已读取应用与组件概况，下一步可继续判断运行态、关键组件和访问路径。",
                    "rainbond-fullstack-troubleshooter": "已读取应用与组件概况，下一步可继续进入低风险排障流程。",
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
                    summary: summaryMapWithComponents[result.selectedWorkflow] || "",
                    toolCalls: [
                        { name: "rainbond_get_app_detail", status: "success" },
                        { name: "rainbond_query_components", status: "success" },
                    ],
                    lastSequence: 7,
                };
            }
            const summaryMap = {
                "rainbond-fullstack-bootstrap": "已读取当前应用详情，下一步可继续进入拓扑创建与最小可运行部署。",
                "rainbond-delivery-verifier": "已读取当前应用交付概况，下一步可继续判断运行态与访问路径。",
                "rainbond-fullstack-troubleshooter": "已读取当前应用运行概况，下一步可继续进入低风险排障流程。",
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
    async executeWorkflowContinuation(params, session, run) {
        const continuation = session.pendingWorkflowContinuation;
        if (!continuation || !this.deps.workflowToolClientFactory) {
            return false;
        }
        switch (continuation.selectedWorkflow) {
            case "rainbond-fullstack-troubleshooter":
                // Troubleshooter continuations now flow through the LLM executor
                // (with the SKILL.md narrative injected as system prompt context),
                // which decides whether to invoke compiled-executor or call MCP
                // tools directly. The legacy hardcoded inspect-runtime loop has
                // been removed.
                return false;
            case "rainbond-delivery-verifier":
                return this.executeDeliveryVerifierContinuation(params, session, run, continuation);
            case "rainbond-app-version-assistant":
                return this.executeAppVersionContinuation(params, session, run, continuation);
            default:
                return false;
        }
    }
    async executeDeliveryVerifierContinuation(params, session, run, continuation) {
        if (!this.deps.workflowToolClientFactory) {
            return false;
        }
        const teamName = (typeof session.context?.team_name === "string" && session.context.team_name) ||
            (typeof session.context?.teamName === "string" && session.context.teamName) ||
            params.actor.tenantName ||
            params.actor.tenantId;
        const regionName = (typeof session.context?.region_name === "string" && session.context.region_name) ||
            (typeof session.context?.regionName === "string" && session.context.regionName) ||
            params.actor.regionName ||
            "";
        const appId = parseAppId((typeof session.context?.app_id === "string" && session.context.app_id) ||
            (typeof session.context?.appId === "string" && session.context.appId) ||
            "");
        const enterpriseId = (typeof session.context?.enterprise_id === "string" &&
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
        const componentOutput = await client.callTool("rainbond_query_components", componentInput);
        await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 7, {
            tool_name: "rainbond_query_components",
            input: componentInput,
            output: componentOutput,
        });
        const componentItems = componentOutput.structuredContent &&
            Array.isArray(componentOutput.structuredContent.items)
            ? componentOutput.structuredContent.items
            : [];
        const preferredCandidate = readStructuredString((continuation.subflowData || {}), "resolvedServiceId", "resolvedServiceAlias", "componentName") ||
            readStructuredString(componentItems[0], "service_id");
        const targetComponent = selectTroubleshooterTargetComponent(componentItems, preferredCandidate);
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
        const detailOutput = await client.callTool("rainbond_get_component_detail", detailInput);
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
        const logsOutput = await client.callTool("rainbond_get_component_logs", logsInput);
        await this.publishToolTrace(params.actor.tenantId, params.sessionId, params.runId, 11, {
            tool_name: "rainbond_get_component_logs",
            input: logsInput,
            output: logsOutput,
        });
        const logItems = logsOutput.structuredContent &&
            Array.isArray(logsOutput.structuredContent.items)
            ? logsOutput.structuredContent.items
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
    async executeAppVersionContinuation(params, session, run, continuation) {
        if (!this.deps.workflowToolClientFactory) {
            return false;
        }
        const teamName = (typeof session.context?.team_name === "string" && session.context.team_name) ||
            (typeof session.context?.teamName === "string" && session.context.teamName) ||
            params.actor.tenantName ||
            params.actor.tenantId;
        const regionName = (typeof session.context?.region_name === "string" && session.context.region_name) ||
            (typeof session.context?.regionName === "string" && session.context.regionName) ||
            params.actor.regionName ||
            "";
        const appId = parseAppId((typeof session.context?.app_id === "string" && session.context.app_id) ||
            (typeof session.context?.appId === "string" && session.context.appId) ||
            "");
        if (!teamName || !regionName || !appId) {
            return false;
        }
        const currentVersion = readStructuredString((continuation.subflowData || {}), "currentVersion");
        const latestSnapshotVersion = readStructuredString((continuation.subflowData || {}), "latestSnapshotVersion");
        const nextSnapshotVersion = suggestNextSnapshotVersion(latestSnapshotVersion || currentVersion);
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
    async executePendingWorkflowAction(params, session) {
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
    async publishToolTrace(tenantId, sessionId, runId, sequence, data) {
        const traceSequenceBase = data && typeof data.output !== "undefined" ? sequence - 1 : sequence;
        const tracePayload = {
            ...data,
            trace_id: typeof data.trace_id === "string" && data.trace_id
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
