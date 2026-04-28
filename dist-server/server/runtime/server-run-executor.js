import { extractComponentName, shouldInspectLogs, summarizeLogs, } from "../../runtime/runtime-helpers.js";
import { createServerActionSkills } from "./server-action-skills.js";
import { createServerId } from "../utils/id.js";
function parseMemoryTarget(normalized) {
    const matched = normalized.match(/(\d+(?:\.\d+)?)\s*(gb|g|mb|m)/i);
    if (!matched) {
        return null;
    }
    const value = Number(matched[1]);
    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }
    const unit = matched[2].toLowerCase();
    if (unit === "gb" || unit === "g") {
        return Math.round(value * 1024);
    }
    return Math.round(value);
}
function parseCpuTarget(normalized) {
    const milliMatch = normalized.match(/cpu[^0-9]*(\d+)\s*m\b/i);
    if (milliMatch) {
        const value = Number(milliMatch[1]);
        return Number.isFinite(value) && value > 0 ? value : null;
    }
    const coreMatch = normalized.match(/cpu[^0-9]*(\d+(?:\.\d+)?)\s*(core|cores|vcpu|核)\b/i);
    if (coreMatch) {
        const value = Number(coreMatch[1]);
        return Number.isFinite(value) && value > 0
            ? Math.round(value * 1000)
            : null;
    }
    const genericMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(core|cores|vcpu|核)\b/i);
    if (genericMatch) {
        const value = Number(genericMatch[1]);
        return Number.isFinite(value) && value > 0
            ? Math.round(value * 1000)
            : null;
    }
    return null;
}
export class ServerRunExecutor {
    constructor(deps) {
        this.deps = deps;
        this.skills = createServerActionSkills(deps.actionAdapter);
    }
    plan(message) {
        const normalized = message.toLowerCase();
        const componentName = extractComponentName(message);
        if (/(restart|重启)/i.test(normalized)) {
            return {
                requiresApproval: true,
                skillId: "restart-component",
                input: { name: componentName },
                risk: "high",
                description: `执行高风险操作前需要确认：${message}`,
            };
        }
        if (/(scale|扩容|memory|内存|cpu|core|核)/i.test(normalized)) {
            const memory = parseMemoryTarget(normalized) || 1024;
            const cpu = parseCpuTarget(normalized);
            const hasCpuChange = typeof cpu === "number";
            const cpuPart = hasCpuChange ? `，CPU ${cpu}m` : "";
            return {
                requiresApproval: true,
                skillId: "scale-component-memory",
                input: { name: componentName, memory, ...(hasCpuChange ? { cpu } : {}) },
                risk: memory >= 2048 || (hasCpuChange && cpu >= 1000) ? "high" : "medium",
                description: `执行资源调整前需要确认：内存 ${memory}MB${cpuPart}`,
            };
        }
        return {
            requiresApproval: false,
            skillId: "get-component-status",
            input: { name: componentName },
            risk: "low",
            description: `查询 ${componentName} 状态`,
        };
    }
    async executeLowRisk(params) {
        const plan = this.plan(params.message);
        const statusSkill = this.mustGetSkill(plan.skillId);
        const statusInput = plan.input;
        const statusTraceId = createServerId("trace");
        const traceCallSequence = await this.nextSequence(params.runId, params.actor.tenantId);
        await this.deps.eventPublisher.publish({
            type: "chat.trace",
            tenantId: params.actor.tenantId,
            sessionId: params.sessionId,
            runId: params.runId,
            sequence: traceCallSequence,
            data: {
                trace_id: statusTraceId,
                tool_name: statusSkill.name,
                input: statusInput,
            },
        });
        const statusOutput = await statusSkill.execute(statusInput);
        const traceResultSequence = await this.nextSequence(params.runId, params.actor.tenantId);
        await this.deps.eventPublisher.publish({
            type: "chat.trace",
            tenantId: params.actor.tenantId,
            sessionId: params.sessionId,
            runId: params.runId,
            sequence: traceResultSequence,
            data: {
                trace_id: statusTraceId,
                tool_name: statusSkill.name,
                input: statusInput,
                output: statusOutput,
            },
        });
        let content = `${statusOutput.name} 当前状态为 ${statusOutput.status}，配置内存 ${statusOutput.memory}MB。`;
        if (shouldInspectLogs(params.message, statusOutput.status)) {
            const logsSkill = this.mustGetSkill("get-component-logs");
            const logsInput = {
                name: statusOutput.name,
                lines: 20,
            };
            const logsTraceId = createServerId("trace");
            const logsCallSequence = await this.nextSequence(params.runId, params.actor.tenantId);
            await this.deps.eventPublisher.publish({
                type: "chat.trace",
                tenantId: params.actor.tenantId,
                sessionId: params.sessionId,
                runId: params.runId,
                sequence: logsCallSequence,
                data: {
                    trace_id: logsTraceId,
                    tool_name: logsSkill.name,
                    input: logsInput,
                },
            });
            const logsOutput = (await logsSkill.execute(logsInput));
            const logsResultSequence = await this.nextSequence(params.runId, params.actor.tenantId);
            await this.deps.eventPublisher.publish({
                type: "chat.trace",
                tenantId: params.actor.tenantId,
                sessionId: params.sessionId,
                runId: params.runId,
                sequence: logsResultSequence,
                data: {
                    trace_id: logsTraceId,
                    tool_name: logsSkill.name,
                    input: logsInput,
                    output: logsOutput,
                },
            });
            content = `${content}\n${summarizeLogs(logsOutput.logs)}`;
        }
        const messageSequence = await this.nextSequence(params.runId, params.actor.tenantId);
        await this.deps.eventPublisher.publish({
            type: "chat.message",
            tenantId: params.actor.tenantId,
            sessionId: params.sessionId,
            runId: params.runId,
            sequence: messageSequence,
            data: {
                role: "assistant",
                content,
            },
        });
        const doneSequence = await this.nextSequence(params.runId, params.actor.tenantId);
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
    }
    mustGetSkill(skillId) {
        const skill = this.skills[skillId];
        if (!skill) {
            throw new Error(`Unsupported skill: ${skillId}`);
        }
        return skill;
    }
    async nextSequence(runId, tenantId) {
        const events = await this.deps.broker.replay(runId, tenantId, {
            afterSequence: 0,
        });
        return events.length + 1;
    }
}
