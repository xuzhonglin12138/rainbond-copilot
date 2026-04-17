// Sub-agent System Types

export type SubAgentRole =
  | "planner" // 规划和任务分解
  | "executor" // 执行具体操作
  | "analyzer" // 分析和诊断
  | "advisor"; // 提供建议和指导

export type SubAgentStatus = "idle" | "working" | "completed" | "failed";

export interface SubAgentCapability {
  name: string;
  description: string;
  skills: string[]; // Skill IDs this agent can use
}

export interface SubAgent {
  id: string;
  role: SubAgentRole;
  name: string;
  description: string;
  capabilities: SubAgentCapability[];
  status: SubAgentStatus;
  createdAt: number;
  parentAgentId?: string;
}

export interface SubAgentTask {
  id: string;
  agentId: string;
  goalId?: string;
  description: string;
  input: unknown;
  output?: unknown;
  error?: string;
  status: SubAgentStatus;
  startedAt: number;
  completedAt?: number;
}

export interface SubAgentMessage {
  from: string; // Agent ID
  to: string; // Agent ID or "coordinator"
  type: "request" | "response" | "notification";
  content: unknown;
  timestamp: number;
}

export interface AgentCoordinationPlan {
  mainGoalId: string;
  agents: SubAgent[];
  tasks: SubAgentTask[];
  dependencies: Map<string, string[]>; // taskId -> dependent taskIds
}
