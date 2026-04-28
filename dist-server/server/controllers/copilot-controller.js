import { PersistedEventPublisher } from "../events/persisted-event-publisher.js";
import { createSseBroker } from "../events/sse-broker.js";
import { copilotRoutes } from "../routes/copilot-routes.js";
import { createServerId } from "../utils/id.js";
import { createInMemoryRunResumer, } from "../runtime/run-resumer.js";
import { createRunExecutionState, } from "../runtime/run-execution-state.js";
import { ServerLlmExecutor } from "../runtime/server-llm-executor.js";
import { ServerRunExecutor } from "../runtime/server-run-executor.js";
import { CopilotApprovalService } from "../services/copilot-approval-service.js";
import { createInMemoryApprovalStore, } from "../stores/approval-store.js";
import { createInMemoryEventStore } from "../stores/event-store.js";
import { createInMemoryRunStore, cloneRunExecutionState, } from "../stores/run-store.js";
import { cloneChatMessages, createInMemorySessionStore, deriveCompletedToolCallIds, toPendingWorkflowActionFromRunApproval, toRunPendingApproval, } from "../stores/session-store.js";
import { CopilotSessionService, } from "../services/copilot-session-service.js";
import { CopilotRunService } from "../services/copilot-run-service.js";
import { createServerActionSkills } from "../runtime/server-action-skills.js";
import { WorkflowExecutor } from "../workflows/executor.js";
import { isContinueWorkflowActionPrompt, isWorkflowContinuationReferencePrompt, } from "../workflows/executor.js";
import { logWorkflowDebug } from "../workflows/workflow-debug.js";
import { buildPendingWorkflowActionCompletion } from "../workflows/pending-action-result.js";
import { getMutableToolPolicy } from "../integrations/rainbond-mcp/mutable-tool-policy.js";
function readContextString(context, ...keys) {
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
function readContextInt(context, ...keys) {
    const raw = readContextString(context, ...keys);
    if (!raw) {
        return 0;
    }
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : 0;
}
function readContextAppId(context, ...keys) {
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
function parseSnapshotRollbackVersion(message) {
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
function parseSnapshotCreateVersionInput(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return "";
    }
    const matched = normalized.match(/\b(v?\d+\.\d+(?:\.\d+)?)\b/i);
    return matched && matched[1] ? matched[1] : "";
}
function buildWorkflowContinuationPrompt(continuation, userMessage) {
    const lines = [
        "请基于以下刚刚完成的 Rainbond 工作流结果继续，不要说缺少前文上下文。",
        `- workflow_id: ${continuation.workflowId}`,
        continuation.selectedWorkflow
            ? `- selected_workflow: ${continuation.selectedWorkflow}`
            : "",
        continuation.nextAction ? `- next_action: ${continuation.nextAction}` : "",
        `- summary: ${continuation.summary}`,
        continuation.subflowData
            ? `- subflow_data: ${JSON.stringify(continuation.subflowData)}`
            : "",
        continuation.toolCalls && continuation.toolCalls.length > 0
            ? `- tool_calls: ${JSON.stringify(continuation.toolCalls)}`
            : "",
        `用户刚刚的继续请求：${userMessage || "继续"}`,
        "请沿着同一个 Rainbond workflow 继续下一步诊断、校验或动作推进。",
    ].filter(Boolean);
    return lines.join("\n");
}
function findSuggestedWorkflowAction(continuation, message) {
    if (!continuation || !Array.isArray(continuation.suggestedActions)) {
        return null;
    }
    const suggestions = continuation.suggestedActions;
    if (suggestions.length === 0) {
        return null;
    }
    const normalized = (message || "").trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    const optionMatch = normalized.match(/方案\s*([a-z0-9一二三四]+)/i);
    if (optionMatch && optionMatch[1]) {
        const selectedKey = optionMatch[1].toUpperCase();
        const matchedByKey = suggestions.find((item) => (item.optionKey || "").toUpperCase() === selectedKey);
        if (matchedByKey) {
            return matchedByKey;
        }
    }
    const matchedByLabel = suggestions.find((item) => {
        const label = (item.label || "").trim().toLowerCase();
        return !!label && normalized.includes(label);
    });
    if (matchedByLabel) {
        return matchedByLabel;
    }
    if (isWorkflowContinuationReferencePrompt(message)) {
        return (suggestions.find((item) => item.recommended) ||
            suggestions[0] ||
            null);
    }
    return null;
}
function requestsRollbackToPreviousSnapshot(message) {
    const normalized = (message || "").trim();
    if (!normalized || !/(回滚|rollback)/i.test(normalized)) {
        return false;
    }
    return /(上一个版本|上个版本|上一版本|前一个版本|上一个快照|上个快照|上一快照|previous version|previous snapshot)/i.test(normalized);
}
function requestsCloseWholeApp(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return /(关闭整个应用|关闭当前应用|关闭应用|停止整个应用|停止当前应用|停止应用|close.*app|stop.*app)/i.test(normalized);
}
function findPreviousSnapshotVersionId(payload) {
    if (!payload || !Array.isArray(payload.items)) {
        return 0;
    }
    const items = payload.items;
    if (items.length < 2) {
        return 0;
    }
    return readContextInt(items[1], "version_id", "ID", "id");
}
function findPreviousSnapshotVersion(payload) {
    if (!payload || !Array.isArray(payload.items)) {
        return "";
    }
    const items = payload.items;
    if (items.length < 2) {
        return "";
    }
    return readContextString(items[1], "version", "share_version", "snapshot_version");
}
async function hydrateVerticalScaleArguments(client, arguments_) {
    if (typeof arguments_.new_gpu === "number" ||
        typeof arguments_.team_name !== "string" ||
        typeof arguments_.region_name !== "string" ||
        typeof arguments_.service_id !== "string") {
        return arguments_;
    }
    try {
        const summary = await client.callTool("rainbond_get_component_summary", {
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
    }
    catch {
        return {
            ...arguments_,
            new_gpu: 0,
        };
    }
}
function findSnapshotVersionId(payload, targetVersion) {
    if (!payload || !Array.isArray(payload.items) || !targetVersion) {
        return 0;
    }
    const normalizedTarget = String(targetVersion).trim();
    const matched = payload.items.find((item) => {
        const version = readContextString(item, "version", "share_version", "snapshot_version");
        return version === normalizedTarget;
    });
    if (!matched) {
        return 0;
    }
    return readContextInt(matched, "version_id", "ID", "id");
}
export function createCopilotController(deps = {}) {
    const enableLegacyActionSkills = deps.enableLegacyActionSkills !== false;
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
        runStore,
        workflowToolClientFactory: deps.workflowToolClientFactory,
        enableRainbondAppAssistantWorkflow: deps.enableRainbondAppAssistantWorkflow,
        skillRouter: deps.skillRouter,
        workflowSummarizer: deps.workflowSummarizer,
    });
    const approvalService = new CopilotApprovalService({
        approvalStore,
        runStore,
        sessionStore,
        eventPublisher,
        broker,
        runResumer,
    });
    const resolveActionAdapter = async (params) => {
        if (deps.actionAdapterFactory) {
            return deps.actionAdapterFactory(params);
        }
        return deps.actionAdapter;
    };
    const resolvePendingMcpClient = async (params) => {
        const factory = deps.queryToolClientFactory ?? deps.workflowToolClientFactory;
        if (!factory) {
            throw new Error("MCP tool client factory is required");
        }
        return factory(params);
    };
    const nextRunSequence = async (tenantId, runId) => {
        const events = await broker.replay(runId, tenantId, {
            afterSequence: 0,
        });
        return events.length + 1;
    };
    const createLlmExecutor = async (params) => {
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
    const serializeToolResultForContinuation = (params) => {
        if (params.pendingAction.kind === "action_skill") {
            return JSON.stringify(params.output.structuredContent || {});
        }
        return JSON.stringify({
            isError: params.output.isError,
            structuredContent: params.output.structuredContent || {},
        });
    };
    const buildRunExecutionState = (params) => {
        const state = cloneRunExecutionState(params.existingState) ??
            createRunExecutionState({
                runId: params.runId,
                sessionId: params.sessionId,
                tenantId: params.tenantId,
                initialMessage: params.messageText,
            });
        if (params.continuation) {
            state.messages = cloneChatMessages(params.continuation.messages);
            state.iteration = params.continuation.iteration;
            state.completedToolCallIds = deriveCompletedToolCallIds(state.messages);
        }
        if (params.pendingAction) {
            state.pendingApprovals = [toRunPendingApproval(params.pendingAction)];
        }
        state.nextStep = { type: "interruption" };
        state.status = "waiting_approval";
        state.finalOutput = null;
        return state;
    };
    const toExecutionStateContinuation = (state) => ({
        iteration: state.iteration,
        messages: cloneChatMessages(state.messages),
    });
    const shouldResumeRunLoop = (state) => state.messages.some((message) => message.role === "assistant" &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0);
    const executePendingAction = async (params) => {
        let currentRun = await runStore.getById(params.runId, params.actor.tenantId);
        if (!currentRun) {
            throw new Error("Run not found");
        }
        let currentSession = await sessionService.getSession(params.sessionId, {
            tenantId: params.actor.tenantId,
            userId: params.actor.userId,
        });
        let currentExecutionState = buildRunExecutionState({
            runId: params.runId,
            sessionId: params.sessionId,
            tenantId: params.actor.tenantId,
            messageText: currentRun.messageText,
            continuation: currentSession.pendingLlmContinuation,
            pendingAction: currentSession.pendingWorkflowAction,
            existingState: currentRun.executionState,
        });
        let pendingAction = currentExecutionState.pendingApprovals[0]
            ? toPendingWorkflowActionFromRunApproval(currentExecutionState.pendingApprovals[0])
            : currentSession.pendingWorkflowAction;
        if (!pendingAction) {
            throw new Error("Pending workflow action not found");
        }
        const completedEvents = await broker.replay(params.runId, params.actor.tenantId, { afterSequence: 0 });
        let nextSequence = completedEvents.length + 1;
        const completedSummaries = [];
        const executedToolCalls = [];
        while (pendingAction) {
            let traceToolName = pendingAction.toolName;
            let output;
            const traceId = createServerId("trace");
            await eventPublisher.publish({
                type: "chat.trace",
                tenantId: params.actor.tenantId,
                sessionId: params.sessionId,
                runId: params.runId,
                sequence: nextSequence,
                data: {
                    trace_id: traceId,
                    tool_call_id: pendingAction.toolCallId,
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
                    const actionResult = (await skill.execute(pendingAction.arguments));
                    output = {
                        isError: false,
                        structuredContent: actionResult,
                        content: [],
                    };
                }
                else {
                    const client = await resolvePendingMcpClient({
                        actor: params.actor,
                        sessionId: params.sessionId,
                    });
                    const pendingArguments = pendingAction.toolName === "rainbond_vertical_scale_component"
                        ? await hydrateVerticalScaleArguments(client, pendingAction.arguments)
                        : pendingAction.arguments;
                    output = await client.callTool(pendingAction.toolName, pendingArguments);
                    pendingAction.arguments = pendingArguments;
                }
            }
            catch (error) {
                const errorMessage = error && typeof error.message === "string" && error.message
                    ? error.message
                    : "执行过程中发生错误，请稍后重试。";
                await sessionStore.update({
                    ...currentSession,
                    pendingWorkflowAction: undefined,
                    pendingLlmContinuation: undefined,
                });
                currentExecutionState.nextStep = { type: "failed" };
                currentExecutionState.status = "failed";
                currentExecutionState.finalOutput = errorMessage;
                currentExecutionState.pendingApprovals = [];
                await runStore.update({
                    ...currentRun,
                    executionState: currentExecutionState,
                    status: "failed",
                    errorMessage,
                    finishedAt: new Date().toISOString(),
                });
                runResumer.unregister(params.actor.tenantId, params.runId);
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
                    trace_id: traceId,
                    tool_call_id: pendingAction.toolCallId,
                    tool_name: traceToolName,
                    input: pendingAction.arguments,
                    output,
                },
            });
            nextSequence += 1;
            const completion = buildPendingWorkflowActionCompletion(pendingAction, output);
            completedSummaries.push(completion.summary);
            executedToolCalls.push({
                name: pendingAction.toolName,
                status: output.isError ? "error" : "success",
            });
            if (pendingAction.toolCallId) {
                currentExecutionState.messages.push({
                    role: "tool",
                    content: serializeToolResultForContinuation({
                        pendingAction,
                        output,
                    }),
                    name: pendingAction.toolName,
                    tool_call_id: pendingAction.toolCallId,
                });
                if (!currentExecutionState.completedToolCallIds.includes(pendingAction.toolCallId)) {
                    currentExecutionState.completedToolCallIds.push(pendingAction.toolCallId);
                }
            }
            currentExecutionState.pendingApprovals = [];
            currentExecutionState.nextStep = { type: "run_again" };
            currentExecutionState.status = "running";
            currentExecutionState.finalOutput = null;
            const nextPendingLlmContinuation = currentExecutionState.messages.length > 0
                ? toExecutionStateContinuation(currentExecutionState)
                : undefined;
            const nextPendingAction = pendingAction.followUpActions?.[0]
                ? {
                    ...pendingAction.followUpActions[0],
                    followUpActions: pendingAction.followUpActions.slice(1).length > 0
                        ? pendingAction.followUpActions.slice(1)
                        : undefined,
                }
                : undefined;
            if (nextPendingAction?.requiresApproval) {
                currentExecutionState.pendingApprovals = [
                    toRunPendingApproval(nextPendingAction),
                ];
                currentExecutionState.nextStep = { type: "interruption" };
                currentExecutionState.status = "waiting_approval";
                await sessionStore.update({
                    ...currentSession,
                    pendingWorkflowAction: nextPendingAction,
                    pendingLlmContinuation: nextPendingLlmContinuation,
                });
                await runStore.update({
                    ...currentRun,
                    executionState: currentExecutionState,
                });
                currentRun = {
                    ...currentRun,
                    executionState: currentExecutionState,
                };
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
                runResumer.register(params.actor.tenantId, params.runId, async ({ runId }) => {
                    await executePendingAction({
                        actor: params.actor,
                        sessionId: params.sessionId,
                        runId,
                    });
                });
                await approvalService.createPendingApproval({
                    actor: params.actor,
                    sessionId: params.sessionId,
                    runId: params.runId,
                    skillId: nextPendingAction.toolName,
                    description: nextPendingAction.description ||
                        `执行 ${nextPendingAction.toolName}`,
                    risk: nextPendingAction.risk || "high",
                    scope: nextPendingAction.scope,
                });
                return;
            }
            if (!nextPendingAction) {
                if (nextPendingLlmContinuation &&
                    currentExecutionState.nextStep.type === "run_again" &&
                    shouldResumeRunLoop(currentExecutionState)) {
                    await sessionStore.update({
                        ...currentSession,
                        pendingWorkflowAction: undefined,
                        pendingLlmContinuation: undefined,
                    });
                    await runStore.update({
                        ...currentRun,
                        executionState: currentExecutionState,
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
                        currentSkillId: currentSession.pendingWorkflowContinuation?.selectedWorkflow,
                        continuation: {
                            iteration: currentExecutionState.iteration,
                            messages: currentExecutionState.messages,
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
                currentExecutionState.pendingApprovals = [];
                currentExecutionState.nextStep = { type: "final_output" };
                currentExecutionState.status = "completed";
                currentExecutionState.finalOutput = completedSummaries.join("\n");
                await runStore.update({
                    ...currentRun,
                    executionState: currentExecutionState,
                    status: "completed",
                    finishedAt: new Date().toISOString(),
                });
                runResumer.unregister(params.actor.tenantId, params.runId);
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
            currentExecutionState.pendingApprovals = [];
            pendingAction = nextPendingAction;
        }
    };
    const queuePendingActionApproval = async (params) => {
        const currentRun = await runStore.getById(params.runId, params.actor.tenantId);
        if (!currentRun) {
            throw new Error("Run not found");
        }
        const currentSession = await sessionService.getSession(params.sessionId, {
            tenantId: params.actor.tenantId,
            userId: params.actor.userId,
        });
        const normalizedPendingAction = {
            kind: params.pendingAction.kind || "mcp_tool",
            toolName: params.pendingAction.toolName,
            toolCallId: params.pendingAction.toolCallId,
            requiresApproval: true,
            risk: params.pendingAction.risk || params.risk,
            scope: params.pendingAction.scope ||
                getMutableToolPolicy(params.pendingAction.toolName)?.scope,
            description: params.pendingAction.description || params.description,
            arguments: params.pendingAction.arguments,
            followUpActions: params.pendingAction.followUpActions,
        };
        const nextExecutionState = buildRunExecutionState({
            runId: params.runId,
            sessionId: params.sessionId,
            tenantId: params.actor.tenantId,
            messageText: currentRun.messageText,
            continuation: params.continuation,
            pendingAction: normalizedPendingAction,
            existingState: currentRun.executionState,
        });
        await sessionStore.update({
            ...currentSession,
            pendingWorkflowAction: normalizedPendingAction,
            pendingLlmContinuation: params.continuation,
        });
        await runStore.update({
            ...currentRun,
            executionState: nextExecutionState,
        });
        runResumer.register(params.actor.tenantId, params.runId, async ({ runId }) => {
            await executePendingAction({
                actor: params.actor,
                sessionId: params.sessionId,
                runId,
            });
        });
        await approvalService.createPendingApproval({
            actor: params.actor,
            sessionId: params.sessionId,
            runId: params.runId,
            skillId: normalizedPendingAction.toolName,
            description: normalizedPendingAction.description ||
                `执行 ${normalizedPendingAction.toolName}`,
            risk: normalizedPendingAction.risk || params.risk,
            scope: normalizedPendingAction.scope,
        });
    };
    const executeLegacyPlannedRun = async (params) => {
        const runExecutor = new ServerRunExecutor({
            broker,
            eventPublisher,
            actionAdapter: params.actionAdapter,
        });
        const plan = runExecutor.plan(params.message);
        if (plan.requiresApproval) {
            await queuePendingActionApproval({
                actor: params.actor,
                sessionId: params.sessionId,
                runId: params.runId,
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
            return;
        }
        if (params.actionAdapter) {
            await runExecutor.executeLowRisk({
                actor: params.actor,
                sessionId: params.sessionId,
                runId: params.runId,
                message: params.message,
            });
            return;
        }
        const fallbackEvents = await broker.replay(params.runId, params.actor.tenantId, {
            afterSequence: 0,
        });
        let nextSequence = fallbackEvents.length + 1;
        await eventPublisher.publish({
            type: "chat.message",
            tenantId: params.actor.tenantId,
            sessionId: params.sessionId,
            runId: params.runId,
            sequence: nextSequence,
            data: {
                role: "assistant",
                content: "当前没有可用的规则型执行适配器，请补充更明确的目标对象，或配置 LLM / MCP 工具后重试。",
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
    };
    return {
        async createSession(request) {
            const session = await sessionService.createSession({
                actor: request.actor,
                context: request.body?.context,
            });
            return {
                data: {
                    session_id: session.sessionId,
                    tenant_id: session.tenantId,
                    created_at: session.createdAt,
                    status: session.status,
                },
            };
        },
        async getSession(request) {
            const session = await sessionService.getSession(request.params.sessionId, {
                tenantId: request.actor.tenantId,
                userId: request.actor.userId,
            });
            const pendingApprovals = await approvalStore.listPendingBySession(request.params.sessionId, request.actor.tenantId);
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
        async createMessageRun(request) {
            if (request.body.context && Object.keys(request.body.context).length > 0) {
                await sessionService.updateSessionContext(request.params.sessionId, {
                    tenantId: request.actor.tenantId,
                    userId: request.actor.userId,
                    tenantName: request.actor.tenantName,
                }, request.body.context);
            }
            const previousSession = await sessionService.getSession(request.params.sessionId, {
                tenantId: request.actor.tenantId,
                userId: request.actor.userId,
            });
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
            const response = {
                data: {
                    run_id: run.runId,
                    session_id: run.sessionId,
                    stream_url: copilotRoutes.streamRunEvents(request.params.sessionId, run.runId),
                },
            };
            const failRunInBackground = async (error) => {
                const currentRun = await runStore.getById(run.runId, request.actor.tenantId);
                if (!currentRun ||
                    currentRun.status === "completed" ||
                    currentRun.status === "failed" ||
                    currentRun.status === "cancelled") {
                    return;
                }
                await runStore.update({
                    ...currentRun,
                    status: "failed",
                    errorMessage: error instanceof Error ? error.message : "Copilot run failed",
                    finishedAt: new Date().toISOString(),
                });
                const nextSequence = await nextRunSequence(request.actor.tenantId, run.runId);
                await eventPublisher.publish({
                    type: "run.error",
                    tenantId: request.actor.tenantId,
                    sessionId: request.params.sessionId,
                    runId: run.runId,
                    sequence: nextSequence,
                    data: {
                        message: error instanceof Error ? error.message : "Copilot run failed",
                    },
                });
                await eventPublisher.publish({
                    type: "run.status",
                    tenantId: request.actor.tenantId,
                    sessionId: request.params.sessionId,
                    runId: run.runId,
                    sequence: nextSequence + 1,
                    data: {
                        status: "error",
                    },
                });
            };
            const executeRunInBackground = async () => {
                const session = await sessionService.getSession(request.params.sessionId, {
                    tenantId: request.actor.tenantId,
                    userId: request.actor.userId,
                });
                const previousRun = previousSession.latestRunId
                    ? await runStore.getById(previousSession.latestRunId, request.actor.tenantId)
                    : null;
                const deferredAction = previousRun?.executionState?.deferredAction;
                const clearDeferredAction = async () => {
                    if (!previousRun?.executionState) {
                        return;
                    }
                    await runStore.update({
                        ...previousRun,
                        executionState: {
                            ...previousRun.executionState,
                            deferredAction: null,
                        },
                    });
                };
                if (session.pendingWorkflowAction &&
                    session.pendingWorkflowAction.requiresApproval &&
                    isContinueWorkflowActionPrompt(request.body.message)) {
                    await queuePendingActionApproval({
                        actor: request.actor,
                        sessionId: request.params.sessionId,
                        runId: run.runId,
                        pendingAction: session.pendingWorkflowAction,
                        continuation: session.pendingLlmContinuation,
                        description: session.pendingWorkflowAction.description ||
                            `执行 ${session.pendingWorkflowAction.toolName}`,
                        risk: session.pendingWorkflowAction.risk || "high",
                    });
                    return;
                }
                const pendingSnapshotVersion = parseSnapshotCreateVersionInput(request.body.message);
                const suggestedWorkflowAction = findSuggestedWorkflowAction(session.pendingWorkflowContinuation, request.body.message);
                logWorkflowDebug("workflow.suggested_action.match", {
                    message: request.body.message,
                    hasContinuation: !!session.pendingWorkflowContinuation,
                    suggestedActionCount: session.pendingWorkflowContinuation?.suggestedActions?.length || 0,
                    matchedAction: suggestedWorkflowAction
                        ? {
                            optionKey: suggestedWorkflowAction.optionKey,
                            label: suggestedWorkflowAction.label,
                            toolName: suggestedWorkflowAction.pendingAction.toolName,
                            requiresApproval: suggestedWorkflowAction.pendingAction.requiresApproval,
                        }
                        : null,
                });
                if (!session.pendingWorkflowAction &&
                    suggestedWorkflowAction) {
                    const selectedPendingAction = suggestedWorkflowAction.pendingAction;
                    await sessionStore.update({
                        ...session,
                        pendingWorkflowAction: selectedPendingAction,
                        pendingWorkflowContinuation: undefined,
                    });
                    if (selectedPendingAction.requiresApproval) {
                        await queuePendingActionApproval({
                            actor: request.actor,
                            sessionId: request.params.sessionId,
                            runId: run.runId,
                            pendingAction: selectedPendingAction,
                            continuation: session.pendingLlmContinuation,
                            description: selectedPendingAction.description ||
                                suggestedWorkflowAction.description,
                            risk: selectedPendingAction.risk || "medium",
                        });
                        return;
                    }
                    const handledByWorkflow = await workflowExecutor.execute({
                        actor: request.actor,
                        sessionId: request.params.sessionId,
                        runId: run.runId,
                        message: "继续执行",
                    });
                    if (handledByWorkflow) {
                        return;
                    }
                }
                if (session.pendingWorkflowAction &&
                    deferredAction &&
                    session.pendingWorkflowAction.toolName === deferredAction.toolName &&
                    pendingSnapshotVersion) {
                    if (deferredAction.toolName === "rainbond_create_app_version_snapshot" &&
                        deferredAction.missingArgument === "version" &&
                        !deferredAction.requiresApproval) {
                        const nextArguments = {
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
                        await clearDeferredAction();
                        const handledByWorkflow = await workflowExecutor.execute({
                            actor: request.actor,
                            sessionId: request.params.sessionId,
                            runId: run.runId,
                            message: "继续执行",
                        });
                        if (handledByWorkflow) {
                            return;
                        }
                    }
                    if (deferredAction.toolName === "rainbond_install_app_model" &&
                        deferredAction.missingArgument === "app_model_version") {
                        const nextArguments = {
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
                        await clearDeferredAction();
                        await queuePendingActionApproval({
                            actor: request.actor,
                            sessionId: request.params.sessionId,
                            runId: run.runId,
                            pendingAction: {
                                ...session.pendingWorkflowAction,
                                arguments: nextArguments,
                            },
                            description: session.pendingWorkflowAction.description ||
                                `执行 ${session.pendingWorkflowAction.toolName}`,
                            risk: session.pendingWorkflowAction.risk || "high",
                        });
                        return;
                    }
                    if (deferredAction.toolName === "rainbond_rollback_app_version_snapshot" &&
                        deferredAction.missingArgument === "version_id" &&
                        deferredAction.resolutionTool) {
                        const client = await resolvePendingMcpClient({
                            actor: request.actor,
                            sessionId: request.params.sessionId,
                        });
                        const snapshotListResult = await client.callTool(deferredAction.resolutionTool.toolName, deferredAction.resolutionTool.arguments);
                        const versionId = findSnapshotVersionId((snapshotListResult.structuredContent || {}), pendingSnapshotVersion);
                        if (versionId > 0) {
                            const nextArguments = {
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
                            await clearDeferredAction();
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
                            return;
                        }
                    }
                }
                if (!deferredAction &&
                    session.pendingWorkflowAction &&
                    !session.pendingWorkflowAction.requiresApproval &&
                    session.pendingWorkflowAction.toolName === "rainbond_create_app_version_snapshot" &&
                    session.pendingWorkflowAction.arguments &&
                    session.pendingWorkflowAction.arguments.__await_version_input === true &&
                    pendingSnapshotVersion) {
                    const nextArguments = {
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
                        return;
                    }
                }
                if (!deferredAction &&
                    session.pendingWorkflowAction &&
                    session.pendingWorkflowAction.arguments &&
                    session.pendingWorkflowAction.arguments.__await_version_input === true &&
                    pendingSnapshotVersion) {
                    if (session.pendingWorkflowAction.toolName === "rainbond_install_app_model") {
                        const nextArguments = {
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
                            description: session.pendingWorkflowAction.description ||
                                `执行 ${session.pendingWorkflowAction.toolName}`,
                            risk: session.pendingWorkflowAction.risk || "high",
                        });
                        return;
                    }
                    if (session.pendingWorkflowAction.toolName ===
                        "rainbond_rollback_app_version_snapshot") {
                        const teamName = readContextString(session.context, "teamName", "team_name") ||
                            request.actor.tenantName ||
                            request.actor.tenantId;
                        const regionName = readContextString(session.context, "regionName", "region_name") ||
                            request.actor.regionName ||
                            "";
                        const appId = readContextAppId(session.context, "appId", "app_id");
                        if (teamName && regionName && appId) {
                            const client = await resolvePendingMcpClient({
                                actor: request.actor,
                                sessionId: request.params.sessionId,
                            });
                            const snapshotListResult = await client.callTool("rainbond_list_app_version_snapshots", {
                                team_name: teamName,
                                region_name: regionName,
                                app_id: appId,
                            });
                            const versionId = findSnapshotVersionId((snapshotListResult.structuredContent || {}), pendingSnapshotVersion);
                            if (versionId > 0) {
                                const nextArguments = {
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
                                return;
                            }
                        }
                    }
                }
                const targetSnapshotVersion = parseSnapshotRollbackVersion(request.body.message);
                const rollbackToPreviousSnapshot = requestsRollbackToPreviousSnapshot(request.body.message);
                if (targetSnapshotVersion || rollbackToPreviousSnapshot) {
                    const teamName = readContextString(session.context, "teamName", "team_name") ||
                        request.actor.tenantName ||
                        request.actor.tenantId;
                    const regionName = readContextString(session.context, "regionName", "region_name") ||
                        request.actor.regionName ||
                        "";
                    const appId = readContextAppId(session.context, "appId", "app_id");
                    if (teamName && regionName && appId) {
                        const client = await resolvePendingMcpClient({
                            actor: request.actor,
                            sessionId: request.params.sessionId,
                        });
                        const snapshotListResult = await client.callTool("rainbond_list_app_version_snapshots", {
                            team_name: teamName,
                            region_name: regionName,
                            app_id: appId,
                        });
                        const snapshotPayload = (snapshotListResult.structuredContent ||
                            {});
                        const versionId = targetSnapshotVersion
                            ? findSnapshotVersionId(snapshotPayload, targetSnapshotVersion)
                            : findPreviousSnapshotVersionId(snapshotPayload);
                        const resolvedVersion = targetSnapshotVersion || findPreviousSnapshotVersion(snapshotPayload);
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
                            return;
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
                    return;
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
                const llmMessage = isWorkflowContinuationReferencePrompt(request.body.message) &&
                    session.pendingWorkflowContinuation
                    ? buildWorkflowContinuationPrompt(session.pendingWorkflowContinuation, request.body.message)
                    : request.body.message;
                const preferLegacyPlanner = enableLegacyActionSkills && deps.llmClient === null;
                if (preferLegacyPlanner) {
                    await executeLegacyPlannedRun({
                        actor: request.actor,
                        sessionId: request.params.sessionId,
                        runId: run.runId,
                        message: request.body.message,
                        actionAdapter,
                    });
                    return;
                }
                const handledByLlm = await llmExecutor.execute({
                    actor: request.actor,
                    sessionId: request.params.sessionId,
                    runId: run.runId,
                    message: llmMessage,
                    sessionContext: session.context,
                    currentSkillId: session.pendingWorkflowContinuation?.selectedWorkflow,
                });
                if (!handledByLlm && enableLegacyActionSkills) {
                    await executeLegacyPlannedRun({
                        actor: request.actor,
                        sessionId: request.params.sessionId,
                        runId: run.runId,
                        message: request.body.message,
                        actionAdapter,
                    });
                    return;
                }
                if (!handledByLlm) {
                    const fallbackEvents = await broker.replay(run.runId, request.actor.tenantId, { afterSequence: 0 });
                    let nextSequence = fallbackEvents.length + 1;
                    await eventPublisher.publish({
                        type: "chat.message",
                        tenantId: request.actor.tenantId,
                        sessionId: request.params.sessionId,
                        runId: run.runId,
                        sequence: nextSequence,
                        data: {
                            role: "assistant",
                            content: "当前已禁用规则型快捷动作，且本次没有可执行的 MCP 工具调用，请补充更明确的目标对象或操作参数后重试。",
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
            };
            void executeRunInBackground().catch(async (error) => {
                await failRunInBackground(error);
            });
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
            return response;
        },
        async streamRunEvents(request) {
            const events = await broker.replay(request.params.runId, request.actor.tenantId, {
                afterSequence: Number(request.query?.after_sequence ?? 0),
            });
            return {
                contentType: "text/event-stream",
                events: events.map((event) => event.payload),
            };
        },
        async decideApproval(request) {
            const approval = await approvalService.decide(request.params.approvalId, {
                actor: request.actor,
                decision: request.body.decision,
                comment: request.body.comment,
            });
            if (approval.status === "rejected") {
                const session = await sessionStore.getById(approval.sessionId, request.actor.tenantId);
                const run = await runStore.getById(approval.runId, request.actor.tenantId);
                if (session &&
                    session.userId === request.actor.userId &&
                    session.pendingWorkflowAction?.toolName === approval.skillId) {
                    await sessionStore.update({
                        ...session,
                        pendingWorkflowAction: undefined,
                        pendingLlmContinuation: undefined,
                    });
                }
                if (run?.executionState) {
                    await runStore.update({
                        ...run,
                        executionState: {
                            ...run.executionState,
                            pendingApprovals: [],
                            nextStep: { type: "failed" },
                            status: "failed",
                            finalOutput: request.body.comment || "Approval rejected",
                        },
                    });
                }
                runResumer.unregister(request.actor.tenantId, approval.runId);
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
