import type { Goal, Task, GoalStatus, GoalProgress } from "./types";

export class GoalManager {
  private goals: Map<string, Goal> = new Map();
  private tasks: Map<string, Task> = new Map();

  createGoal(
    description: string,
    priority: number = 5,
    parentGoalId?: string,
    dependencies?: string[]
  ): Goal {
    const goal: Goal = {
      id: `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      description,
      status: "pending",
      priority,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parentGoalId,
      dependencies,
    };

    this.goals.set(goal.id, goal);
    return goal;
  }

  updateGoalStatus(goalId: string, status: GoalStatus): void {
    const goal = this.goals.get(goalId);
    if (!goal) {
      throw new Error(`Goal ${goalId} not found`);
    }

    goal.status = status;
    goal.updatedAt = Date.now();

    if (status === "completed" || status === "failed") {
      goal.completedAt = Date.now();
    }

    this.goals.set(goalId, goal);
  }

  createTask(goalId: string, description: string): Task {
    const goal = this.goals.get(goalId);
    if (!goal) {
      throw new Error(`Goal ${goalId} not found`);
    }

    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      goalId,
      description,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(task.id, task);

    // Update goal status to in_progress if it was pending
    if (goal.status === "pending") {
      this.updateGoalStatus(goalId, "in_progress");
    }

    return task;
  }

  updateTaskStatus(
    taskId: string,
    status: GoalStatus,
    result?: unknown,
    error?: string
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = status;
    task.updatedAt = Date.now();
    task.result = result;
    task.error = error;

    if (status === "completed" || status === "failed") {
      task.completedAt = Date.now();
    }

    this.tasks.set(taskId, task);

    // Check if all tasks for the goal are completed
    this.checkGoalCompletion(task.goalId);
  }

  private checkGoalCompletion(goalId: string): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;

    const goalTasks = this.getTasksForGoal(goalId);
    if (goalTasks.length === 0) return;

    const allCompleted = goalTasks.every((t) => t.status === "completed");
    const anyFailed = goalTasks.some((t) => t.status === "failed");

    if (allCompleted) {
      this.updateGoalStatus(goalId, "completed");
    } else if (anyFailed) {
      this.updateGoalStatus(goalId, "failed");
    }
  }

  getGoal(goalId: string): Goal | undefined {
    return this.goals.get(goalId);
  }

  getTasksForGoal(goalId: string): Task[] {
    return Array.from(this.tasks.values()).filter((t) => t.goalId === goalId);
  }

  getSubGoals(parentGoalId: string): Goal[] {
    return Array.from(this.goals.values()).filter(
      (g) => g.parentGoalId === parentGoalId
    );
  }

  getGoalProgress(goalId: string): GoalProgress | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;

    const tasks = this.getTasksForGoal(goalId);
    const subGoals = this.getSubGoals(goalId);

    const completedTasks = tasks.filter((t) => t.status === "completed").length;
    const completedSubGoals = subGoals.filter(
      (g) => g.status === "completed"
    ).length;

    const totalItems = tasks.length + subGoals.length;
    const completedItems = completedTasks + completedSubGoals;

    const completionPercentage =
      totalItems > 0 ? (completedItems / totalItems) * 100 : 0;

    // Check for blocked dependencies
    const blockedBy: string[] = [];
    if (goal.dependencies) {
      for (const depId of goal.dependencies) {
        const dep = this.goals.get(depId);
        if (dep && dep.status !== "completed") {
          blockedBy.push(depId);
        }
      }
    }

    return {
      goal,
      tasks,
      subGoals,
      completionPercentage,
      blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
    };
  }

  getActiveGoals(): Goal[] {
    return Array.from(this.goals.values()).filter(
      (g) => g.status === "in_progress" || g.status === "pending"
    );
  }

  getPrioritizedGoals(): Goal[] {
    const activeGoals = this.getActiveGoals();

    // Filter out blocked goals
    const unblocked = activeGoals.filter((goal) => {
      if (!goal.dependencies) return true;

      return goal.dependencies.every((depId) => {
        const dep = this.goals.get(depId);
        return dep && dep.status === "completed";
      });
    });

    // Sort by priority (higher first)
    return unblocked.sort((a, b) => b.priority - a.priority);
  }

  decomposeGoal(goalId: string, subGoalDescriptions: string[]): Goal[] {
    const parentGoal = this.goals.get(goalId);
    if (!parentGoal) {
      throw new Error(`Goal ${goalId} not found`);
    }

    const subGoals: Goal[] = [];

    for (const description of subGoalDescriptions) {
      const subGoal = this.createGoal(
        description,
        parentGoal.priority,
        goalId
      );
      subGoals.push(subGoal);
    }

    return subGoals;
  }

  clear(): void {
    this.goals.clear();
    this.tasks.clear();
  }

  getAllGoals(): Goal[] {
    return Array.from(this.goals.values());
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
}
