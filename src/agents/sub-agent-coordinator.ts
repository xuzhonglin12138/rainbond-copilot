import type {
  SubAgent,
  SubAgentRole,
  SubAgentTask,
  SubAgentMessage,
  AgentCoordinationPlan,
} from "./types";
import type { GoalManager } from "../goals";

export class SubAgentCoordinator {
  private agents: Map<string, SubAgent> = new Map();
  private tasks: Map<string, SubAgentTask> = new Map();
  private messages: SubAgentMessage[] = [];

  constructor(private readonly goalManager?: GoalManager) {
    // Initialize default agents
    this.initializeDefaultAgents();
  }

  private initializeDefaultAgents(): void {
    // Planner Agent
    this.registerAgent({
      id: "planner-agent",
      role: "planner",
      name: "规划代理",
      description: "负责分析用户需求，制定执行计划，分解复杂任务",
      capabilities: [
        {
          name: "任务分解",
          description: "将复杂目标分解为可执行的子任务",
          skills: [],
        },
        {
          name: "依赖分析",
          description: "识别任务之间的依赖关系",
          skills: [],
        },
      ],
      status: "idle",
      createdAt: Date.now(),
    });

    // Executor Agent
    this.registerAgent({
      id: "executor-agent",
      role: "executor",
      name: "执行代理",
      description: "负责执行具体的操作任务",
      capabilities: [
        {
          name: "组件操作",
          description: "执行组件相关操作",
          skills: [
            "get-component-status",
            "get-component-logs",
            "restart-component",
            "scale-component-memory",
          ],
        },
      ],
      status: "idle",
      createdAt: Date.now(),
    });

    // Analyzer Agent
    this.registerAgent({
      id: "analyzer-agent",
      role: "analyzer",
      name: "分析代理",
      description: "负责诊断问题，分析日志和状态",
      capabilities: [
        {
          name: "故障诊断",
          description: "分析组件状态和日志，诊断问题原因",
          skills: ["get-component-status", "get-component-logs"],
        },
        {
          name: "性能分析",
          description: "分析性能指标，提供优化建议",
          skills: [],
        },
      ],
      status: "idle",
      createdAt: Date.now(),
    });

    // Advisor Agent
    this.registerAgent({
      id: "advisor-agent",
      role: "advisor",
      name: "顾问代理",
      description: "提供最佳实践建议和指导",
      capabilities: [
        {
          name: "最佳实践",
          description: "提供部署、配置、运维的最佳实践建议",
          skills: [],
        },
        {
          name: "问题解答",
          description: "回答用户关于Rainbond的问题",
          skills: [],
        },
      ],
      status: "idle",
      createdAt: Date.now(),
    });
  }

  registerAgent(agent: SubAgent): void {
    this.agents.set(agent.id, agent);
  }

  getAgent(agentId: string): SubAgent | undefined {
    return this.agents.get(agentId);
  }

  getAgentsByRole(role: SubAgentRole): SubAgent[] {
    return Array.from(this.agents.values()).filter((a) => a.role === role);
  }

  getAvailableAgents(): SubAgent[] {
    return Array.from(this.agents.values()).filter((a) => a.status === "idle");
  }

  async delegateTask(
    agentId: string,
    description: string,
    input: unknown,
    goalId?: string
  ): Promise<SubAgentTask> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.status !== "idle") {
      throw new Error(`Agent ${agentId} is not available (status: ${agent.status})`);
    }

    const task: SubAgentTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      agentId,
      goalId,
      description,
      input,
      status: "working",
      startedAt: Date.now(),
    };

    this.tasks.set(task.id, task);

    // Update agent status
    agent.status = "working";
    this.agents.set(agentId, agent);

    // Send task notification
    this.sendMessage({
      from: "coordinator",
      to: agentId,
      type: "request",
      content: { taskId: task.id, description, input },
      timestamp: Date.now(),
    });

    return task;
  }

  async completeTask(
    taskId: string,
    output?: unknown,
    error?: string
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = error ? "failed" : "completed";
    task.output = output;
    task.error = error;
    task.completedAt = Date.now();

    this.tasks.set(taskId, task);

    // Update agent status
    const agent = this.agents.get(task.agentId);
    if (agent) {
      agent.status = "idle";
      this.agents.set(task.agentId, agent);
    }

    // Send completion notification
    this.sendMessage({
      from: task.agentId,
      to: "coordinator",
      type: "response",
      content: { taskId, output, error },
      timestamp: Date.now(),
    });

    // Update goal if linked
    if (task.goalId && this.goalManager) {
      const goalTask = this.goalManager.createTask(task.goalId, task.description);
      this.goalManager.updateTaskStatus(
        goalTask.id,
        error ? "failed" : "completed",
        output,
        error
      );
    }
  }

  private sendMessage(message: SubAgentMessage): void {
    this.messages.push(message);

    // Keep only recent messages (last 100)
    if (this.messages.length > 100) {
      this.messages.shift();
    }
  }

  getMessages(agentId?: string): SubAgentMessage[] {
    if (!agentId) {
      return this.messages;
    }

    return this.messages.filter(
      (m) => m.from === agentId || m.to === agentId
    );
  }

  async createCoordinationPlan(
    mainGoalId: string,
    taskDescriptions: string[]
  ): Promise<AgentCoordinationPlan> {
    const plan: AgentCoordinationPlan = {
      mainGoalId,
      agents: [],
      tasks: [],
      dependencies: new Map(),
    };

    // Assign tasks to appropriate agents based on task type
    for (const description of taskDescriptions) {
      const agentRole = this.determineAgentRole(description);
      const agents = this.getAgentsByRole(agentRole);

      if (agents.length === 0) {
        throw new Error(`No agent available for role: ${agentRole}`);
      }

      const agent = agents[0];
      plan.agents.push(agent);

      // Create task (not delegated yet)
      const task: SubAgentTask = {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        agentId: agent.id,
        goalId: mainGoalId,
        description,
        input: {},
        status: "idle",
        startedAt: Date.now(),
      };

      plan.tasks.push(task);
    }

    return plan;
  }

  private determineAgentRole(taskDescription: string): SubAgentRole {
    const desc = taskDescription.toLowerCase();

    if (
      desc.includes("分析") ||
      desc.includes("诊断") ||
      desc.includes("检查")
    ) {
      return "analyzer";
    }

    if (
      desc.includes("执行") ||
      desc.includes("重启") ||
      desc.includes("扩容") ||
      desc.includes("操作")
    ) {
      return "executor";
    }

    if (
      desc.includes("建议") ||
      desc.includes("推荐") ||
      desc.includes("指导")
    ) {
      return "advisor";
    }

    if (
      desc.includes("规划") ||
      desc.includes("计划") ||
      desc.includes("分解")
    ) {
      return "planner";
    }

    // Default to executor
    return "executor";
  }

  async executePlan(plan: AgentCoordinationPlan): Promise<void> {
    // Execute tasks in order, respecting dependencies
    for (const task of plan.tasks) {
      // Check if dependencies are met
      const deps = plan.dependencies.get(task.id);
      if (deps && deps.length > 0) {
        const allCompleted = deps.every((depId) => {
          const depTask = this.tasks.get(depId);
          return depTask && depTask.status === "completed";
        });

        if (!allCompleted) {
          console.warn(`Task ${task.id} dependencies not met, skipping`);
          continue;
        }
      }

      // Delegate task
      await this.delegateTask(
        task.agentId,
        task.description,
        task.input,
        task.goalId
      );
    }
  }

  getTaskStatus(taskId: string): SubAgentTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): SubAgentTask[] {
    return Array.from(this.tasks.values());
  }

  getTasksForAgent(agentId: string): SubAgentTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.agentId === agentId
    );
  }

  clear(): void {
    // Reset all agents to idle
    for (const agent of this.agents.values()) {
      agent.status = "idle";
      this.agents.set(agent.id, agent);
    }

    this.tasks.clear();
    this.messages = [];
  }
}
