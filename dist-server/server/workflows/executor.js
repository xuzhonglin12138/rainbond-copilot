import { buildScopeSignature } from "./context-resolver.js";
import { buildPendingWorkflowActionCompletion } from "./pending-action-result.js";
import { executeRainbondAppAssistant } from "./rainbond-app-assistant.js";
import { createWorkflowRegistry } from "./registry.js";
function isSnapshotCreationRequested(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return /(创建.*快照|生成.*快照|create.*snapshot)/i.test(normalized);
}
function shouldAutoCreateSnapshot(message) {
    return (isSnapshotCreationRequested(message) &&
        !/(发布|publish|回滚|rollback)/i.test((message || "").trim()));
}
function shouldAutoPublishSnapshot(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return /(发布到版本中心|发布当前快照|创建快照并发布|publish)/i.test(normalized);
}
function shouldAutoRollbackSnapshot(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return /(回滚到|回滚当前应用|回滚快照|rollback)/i.test(normalized);
}
function shouldUseCloudTemplateInstall(message) {
    const normalized = (message || "").trim();
    if (!normalized) {
        return false;
    }
    return /(云市场|应用市场|cloud market|market template|云模板)/i.test(normalized);
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
    const raw = readStructuredString(payload, ...keys);
    if (!raw) {
        return 0;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
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
    return /(rainbond.+跑起来|在 rainbond 上跑起来|部署|修复|恢复服务|卡在哪|排查|探针|probe|端口|port|存储|挂载|volume|autoscaler|伸缩|连接信息|helm|chart|模板|template|市场|安装到当前应用|快照|snapshot|发布|publish|回滚|rollback|版本中心|version center|交付|验收|验证|verify|访问地址|url|你能做什么|可以做什么|有哪些流程|有哪些能力|有哪些工作流|workflow|skill|技能)/i.test(message);
}
export function isContinueWorkflowActionPrompt(message) {
    return /(继续执行|确认执行|继续|立即执行|execute|confirm|run now)/i.test(message);
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
        if (session.pendingWorkflowAction &&
            isContinueWorkflowActionPrompt(params.message)) {
            return this.executePendingWorkflowAction(params, session);
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
            });
        }
        else if (session.pendingWorkflowAction) {
            await this.deps.sessionStore.update({
                ...session,
                pendingWorkflowAction: undefined,
            });
        }
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
        if (result.selectedWorkflow === "rainbond-template-installer") {
            const isCloudInstall = shouldUseCloudTemplateInstall(message);
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
                marketName = readStructuredString(marketItems[0], "name", "market_name", "market_id");
                const cloudModelInput = {
                    enterprise_id: enterpriseId,
                    market_name: marketName,
                    page: 1,
                    page_size: 20,
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
                const selectedCloudModel = cloudModelItems[0] || {};
                modelId = readStructuredString(selectedCloudModel, "app_model_id", "app_id");
                modelName = readStructuredString(selectedCloudModel, "app_model_name", "app_name");
                if (modelId) {
                    const versionInput = {
                        enterprise_id: enterpriseId,
                        source: "cloud",
                        market_name: marketName,
                        app_model_id: modelId,
                        page: 1,
                        page_size: 20,
                    };
                    await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor, {
                        tool_name: "rainbond_query_app_model_versions",
                        input: versionInput,
                    });
                    const versions = await client.callTool("rainbond_query_app_model_versions", versionInput);
                    await this.publishToolTrace(actor.tenantId, sessionId, runId, sequenceCursor + 1, {
                        tool_name: "rainbond_query_app_model_versions",
                        input: versionInput,
                        output: versions,
                    });
                    sequenceCursor += 2;
                    toolCalls.push({ name: "rainbond_query_app_model_versions", status: "success" });
                    versionCount =
                        versions.structuredContent &&
                            Array.isArray(versions.structuredContent.items)
                            ? versions.structuredContent.items.length
                            : 0;
                    latestVersion =
                        versions.structuredContent &&
                            Array.isArray(versions.structuredContent.items) &&
                            versions.structuredContent.items.length > 0
                            ? readStructuredString(versions.structuredContent.items[versions.structuredContent.items.length - 1], "version")
                            : "";
                    return {
                        summary: "已查询云市场模板及其版本，下一步可继续选择版本并执行安装。",
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
            modelId =
                output.structuredContent &&
                    Array.isArray(output.structuredContent.items) &&
                    output.structuredContent.items[0] &&
                    (output.structuredContent.items[0].app_model_id ||
                        output.structuredContent.items[0].app_id);
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
                    summary: "已查询当前企业下可安装的本地模板及其版本，下一步可继续选择版本并执行安装。",
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
            const latestSnapshotVersionId = readStructuredInt(latestSnapshot, "version_id");
            const latestSnapshotServiceCount = latestSnapshotDetail &&
                latestSnapshotDetail.structuredContent &&
                latestSnapshotDetail.structuredContent.detail &&
                Array.isArray(latestSnapshotDetail.structuredContent.detail.services)
                ? latestSnapshotDetail.structuredContent.detail.services.length
                : 0;
            const currentVersion = readStructuredString(overviewData, "current_version");
            const templateId = readStructuredString(overviewData, "template_id");
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
            return {
                summary: summaryMap[result.selectedWorkflow],
                toolCalls: [{ name: "rainbond_get_app_detail", status: "success" }],
                lastSequence: 5,
            };
        }
        return { toolCalls: [] };
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
        await this.deps.eventPublisher.publish({
            type: "chat.trace",
            tenantId,
            sessionId,
            runId,
            sequence,
            data,
        });
    }
}
