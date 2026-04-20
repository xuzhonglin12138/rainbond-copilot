import type { RequestActor, RiskLevel } from "../../shared/types";
import type { ActionSkill } from "../../skills/types";
import {
  extractComponentName,
  shouldInspectLogs,
  summarizeLogs,
} from "../../runtime/runtime-helpers";
import { PersistedEventPublisher } from "../events/persisted-event-publisher";
import type { SseBroker } from "../events/sse-broker";
import { createServerActionSkills } from "./server-action-skills";

export interface PlannedServerAction {
  requiresApproval: boolean;
  skillId: string;
  input: Record<string, unknown>;
  risk: RiskLevel;
  description: string;
}

interface ServerRunExecutorDeps {
  broker: SseBroker;
  eventPublisher: PersistedEventPublisher;
}

export class ServerRunExecutor {
  private readonly skills: Record<string, ActionSkill>;

  constructor(private readonly deps: ServerRunExecutorDeps) {
    this.skills = createServerActionSkills();
  }

  plan(message: string): PlannedServerAction {
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

    if (/(scale|扩容|memory|内存)/i.test(normalized)) {
      const memoryMatch = normalized.match(/(\d{3,5})/);
      const memory = memoryMatch ? Number(memoryMatch[1]) : 1024;

      return {
        requiresApproval: true,
        skillId: "scale-component-memory",
        input: { name: componentName, memory },
        risk: memory >= 2048 ? "high" : "medium",
        description: `执行高风险操作前需要确认：${message}`,
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

  async executeLowRisk(params: {
    actor: RequestActor;
    sessionId: string;
    runId: string;
    message: string;
  }): Promise<void> {
    const plan = this.plan(params.message);
    const statusSkill = this.mustGetSkill(plan.skillId);
    const statusInput = plan.input;

    const traceCallSequence = await this.nextSequence(
      params.runId,
      params.actor.tenantId
    );
    await this.deps.eventPublisher.publish({
      type: "chat.trace",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: traceCallSequence,
      data: {
        tool_name: statusSkill.name,
        input: statusInput,
      },
    });

    const statusOutput = await statusSkill.execute(statusInput);

    const traceResultSequence = await this.nextSequence(
      params.runId,
      params.actor.tenantId
    );
    await this.deps.eventPublisher.publish({
      type: "chat.trace",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: traceResultSequence,
      data: {
        tool_name: statusSkill.name,
        input: statusInput,
        output: statusOutput as Record<string, unknown>,
      },
    });

    let content = `${(statusOutput as { name: string }).name} 当前状态为 ${(statusOutput as { status: string }).status}，配置内存 ${(statusOutput as { memory: number }).memory}MB。`;

    if (
      shouldInspectLogs(
        params.message,
        (statusOutput as { status?: string }).status
      )
    ) {
      const logsSkill = this.mustGetSkill("get-component-logs");
      const logsInput = {
        name: (statusOutput as { name: string }).name,
        lines: 20,
      };

      const logsCallSequence = await this.nextSequence(
        params.runId,
        params.actor.tenantId
      );
      await this.deps.eventPublisher.publish({
        type: "chat.trace",
        tenantId: params.actor.tenantId,
        sessionId: params.sessionId,
        runId: params.runId,
        sequence: logsCallSequence,
        data: {
          tool_name: logsSkill.name,
          input: logsInput,
        },
      });

      const logsOutput = (await logsSkill.execute(logsInput)) as {
        logs: string[];
      };

      const logsResultSequence = await this.nextSequence(
        params.runId,
        params.actor.tenantId
      );
      await this.deps.eventPublisher.publish({
        type: "chat.trace",
        tenantId: params.actor.tenantId,
        sessionId: params.sessionId,
        runId: params.runId,
        sequence: logsResultSequence,
        data: {
          tool_name: logsSkill.name,
          input: logsInput,
          output: logsOutput,
        },
      });

      content = `${content}\n${summarizeLogs(logsOutput.logs)}`;
    }

    const messageSequence = await this.nextSequence(
      params.runId,
      params.actor.tenantId
    );
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

    const doneSequence = await this.nextSequence(
      params.runId,
      params.actor.tenantId
    );
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

  private mustGetSkill(skillId: string): ActionSkill {
    const skill = this.skills[skillId];

    if (!skill) {
      throw new Error(`Unsupported skill: ${skillId}`);
    }

    return skill;
  }

  private async nextSequence(runId: string, tenantId: string): Promise<number> {
    const events = await this.deps.broker.replay(runId, tenantId, {
      afterSequence: 0,
    });

    return events.length + 1;
  }
}
