import type {
  ActionReflection,
  ConversationReflection,
  PerformanceMetrics,
  ReflectionInsight,
} from "./types";
import type { MemoryManager } from "../memory";

export class ReflectionEngine {
  private actionHistory: ActionReflection[] = [];
  private conversationReflections: ConversationReflection[] = [];
  private insights: ReflectionInsight[] = [];

  constructor(private readonly memoryManager?: MemoryManager) {}

  async recordAction(
    actionId: string,
    actionType: string,
    success: boolean,
    input: unknown,
    output?: unknown,
    error?: string,
    duration: number = 0
  ): Promise<void> {
    const reflection: ActionReflection = {
      actionId,
      actionType,
      timestamp: Date.now(),
      success,
      input,
      output,
      error,
      duration,
    };

    this.actionHistory.push(reflection);

    // Analyze and extract learnings
    if (!success && error) {
      const learning = await this.analyzeFailure(reflection);
      if (learning) {
        reflection.learnings = [learning];

        // Store in memory
        if (this.memoryManager) {
          await this.memoryManager.addMemory(
            "learning",
            learning,
            0.8,
            { actionId, actionType, error },
            ["error", "learning"]
          );
        }
      }
    }

    // Keep only recent history (last 100 actions)
    if (this.actionHistory.length > 100) {
      this.actionHistory.shift();
    }
  }

  private async analyzeFailure(
    reflection: ActionReflection
  ): Promise<string | undefined> {
    if (!reflection.error) return undefined;

    // Pattern matching for common errors
    const error = reflection.error.toLowerCase();

    if (error.includes("timeout") || error.includes("timed out")) {
      return `${reflection.actionType} 操作超时，可能需要增加超时时间或优化查询`;
    }

    if (error.includes("not found") || error.includes("404")) {
      return `${reflection.actionType} 找不到资源，需要先验证资源是否存在`;
    }

    if (error.includes("permission") || error.includes("unauthorized")) {
      return `${reflection.actionType} 权限不足，需要检查用户权限配置`;
    }

    if (error.includes("memory") || error.includes("oom")) {
      return `${reflection.actionType} 内存不足，建议扩容或优化资源使用`;
    }

    return `${reflection.actionType} 失败: ${reflection.error}`;
  }

  async recordConversationReflection(
    sessionId: string,
    issuesEncountered: string[],
    successfulPatterns: string[],
    improvementAreas: string[],
    userSatisfaction?: number
  ): Promise<void> {
    const reflection: ConversationReflection = {
      sessionId,
      timestamp: Date.now(),
      userSatisfaction,
      issuesEncountered,
      successfulPatterns,
      improvementAreas,
    };

    this.conversationReflections.push(reflection);

    // Generate insights from patterns
    for (const pattern of successfulPatterns) {
      await this.addInsight("pattern", pattern, 0.8, []);
    }

    for (const improvement of improvementAreas) {
      await this.addInsight("improvement", improvement, 0.7, []);
    }

    // Store in memory
    if (this.memoryManager) {
      await this.memoryManager.addMemory(
        "reflection",
        `对话反思: 成功模式 ${successfulPatterns.length} 个, 改进点 ${improvementAreas.length} 个`,
        0.7,
        { sessionId, userSatisfaction },
        ["reflection", "conversation"]
      );
    }
  }

  private async addInsight(
    type: ReflectionInsight["type"],
    content: string,
    confidence: number,
    relatedActions: string[]
  ): Promise<void> {
    const insight: ReflectionInsight = {
      id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      content,
      confidence,
      timestamp: Date.now(),
      relatedActions,
    };

    this.insights.push(insight);

    // Store high-confidence insights in memory
    if (confidence >= 0.7 && this.memoryManager) {
      await this.memoryManager.addMemory(
        "learning",
        content,
        confidence,
        { insightType: type },
        ["insight", type]
      );
    }

    // Keep only recent insights (last 50)
    if (this.insights.length > 50) {
      this.insights.shift();
    }
  }

  getPerformanceMetrics(): PerformanceMetrics {
    const totalActions = this.actionHistory.length;
    const successfulActions = this.actionHistory.filter((a) => a.success).length;
    const failedActions = totalActions - successfulActions;

    const totalDuration = this.actionHistory.reduce(
      (sum, a) => sum + a.duration,
      0
    );
    const averageResponseTime =
      totalActions > 0 ? totalDuration / totalActions : 0;

    // Count common errors
    const commonErrors = new Map<string, number>();
    for (const action of this.actionHistory) {
      if (!action.success && action.error) {
        const count = commonErrors.get(action.error) || 0;
        commonErrors.set(action.error, count + 1);
      }
    }

    // Count most used skills
    const mostUsedSkills = new Map<string, number>();
    for (const action of this.actionHistory) {
      const count = mostUsedSkills.get(action.actionType) || 0;
      mostUsedSkills.set(action.actionType, count + 1);
    }

    return {
      totalActions,
      successfulActions,
      failedActions,
      averageResponseTime,
      commonErrors,
      mostUsedSkills,
    };
  }

  getRecentInsights(limit: number = 10): ReflectionInsight[] {
    return this.insights
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getHighConfidenceInsights(minConfidence: number = 0.7): ReflectionInsight[] {
    return this.insights
      .filter((i) => i.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  async analyzePatterns(): Promise<string[]> {
    const patterns: string[] = [];
    const metrics = this.getPerformanceMetrics();

    // Analyze success rate
    const successRate =
      metrics.totalActions > 0
        ? metrics.successfulActions / metrics.totalActions
        : 0;

    if (successRate < 0.7) {
      patterns.push(
        `成功率较低 (${(successRate * 100).toFixed(1)}%)，需要改进错误处理`
      );
    }

    // Analyze common errors
    if (metrics.commonErrors.size > 0) {
      const topError = Array.from(metrics.commonErrors.entries()).sort(
        (a, b) => b[1] - a[1]
      )[0];
      patterns.push(`最常见错误: ${topError[0]} (出现 ${topError[1]} 次)`);
    }

    // Analyze skill usage
    if (metrics.mostUsedSkills.size > 0) {
      const topSkill = Array.from(metrics.mostUsedSkills.entries()).sort(
        (a, b) => b[1] - a[1]
      )[0];
      patterns.push(`最常用技能: ${topSkill[0]} (使用 ${topSkill[1]} 次)`);
    }

    return patterns;
  }

  clear(): void {
    this.actionHistory = [];
    this.conversationReflections = [];
    this.insights = [];
  }
}
