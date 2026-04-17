// Goal Management Types

export type GoalStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked";

export interface Goal {
  id: string;
  description: string;
  status: GoalStatus;
  priority: number; // 1-10, higher is more important
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  parentGoalId?: string; // For sub-goals
  dependencies?: string[]; // IDs of goals that must complete first
  metadata?: Record<string, unknown>;
}

export interface Task {
  id: string;
  goalId: string;
  description: string;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

export interface GoalProgress {
  goal: Goal;
  tasks: Task[];
  subGoals: Goal[];
  completionPercentage: number;
  blockedBy?: string[];
}
