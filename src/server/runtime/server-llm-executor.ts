import { CustomAnthropicClient } from "../../llm/custom-anthropic-client.js";
import { getLLMConfig } from "../../llm/config.js";
import type {
  ChatCompletionResponse,
  ChatMessage,
  ToolDefinition,
} from "../../llm/types.js";
import { OpenAIClient } from "../../llm/openai-client.js";
import type { ActionSkill } from "../../skills/types.js";
import type { RequestActor } from "../../shared/types.js";
import { PersistedEventPublisher } from "../events/persisted-event-publisher.js";
import type { SseBroker } from "../events/sse-broker.js";
import { createServerActionSkills } from "./server-action-skills.js";
import { buildServerSystemPrompt } from "./server-system-prompt.js";

export interface ServerChatClient {
  chat: (
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ) => Promise<ChatCompletionResponse>;
}

interface ServerLlmExecutorDeps {
  broker: SseBroker;
  eventPublisher: PersistedEventPublisher;
  llmClient?: ServerChatClient | null;
}

export interface ExecuteServerLlmRunParams {
  actor: RequestActor;
  sessionId: string;
  runId: string;
  message: string;
}

export class ServerLlmExecutor {
  private readonly skills: Record<string, ActionSkill>;
  private resolvedClient: ServerChatClient | null | undefined;

  constructor(private readonly deps: ServerLlmExecutorDeps) {
    this.skills = createServerActionSkills();
    this.resolvedClient = deps.llmClient;
  }

  async execute(params: ExecuteServerLlmRunParams): Promise<boolean> {
    const llmClient = this.getClient();
    if (!llmClient) {
      return false;
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: await buildServerSystemPrompt(),
      },
      {
        role: "user",
        content: params.message,
      },
    ];

    const tools = this.buildTools();
    let iteration = 0;

    while (iteration < 8) {
      iteration += 1;
      const response = await llmClient.chat(messages, tools);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        const content = response.content || "我已经完成当前分析，但没有生成额外回复。";

        await this.publishAssistantMessage(params, content);
        await this.publishRunStatus(params, "done");
        return true;
      }

      messages.push({
        role: "assistant",
        content: response.content || "",
      });

      for (const toolCall of response.tool_calls) {
        const skill = this.skills[toolCall.function.name];
        if (!skill) {
          continue;
        }

        const toolInput = JSON.parse(toolCall.function.arguments || "{}");
        await this.publishTrace(params, {
          tool_name: skill.name,
          input: toolInput,
        });

        const output = await skill.execute(toolInput);

        await this.publishTrace(params, {
          tool_name: skill.name,
          input: toolInput,
          output,
        });

        messages.push({
          role: "tool",
          content: JSON.stringify(output),
          name: toolCall.function.name,
          tool_call_id: toolCall.id,
        });
      }
    }

    await this.publishAssistantMessage(
      params,
      "本次分析轮次已达上限，请尝试缩小问题范围后重新提问。"
    );
    await this.publishRunStatus(params, "done");
    return true;
  }

  private getClient(): ServerChatClient | null {
    if (this.resolvedClient !== undefined) {
      return this.resolvedClient;
    }

    try {
      const config = getLLMConfig();
      this.resolvedClient =
        config.provider === "anthropic"
          ? new CustomAnthropicClient(config)
          : new OpenAIClient(config);
    } catch {
      this.resolvedClient = null;
    }

    return this.resolvedClient;
  }

  private buildTools(): ToolDefinition[] {
    return Object.values(this.skills).map((skill) => ({
      type: "function",
      function: {
        name: skill.id,
        description: skill.description,
        parameters: this.inferParameters(skill.id),
      },
    }));
  }

  private inferParameters(skillId: string): ToolDefinition["function"]["parameters"] {
    const parameterMap: Record<string, ToolDefinition["function"]["parameters"]> = {
      "get-component-status": {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "组件名称，如 frontend-ui, backend-api 等",
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

    return (
      parameterMap[skillId] || {
        type: "object",
        properties: {},
      }
    );
  }

  private async publishTrace(
    params: ExecuteServerLlmRunParams,
    data: Record<string, unknown>
  ): Promise<void> {
    await this.deps.eventPublisher.publish({
      type: "chat.trace",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: await this.nextSequence(params.runId, params.actor.tenantId),
      data,
    });
  }

  private async publishAssistantMessage(
    params: ExecuteServerLlmRunParams,
    content: string
  ): Promise<void> {
    await this.deps.eventPublisher.publish({
      type: "chat.message",
      tenantId: params.actor.tenantId,
      sessionId: params.sessionId,
      runId: params.runId,
      sequence: await this.nextSequence(params.runId, params.actor.tenantId),
      data: {
        role: "assistant",
        content,
      },
    });
  }

  private async publishRunStatus(
    params: ExecuteServerLlmRunParams,
    status: string
  ): Promise<void> {
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

  private async nextSequence(runId: string, tenantId: string): Promise<number> {
    const events = await this.deps.broker.replay(runId, tenantId, {
      afterSequence: 0,
    });

    return events.length + 1;
  }
}
