import type { Skill, ActionSkill } from "../skills/types";
import { OpenAIClient, getLLMConfig, type ToolDefinition, type ChatMessage } from "../llm";
import { buildSystemPrompt } from "../prompts/system-prompt";

export interface Plan {
  runId: string;
  userInput: string;
  selectedSkills: string[];
  actions: PlanAction[];
  reasoning?: string;
}

export interface PlanAction {
  skillId: string;
  input: unknown;
  requiresApproval: boolean;
}

export class Planner {
  private llmClient: OpenAIClient | null = null;
  private systemPrompt: string = "";

  async initialize(skills: Skill[]): Promise<void> {
    try {
      const config = getLLMConfig();
      this.llmClient = new OpenAIClient(config);
      this.systemPrompt = await buildSystemPrompt(skills);
    } catch (error) {
      console.warn("Failed to initialize LLM client:", error);
      // Fallback to keyword-based planning if LLM is not available
    }
  }

  async plan(userInput: string, skills: Skill[]): Promise<Plan> {
    const runId = `run-${Date.now()}`;

    // If LLM is not available, fallback to keyword-based planning
    if (!this.llmClient) {
      return this.fallbackPlan(runId, userInput);
    }

    try {
      // Convert action skills to tool definitions
      const tools = this.skillsToTools(skills.filter((s) => s.kind === "action") as ActionSkill[]);

      // Call LLM with function calling
      const messages: ChatMessage[] = [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: userInput },
      ];

      const response = await this.llmClient.chat(messages, tools);

      // Parse tool calls into actions
      const actions: PlanAction[] = [];
      const selectedSkills: string[] = [];

      if (response.tool_calls && response.tool_calls.length > 0) {
        for (const toolCall of response.tool_calls) {
          const skillId = toolCall.function.name;
          const skill = skills.find((s) => s.id === skillId);

          if (skill && skill.kind === "action") {
            selectedSkills.push(skillId);
            actions.push({
              skillId,
              input: JSON.parse(toolCall.function.arguments),
              requiresApproval: skill.requiresApproval ?? false,
            });
          }
        }
      }

      return {
        runId,
        userInput,
        selectedSkills,
        actions,
        reasoning: response.content || undefined,
      };
    } catch (error) {
      console.error("LLM planning failed, falling back to keyword-based:", error);
      return this.fallbackPlan(runId, userInput);
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
    // Define parameters for each skill
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

  private fallbackPlan(runId: string, userInput: string): Plan {
    // Fallback to keyword-based planning
    const actions: PlanAction[] = [];
    const selectedSkills: string[] = [];

    if (userInput.includes("scale") && userInput.includes("memory")) {
      selectedSkills.push("scale-component-memory");
      actions.push({
        skillId: "scale-component-memory",
        input: { name: "frontend-ui", memory: 1024 },
        requiresApproval: true,
      });
    }

    if (userInput.includes("restart") || userInput.includes("重启")) {
      selectedSkills.push("restart-component");
      actions.push({
        skillId: "restart-component",
        input: { name: "frontend-ui" },
        requiresApproval: true,
      });
    }

    if (userInput.includes("status") || userInput.includes("check") || userInput.includes("状态")) {
      selectedSkills.push("get-component-status");
      actions.push({
        skillId: "get-component-status",
        input: { name: "frontend-ui" },
        requiresApproval: false,
      });
    }

    return { runId, userInput, selectedSkills, actions };
  }
}
