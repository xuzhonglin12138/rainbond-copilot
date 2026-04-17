// Reflection Types

export interface ActionReflection {
  actionId: string;
  actionType: string;
  timestamp: number;
  success: boolean;
  input: unknown;
  output?: unknown;
  error?: string;
  duration: number;
  learnings?: string[];
}

export interface ConversationReflection {
  sessionId: string;
  timestamp: number;
  userSatisfaction?: number; // 1-5 rating
  issuesEncountered: string[];
  successfulPatterns: string[];
  improvementAreas: string[];
}

export interface PerformanceMetrics {
  totalActions: number;
  successfulActions: number;
  failedActions: number;
  averageResponseTime: number;
  commonErrors: Map<string, number>;
  mostUsedSkills: Map<string, number>;
}

export interface ReflectionInsight {
  id: string;
  type: "pattern" | "error" | "improvement" | "learning";
  content: string;
  confidence: number; // 0-1
  timestamp: number;
  relatedActions: string[];
}
