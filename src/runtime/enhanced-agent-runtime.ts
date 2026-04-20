import { SkillRegistry } from "../skills/registry";
import { ApprovalManager } from "./approval-manager";
import {
  OpenAIClient,
  getLLMConfig,
  type ChatMessage,
  type ToolDefinition,
} from "../llm";
import { CustomAnthropicClient } from "../llm/custom-anthropic-client";
import { buildSystemPrompt } from "../prompts/system-prompt";
import type { ActionSkill } from "../skills/types";
import { MemoryManager } from "../memory";
import { GoalManager } from "../goals";
import { ReflectionEngine } from "../reflection";
import { SubAgentCoordinator } from "../agents";
import { ContextBuilder } from "../context";
import { WorkspaceManager } from "../workspace/workspace-manager";
import type { RequestActor } from "../shared/types";
import {
  buildActiveMemoryPrompt,
  extractComponentName,
  isRecoverableLlmError,
  shouldInspectLogs,
  summarizeLogs,
} from "./runtime-helpers";
import type { MemorySearchResult } from "../memory/types";

export interface RuntimeEvent {
  type: string;
  runId: string;
  [key: string]: unknown;
}

export interface EnhancedRuntimeConfig {
  sessionId: string;
  workspaceDir: string;
  actor?: RequestActor;
  enableWorkspace?: boolean;
  enableMemory?: boolean;
  enableGoals?: boolean;
  enableReflection?: boolean;
  enableSubAgents?: boolean;
  skillRegistry?: SkillRegistry;
  llmClient?: OpenAIClient | CustomAnthropicClient | null;
  onApprovalRequest?: (approval: {
    approvalId: string;
    skillId: string;
    description: string;
    risk: string;
  }) => Promise<boolean>;
}

export class EnhancedAgentRuntime {
  private registry: SkillRegistry;
  private approvalManager = new ApprovalManager();
  private llmClient: OpenAIClient | CustomAnthropicClient | null;
  private systemPrompt: string = "";
  private initialized = false;

  // Enhanced components
  private memoryManager?: MemoryManager;
  private goalManager?: GoalManager;
  private reflectionEngine?: ReflectionEngine;
  private subAgentCoordinator?: SubAgentCoordinator;
  private contextBuilder?: ContextBuilder;
  private workspaceManager?: WorkspaceManager;

  constructor(private config: EnhancedRuntimeConfig) {
    this.registry = config.skillRegistry ?? new SkillRegistry("src/skills");
    this.llmClient = config.llmClient ?? null;

    // Initialize enhanced components based on config
    if (config.enableMemory) {
      this.memoryManager = new MemoryManager(
        config.workspaceDir,
        config.sessionId
      );
      this.contextBuilder = new ContextBuilder(
        config.workspaceDir,
        this.memoryManager
      );
    }

    if (config.enableGoals) {
      this.goalManager = new GoalManager();
    }

    if (config.enableReflection) {
      this.reflectionEngine = new ReflectionEngine(this.memoryManager);
    }

    if (config.enableSubAgents) {
      this.subAgentCoordinator = new SubAgentCoordinator(this.goalManager);
    }

    if (config.enableWorkspace ?? true) {
      this.workspaceManager = new WorkspaceManager(config.workspaceDir);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize workspace
      if (this.workspaceManager) {
        await this.workspaceManager.init(this.config.sessionId);
      }

      // Initialize memory
      if (this.memoryManager) {
        await this.memoryManager.initialize();
      }

      try {
        if (!this.llmClient) {
          const llmConfig = getLLMConfig();

          // Create appropriate client based on provider
          if (llmConfig.provider === "anthropic") {
            this.llmClient = new CustomAnthropicClient(llmConfig);
          } else {
            this.llmClient = new OpenAIClient(llmConfig);
          }
        }
      } catch (error) {
        console.warn("Failed to initialize LLM client:", error);
      }

      // Build system prompt with context
      const skills = await this.registry.loadAll();
      const context = this.contextBuilder
        ? await this.contextBuilder.buildContext()
        : undefined;

      this.systemPrompt = await buildSystemPrompt(skills, context);
      this.initialized = true;
    } catch (error) {
      console.warn("Failed to initialize enhanced runtime:", error);
      throw error;
    }
  }

  private async recallActiveMemories(
    input: string
  ): Promise<MemorySearchResult[]> {
    if (!this.memoryManager) {
      return [];
    }

    return this.memoryManager.recallRelevantMemories(input, {
      limit: 3,
      minRelevance: 0.35,
      minImportance: 0.5,
    });
  }

  private buildRunSystemPrompt(activeRecall: MemorySearchResult[]): string {
    const activeMemoryBlock = buildActiveMemoryPrompt(activeRecall);
    if (!activeMemoryBlock) {
      return this.systemPrompt;
    }

    return `${this.systemPrompt}\n\n${activeMemoryBlock}`;
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

  async run(input: string, sessionContext?: {
    conversationHistory?: ChatMessage[];
    currentState?: Record<string, unknown>;
  }): Promise<RuntimeEvent[]> {
    await this.initialize();

    const runId = `run-${Date.now()}`;
    const events: RuntimeEvent[] = [];

    // Create goal for this run if goal management is enabled
    let mainGoal;
    if (this.goalManager) {
      mainGoal = this.goalManager.createGoal(input, 5);
      events.push({
        type: "goal.created",
        runId,
        goalId: mainGoal.id,
        description: input,
      });
    }

    const activeRecall = await this.recallActiveMemories(input);
    if (activeRecall.length > 0) {
      events.push({
        type: "memory.recalled",
        runId,
        query: input,
        entries: activeRecall.map((result) => ({
          content: result.entry.content,
          relevance: result.relevance,
        })),
      });
    }

    // Record observation in memory
    if (this.memoryManager) {
      await this.memoryManager.addMemory("observation", input, 0.6, {
        runId,
      });
    }

    // Emit memory.stored for important observations (threshold: 0.7)
    // Observation importance is 0.6, so won't emit here — but actions will

    // If LLM is not available, use fallback mode
    if (!this.llmClient) {
      return [
        ...events,
        ...(await this.fallbackRun(
          runId,
          input,
          [],
          "LLM client unavailable"
        )),
      ];
    }

    try {
      // Initialize conversation with history if provided
      const messages: ChatMessage[] = [
        { role: "system", content: this.buildRunSystemPrompt(activeRecall) },
      ];

      // Add conversation history if provided
      if (sessionContext?.conversationHistory) {
        messages.push(...sessionContext.conversationHistory);
      }

      // Add current user input
      messages.push({ role: "user", content: input });

      events.push({
        type: "run.status",
        runId,
        status: "thinking",
      });

      // Load skills and convert to tools
      const skills = await this.registry.loadAll();
      const actionSkills = skills.filter(
        (s) => s.kind === "action"
      ) as ActionSkill[];
      const tools = this.skillsToTools(actionSkills);

      // Agent loop: LLM → tool calls → execute → return results → LLM continues
      let maxIterations = 10;
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

            // Record in memory
            if (this.memoryManager) {
              await this.memoryManager.addMemory(
                "action",
                `回复: ${response.content}`,
                0.5,
                { runId }
              );
            }
          }
          break;
        }

        // LLM wants to call tools
        messages.push({
          role: "assistant",
          content: response.content || "",
        });

        // Execute each tool call
        for (const toolCall of response.tool_calls) {
          const skillId = toolCall.function.name;
          const skill = actionSkills.find((s) => s.id === skillId);

          if (!skill) {
            messages.push({
              role: "tool",
              content: JSON.stringify({ error: "Tool not found" }),
              name: skillId,
              tool_call_id: toolCall.id,
            });
            continue;
          }

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

            events.push({
              type: "run.status",
              runId,
              status: "waiting_approval",
            });

            // If callback is provided, wait for approval
            if (this.config.onApprovalRequest) {
              const approved = await this.config.onApprovalRequest({
                approvalId: approval.approvalId,
                skillId,
                description: approvalDecision.description,
                risk: approvalDecision.risk,
              });

              if (!approved) {
                events.push({
                  type: "approval.rejected",
                  runId,
                  approvalId: approval.approvalId,
                });

                messages.push({
                  role: "tool",
                  content: JSON.stringify({ error: "User rejected the action" }),
                  name: skillId,
                  tool_call_id: toolCall.id,
                });

                continue;
              }

              events.push({
                type: "approval.approved",
                runId,
                approvalId: approval.approvalId,
              });
            } else {
              // No callback, return and wait for external approval
              return events;
            }
          }

          // Execute tool
          const actionStartTime = Date.now();
          try {
            const output = await skill.execute(toolInput);
            const actionDuration = Date.now() - actionStartTime;

            events.push({
              type: "chat.trace",
              runId,
              toolName: skill.name,
              input: toolInput,
              output,
            });

            messages.push({
              role: "tool",
              content: JSON.stringify(output),
              name: skillId,
              tool_call_id: toolCall.id,
            });

            // Record successful action in reflection
            if (this.reflectionEngine) {
              await this.reflectionEngine.recordAction(
                toolCall.id,
                skillId,
                true,
                toolInput,
                output,
                undefined,
                actionDuration
              );
            }

            // Record in memory (importance 0.7 → also emit memory.stored)
            if (this.memoryManager) {
              const memContent = `执行 ${skill.name}: ${JSON.stringify(toolInput)}`;
              await this.memoryManager.addMemory("action", memContent, 0.7, {
                runId,
                skillId,
                output,
              });
              events.push({
                type: "memory.stored",
                runId,
                content: memContent.substring(0, 80),
                importance: 0.7,
              });
            }

            // Update goal task if exists
            if (mainGoal && this.goalManager) {
              const task = this.goalManager.createTask(
                mainGoal.id,
                `执行 ${skill.name}`
              );
              this.goalManager.updateTaskStatus(task.id, "completed", output);
            }
          } catch (error: any) {
            const actionDuration = Date.now() - actionStartTime;

            messages.push({
              role: "tool",
              content: JSON.stringify({ error: error.message }),
              name: skillId,
              tool_call_id: toolCall.id,
            });

            // Record failed action in reflection
            if (this.reflectionEngine) {
              await this.reflectionEngine.recordAction(
                toolCall.id,
                skillId,
                false,
                toolInput,
                undefined,
                error.message,
                actionDuration
              );
            }

            // Record error in memory (importance 0.8 → also emit memory.stored)
            if (this.memoryManager) {
              const errContent = `执行 ${skill.name} 失败: ${error.message}`;
              await this.memoryManager.addMemory(
                "action",
                errContent,
                0.8,
                { runId, skillId, error: error.message },
                ["error"]
              );
              events.push({
                type: "memory.stored",
                runId,
                content: errContent.substring(0, 80),
                importance: 0.8,
              });
            }
          }
        }
      }

      // Complete goal if exists
      if (mainGoal && this.goalManager) {
        this.goalManager.updateGoalStatus(mainGoal.id, "completed");
        events.push({
          type: "goal.completed",
          runId,
          goalId: mainGoal.id,
        });
      }

      events.push({
        type: "run.status",
        runId,
        status: "done",
      });

      // Generate reflection insights — emit one event per pattern
      if (this.reflectionEngine) {
        const patterns = await this.reflectionEngine.analyzePatterns();
        for (const pattern of patterns.slice(0, 3)) {
          events.push({
            type: "reflection.insight",
            runId,
            insight: pattern,
          });
        }
      }

      return events;
    } catch (error: any) {
      if (isRecoverableLlmError(error)) {
        console.warn("Enhanced runtime is falling back to deterministic mode:", error);
        return [
          ...events,
          ...(await this.fallbackRun(runId, input, [], error?.message)),
        ];
      }

      console.error("Enhanced agent runtime error:", error);

      // Record error in reflection
      if (this.reflectionEngine) {
        await this.reflectionEngine.recordAction(
          runId,
          "runtime",
          false,
          { input },
          undefined,
          error.message
        );
      }

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
    activeRecall: MemorySearchResult[] = [],
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

    if (activeRecall.length > 0) {
      events.push({
        type: "memory.recalled",
        runId,
        query: input,
        entries: activeRecall.map((result) => ({
          content: result.entry.content,
          relevance: result.relevance,
        })),
      });
    }

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

    const diagnosis = logsOutput
      ? summarizeLogs(logsOutput.logs)
      : "当前未发现需要进一步展开的异常日志。";

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
        diagnosis,
      ].join("\n"),
    });

    events.push({
      type: "run.status",
      runId,
      status: "done",
    });

    return events;
  }

  // Public API for accessing enhanced components
  getMemoryManager(): MemoryManager | undefined {
    return this.memoryManager;
  }

  getGoalManager(): GoalManager | undefined {
    return this.goalManager;
  }

  getReflectionEngine(): ReflectionEngine | undefined {
    return this.reflectionEngine;
  }

  getSubAgentCoordinator(): SubAgentCoordinator | undefined {
    return this.subAgentCoordinator;
  }
}
