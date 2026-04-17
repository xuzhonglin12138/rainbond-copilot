import { SkillRegistry } from "../skills/registry";
import { ApprovalManager } from "./approval-manager";
import { OpenAIClient, getLLMConfig, type ChatMessage, type ToolDefinition } from "../llm";
import { CustomAnthropicClient } from "../llm/custom-anthropic-client";
import { buildSystemPrompt } from "../prompts/system-prompt";
import type { ActionSkill } from "../skills/types";
import {
  extractComponentName,
  isRecoverableLlmError,
  shouldInspectLogs,
  summarizeLogs,
} from "./runtime-helpers";

export interface RuntimeEvent {
  type: string;
  runId: string;
  [key: string]: unknown;
}

export class AgentRuntime {
  private registry = new SkillRegistry("src/skills");
  private approvalManager = new ApprovalManager();
  private llmClient: OpenAIClient | CustomAnthropicClient | null = null;
  private systemPrompt: string = "";
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const config = getLLMConfig();

      // Create appropriate client based on provider
      if (config.provider === "anthropic") {
        this.llmClient = new CustomAnthropicClient(config);
      } else {
        this.llmClient = new OpenAIClient(config);
      }

      const skills = await this.registry.loadAll();
      this.systemPrompt = await buildSystemPrompt(skills);
      this.initialized = true;
    } catch (error) {
      console.warn("Failed to initialize LLM client:", error);
      // Continue without LLM - will use fallback mode
    }
  }

  private evaluateApproval(
    skill: ActionSkill,
    input: unknown
  ): {
    requiresApproval: boolean;
    risk: "low" | "medium" | "high";
    description: string;
  } {
    const policyDecision = skill.approvalPolicy?.evaluate(input);

    return {
      requiresApproval:
        policyDecision?.requiresApproval ?? skill.requiresApproval ?? false,
      risk: policyDecision?.risk ?? skill.risk ?? "low",
      description: policyDecision?.reason ?? skill.description,
    };
  }

  async run(input: string): Promise<RuntimeEvent[]> {
    await this.initialize();

    const runId = `run-${Date.now()}`;
    const events: RuntimeEvent[] = [];

    // If LLM is not available, use fallback mode
    if (!this.llmClient) {
      return this.fallbackRun(runId, input);
    }

    try {
      // Initialize conversation
      const messages: ChatMessage[] = [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: input },
      ];

      events.push({
        type: "run.status",
        runId,
        status: "thinking",
      });

      // Load skills and convert to tools
      const skills = await this.registry.loadAll();
      const actionSkills = skills.filter((s) => s.kind === "action") as ActionSkill[];
      const tools = this.skillsToTools(actionSkills);

      // Agent loop: LLM → tool calls → execute → return results → LLM continues
      let maxIterations = 10; // Prevent infinite loops
      let iteration = 0;

      while (iteration < maxIterations) {
        iteration++;

        // Call LLM
        const response = await this.llmClient.chat(messages, tools);

        // If LLM returns text (no tool calls), we're done
        if (!response.tool_calls || response.tool_calls.length === 0) {
          if (response.content) {
            events.push({
              type: "chat.message",
              runId,
              role: "assistant",
              content: response.content,
            });
          }
          break;
        }

        // LLM wants to call tools
        // Add assistant message with tool calls to history
        messages.push({
          role: "assistant",
          content: response.content || "",
        });

        // Execute each tool call
        for (const toolCall of response.tool_calls) {
          const skillId = toolCall.function.name;
          const skill = actionSkills.find((s) => s.id === skillId);

          if (!skill) {
            // Tool not found, add error message
            messages.push({
              role: "tool",
              content: JSON.stringify({ error: "Tool not found" }),
              name: skillId,
              tool_call_id: toolCall.id,
            });
            continue;
          }

          // Emit tool call event
          events.push({
            type: "chat.trace",
            runId,
            toolName: skill.name,
            input: JSON.parse(toolCall.function.arguments),
          });

          const toolInput = JSON.parse(toolCall.function.arguments);
          const approvalDecision = this.evaluateApproval(skill, toolInput);

          // Check if approval is required
          if (approvalDecision.requiresApproval) {
            const approval = this.approvalManager.createApproval(
              runId,
              skillId,
              approvalDecision.description,
              approvalDecision.risk
            );

            events.push({
              type: "approval.requested",
              runId,
              approvalId: approval.approvalId,
              skillId,
              description: approvalDecision.description,
              risk: approvalDecision.risk,
            });

            // Stop here and wait for approval
            // The gateway will handle approval and resume
            events.push({
              type: "run.status",
              runId,
              status: "waiting_approval",
            });

            return events;
          }

          // Execute tool
          try {
            const output = await skill.execute(toolInput);

            // Emit tool result event
            events.push({
              type: "chat.trace",
              runId,
              toolName: skill.name,
              input: toolInput,
              output,
            });

            // Add tool result to conversation history
            messages.push({
              role: "tool",
              content: JSON.stringify(output),
              name: skillId,
              tool_call_id: toolCall.id,
            });
          } catch (error: any) {
            // Tool execution failed
            messages.push({
              role: "tool",
              content: JSON.stringify({ error: error.message }),
              name: skillId,
              tool_call_id: toolCall.id,
            });
          }
        }

        // Continue loop - LLM will process tool results and decide next action
      }

      events.push({
        type: "run.status",
        runId,
        status: "done",
      });

      return events;
    } catch (error: any) {
      if (isRecoverableLlmError(error)) {
        console.warn("Agent runtime is falling back to deterministic mode:", error);
        return this.fallbackRun(runId, input, error?.message);
      }

      console.error("Agent runtime error:", error);
      events.push({
        type: "chat.message",
        runId,
        role: "assistant",
        content: `抱歉，处理您的请求时出现错误：${error.message}`,
      });
      events.push({
        type: "run.status",
        runId,
        status: "error",
      });
      return events;
    }
  }

  private skillsToTools(skills: ActionSkill[]): ToolDefinition[] {
    return skills.map((skill) => ({
      type: "function" as const,
      function: {
        name: skill.id,
        description: skill.description,
        parameters: this.inferParameters(skill.id),
      },
    }));
  }

  private inferParameters(skillId: string): {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  } {
    const parameterMap: Record<string, any> = {
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

  private async fallbackRun(
    runId: string,
    input: string,
    fallbackReason?: string
  ): Promise<RuntimeEvent[]> {
    const events: RuntimeEvent[] = [];
    const skills = await this.registry.loadAll();
    const componentName = extractComponentName(input);
    const statusSkill = skills.find((s) => s.id === "get-component-status");
    const logsSkill = skills.find((s) => s.id === "get-component-logs");
    let statusOutput:
      | {
          name: string;
          status: string;
          memory: number;
        }
      | undefined;
    let logsOutput:
      | {
          name: string;
          logs: string[];
        }
      | undefined;

    events.push({
      type: "run.status",
      runId,
      status: "thinking",
    });

    if (statusSkill && statusSkill.kind === "action") {
      events.push({
        type: "chat.trace",
        runId,
        toolName: statusSkill.name,
        input: { name: componentName },
      });

      statusOutput = (await statusSkill.execute({
        name: componentName,
      })) as typeof statusOutput;

      events.push({
        type: "chat.trace",
        runId,
        toolName: statusSkill.name,
        input: { name: componentName },
        output: statusOutput,
      });
    }

    if (
      logsSkill &&
      logsSkill.kind === "action" &&
      shouldInspectLogs(input, statusOutput?.status)
    ) {
      events.push({
        type: "chat.trace",
        runId,
        toolName: logsSkill.name,
        input: { name: componentName, lines: 20 },
      });

      logsOutput = (await logsSkill.execute({
        name: componentName,
        lines: 20,
      })) as typeof logsOutput;

      events.push({
        type: "chat.trace",
        runId,
        toolName: logsSkill.name,
        input: { name: componentName, lines: 20 },
        output: logsOutput,
      });
    }

    events.push({
      type: "chat.message",
      runId,
      role: "assistant",
      content: [
        fallbackReason
          ? `LLM 暂时不可用，已切换到降级模式继续处理：${fallbackReason}`
          : "已切换到降级模式继续处理当前请求。",
        statusOutput
          ? `${statusOutput.name} 当前状态为 ${statusOutput.status}，配置内存 ${statusOutput.memory}MB。`
          : `未能读取 ${componentName} 的状态。`,
        logsOutput
          ? summarizeLogs(logsOutput.logs)
          : "当前未发现需要进一步展开的异常日志。",
      ].join("\n"),
    });

    events.push({
      type: "run.status",
      runId,
      status: "done",
    });

    return events;
  }
}
