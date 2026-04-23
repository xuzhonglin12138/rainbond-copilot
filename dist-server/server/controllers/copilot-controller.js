import { PersistedEventPublisher } from "../events/persisted-event-publisher.js";
import { createSseBroker } from "../events/sse-broker.js";
import { copilotRoutes } from "../routes/copilot-routes.js";
import { createInMemoryRunResumer, } from "../runtime/run-resumer.js";
import { ServerLlmExecutor } from "../runtime/server-llm-executor.js";
import { ServerRunExecutor } from "../runtime/server-run-executor.js";
import { CopilotApprovalService } from "../services/copilot-approval-service.js";
import { createInMemoryApprovalStore, } from "../stores/approval-store.js";
import { createInMemoryEventStore } from "../stores/event-store.js";
import { createInMemoryRunStore, } from "../stores/run-store.js";
import { createInMemorySessionStore, } from "../stores/session-store.js";
import { CopilotSessionService, } from "../services/copilot-session-service.js";
import { CopilotRunService } from "../services/copilot-run-service.js";
import { createServerActionSkills } from "../runtime/server-action-skills.js";
import { WorkflowExecutor } from "../workflows/executor.js";
import { isContinueWorkflowActionPrompt } from "../workflows/executor.js";
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
function isDeleteCurrentAppIntent(message, context) {
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
function readContextResourceType(context) {
    if (!context || typeof context.resource !== "object" || !context.resource) {
        return "";
    }
    const type = context.resource.type;
    return typeof type === "string" ? type.trim() : "";
}
function looksLikeMutationQuestion(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    if (/确认/.test(normalized)) {
        return false;
    }
    return (/[？?]$/.test(normalized) ||
        /(如何|怎么|为什么|是否|会不会|能否|可否|是什么)/i.test(normalized));
}
function parseMemoryScaleTarget(message) {
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
function parseImageTarget(message) {
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
function parsePortManagementIntent(message) {
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
function parseConnectionEnvIntent(message) {
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
function parseInnerEnvIntent(message) {
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
function requestsSnapshotCreation(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return /(创建.*快照|生成.*快照|create.*snapshot)/i.test(normalized);
}
function detectContextualMutationIntent(message, context) {
    const normalized = (message || "").trim();
    if (!normalized || looksLikeMutationQuestion(normalized)) {
        return null;
    }
    let action = null;
    if (/(删除|移除|remove|delete)/i.test(normalized)) {
        action = "delete";
    }
    else if (/(重启|restart|reboot)/i.test(normalized)) {
        action = "restart";
    }
    else if (/(关闭|停止|stop|shutdown)/i.test(normalized)) {
        action = "stop";
    }
    else if (/(启动|开启|start)/i.test(normalized)) {
        action = "start";
    }
    if (!action) {
        return null;
    }
    const resourceType = readContextResourceType(context);
    const hasComponentContext = !!readContextString(context, "componentId", "component_id");
    const hasAppContext = !!readContextInt(context, "appId", "app_id");
    const currentComponentCommand = /(确认关闭|确认启动|确认重启|确认删除|关闭当前组件|启动当前组件|重启当前组件|删除当前组件|关闭组件|启动组件|重启组件|删除组件)/i.test(normalized);
    const currentAppCommand = /(删除这个应用|删除当前应用|关闭当前应用|启动当前应用|重启当前应用|删除应用|关闭应用|启动应用|重启应用)/i.test(normalized);
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
    const explicitComponent = /(当前组件|这个组件|该组件|当前服务|这个服务|该服务|组件|服务|component|service)/i.test(normalized);
    const explicitApp = /(当前应用|这个应用|该应用|应用|app)/i.test(normalized);
    let target = null;
    if (explicitComponent) {
        target = "component";
    }
    else if (explicitApp) {
        target = "app";
    }
    else if (resourceType === "component" || hasComponentContext) {
        target = "component";
    }
    else if (resourceType === "app" || hasAppContext) {
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
function buildContextualOperateDescription(action, target, label) {
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
export function createCopilotController(deps = {}) {
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
    });
    const approvalService = new CopilotApprovalService({
        approvalStore,
        runStore,
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
    const executePendingAction = async (params) => {
        const currentRun = await runStore.getById(params.runId, params.actor.tenantId);
        if (!currentRun) {
            throw new Error("Run not found");
        }
        const currentSession = await sessionService.getSession(params.sessionId, {
            tenantId: params.actor.tenantId,
            userId: params.actor.userId,
        });
        const pendingAction = currentSession.pendingWorkflowAction;
        if (!pendingAction) {
            throw new Error("Pending workflow action not found");
        }
        const completedEvents = await broker.replay(params.runId, params.actor.tenantId, { afterSequence: 0 });
        let nextSequence = completedEvents.length + 1;
        let traceToolName = pendingAction.toolName;
        let output;
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
            output = await client.callTool(pendingAction.toolName, pendingAction.arguments);
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
            },
        });
        nextSequence += 1;
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
        const completion = buildPendingWorkflowActionCompletion(pendingAction, output);
        await sessionStore.update({
            ...currentSession,
            pendingWorkflowAction: undefined,
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
                content: completion.summary,
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
    };
    const queuePendingActionApproval = async (params) => {
        const currentSession = await sessionService.getSession(params.sessionId, {
            tenantId: params.actor.tenantId,
            userId: params.actor.userId,
        });
        const normalizedPendingAction = {
            kind: params.pendingAction.kind || "mcp_tool",
            toolName: params.pendingAction.toolName,
            requiresApproval: true,
            risk: params.pendingAction.risk || params.risk,
            scope: params.pendingAction.scope ||
                getMutableToolPolicy(params.pendingAction.toolName)?.scope,
            description: params.pendingAction.description || params.description,
            arguments: params.pendingAction.arguments,
            followUpActions: params.pendingAction.followUpActions,
        };
        await sessionStore.update({
            ...currentSession,
            pendingWorkflowAction: normalizedPendingAction,
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
            if (session.pendingWorkflowAction &&
                session.pendingWorkflowAction.requiresApproval &&
                isContinueWorkflowActionPrompt(request.body.message)) {
                await queuePendingActionApproval({
                    actor: request.actor,
                    sessionId: request.params.sessionId,
                    runId: run.runId,
                    pendingAction: session.pendingWorkflowAction,
                    description: session.pendingWorkflowAction.description ||
                        `执行 ${session.pendingWorkflowAction.toolName}`,
                    risk: session.pendingWorkflowAction.risk || "high",
                });
                return {
                    data: {
                        run_id: run.runId,
                        session_id: run.sessionId,
                        stream_url: copilotRoutes.streamRunEvents(request.params.sessionId, run.runId),
                    },
                };
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
                        stream_url: copilotRoutes.streamRunEvents(request.params.sessionId, run.runId),
                    },
                };
            }
            const actionAdapter = deps.actionAdapterFactory
                ? await deps.actionAdapterFactory({
                    actor: request.actor,
                    sessionId: request.params.sessionId,
                })
                : deps.actionAdapter;
            const runExecutor = new ServerRunExecutor({
                broker,
                eventPublisher,
                actionAdapter,
            });
            const llmExecutor = new ServerLlmExecutor({
                broker,
                eventPublisher,
                llmClient: deps.llmClient,
                actionAdapter,
                queryToolClientFactory: deps.queryToolClientFactory,
                requestApproval: async (input) => {
                    await queuePendingActionApproval(input);
                },
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
            }
            else {
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
            return {
                data: {
                    run_id: run.runId,
                    session_id: run.sessionId,
                    stream_url: copilotRoutes.streamRunEvents(request.params.sessionId, run.runId),
                },
            };
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
                if (session &&
                    session.userId === request.actor.userId &&
                    session.pendingWorkflowAction?.toolName === approval.skillId) {
                    await sessionStore.update({
                        ...session,
                        pendingWorkflowAction: undefined,
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
