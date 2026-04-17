// Memory System Types

export interface MemoryEntry {
  id: string;
  timestamp: number;
  type: "observation" | "action" | "reflection" | "learning";
  content: string;
  metadata?: Record<string, unknown>;
  importance: number; // 0-1, for memory prioritization
  tags?: string[];
}

export interface ConversationSummary {
  sessionId: string;
  summary: string;
  keyPoints: string[];
  timestamp: number;
  messageCount: number;
}

export interface WorkspaceMemory {
  sessionId: string;
  shortTermMemory: MemoryEntry[]; // Recent interactions
  longTermMemory: MemoryEntry[]; // Important learnings
  conversationSummaries: ConversationSummary[];
  userPreferences: Record<string, unknown>;
  lastUpdated: number;
}

export interface MemoryQuery {
  query: string;
  type?: MemoryEntry["type"];
  tags?: string[];
  limit?: number;
  minImportance?: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  relevance: number;
}
