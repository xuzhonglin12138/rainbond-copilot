import type {
  MemoryEntry,
  WorkspaceMemory,
  MemoryQuery,
  MemorySearchResult,
  ConversationSummary,
} from "./types";

const SHORT_TERM_LIMIT = 50; // Keep last 50 entries in short-term
const LONG_TERM_THRESHOLD = 0.7; // Importance threshold for long-term storage
const STORAGE_KEY_PREFIX = "rainagent:mem:";

export class MemoryManager {
  private memory: WorkspaceMemory | null = null;
  private storageKey: string;

  constructor(
    // workspaceDir kept for API compatibility but unused in browser
    _workspaceDir: string,
    private readonly sessionId: string
  ) {
    this.storageKey = `${STORAGE_KEY_PREFIX}${sessionId}`;
  }

  async initialize(): Promise<void> {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      try {
        this.memory = JSON.parse(stored);
      } catch {
        this.memory = this.createEmptyMemory();
      }
    } else {
      this.memory = this.createEmptyMemory();
      this.persist();
    }
  }

  private createEmptyMemory(): WorkspaceMemory {
    return {
      sessionId: this.sessionId,
      shortTermMemory: [],
      longTermMemory: [],
      conversationSummaries: [],
      userPreferences: {},
      lastUpdated: Date.now(),
    };
  }

  async addMemory(
    type: MemoryEntry["type"],
    content: string,
    importance: number = 0.5,
    metadata?: Record<string, unknown>,
    tags?: string[]
  ): Promise<void> {
    if (!this.memory) {
      throw new Error("Memory not initialized");
    }

    const entry: MemoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type,
      content,
      importance,
      metadata,
      tags,
    };

    // Add to short-term memory
    this.memory.shortTermMemory.push(entry);

    // If importance is high, also add to long-term
    if (importance >= LONG_TERM_THRESHOLD) {
      this.memory.longTermMemory.push(entry);
    }

    // Trim short-term memory if too large
    if (this.memory.shortTermMemory.length > SHORT_TERM_LIMIT) {
      const removed = this.memory.shortTermMemory.shift();
      if (removed && removed.importance >= LONG_TERM_THRESHOLD) {
        if (!this.memory.longTermMemory.find((e) => e.id === removed.id)) {
          this.memory.longTermMemory.push(removed);
        }
      }
    }

    this.memory.lastUpdated = Date.now();
    this.persist();
  }

  async search(query: MemoryQuery): Promise<MemorySearchResult[]> {
    if (!this.memory) {
      throw new Error("Memory not initialized");
    }

    const allMemories = [
      ...this.memory.shortTermMemory,
      ...this.memory.longTermMemory,
    ];

    let filtered = allMemories;

    if (query.type) {
      filtered = filtered.filter((e) => e.type === query.type);
    }

    if (query.tags && query.tags.length > 0) {
      filtered = filtered.filter(
        (e) => e.tags && query.tags!.some((tag) => e.tags!.includes(tag))
      );
    }

    if (query.minImportance !== undefined) {
      filtered = filtered.filter((e) => e.importance >= query.minImportance!);
    }

    const results: MemorySearchResult[] = filtered.map((entry) => {
      const relevance = this.calculateRelevance(entry, query.query);
      return { entry, relevance };
    });

    results.sort((a, b) => b.relevance - a.relevance);

    const limit = query.limit || 10;
    return results.slice(0, limit);
  }

  async recallRelevantMemories(
    query: string,
    options?: {
      limit?: number;
      minRelevance?: number;
      minImportance?: number;
    }
  ): Promise<MemorySearchResult[]> {
    const results = await this.search({
      query,
      limit: options?.limit ?? 5,
      minImportance: options?.minImportance ?? 0.4,
    });

    const minRelevance = options?.minRelevance ?? 0.25;
    return results.filter((result) => result.relevance >= minRelevance);
  }

  private calculateRelevance(entry: MemoryEntry, query: string): number {
    const queryLower = query.toLowerCase();
    const contentLower = entry.content.toLowerCase();

    const keywords = queryLower.split(/\s+/);
    let matches = 0;

    for (const keyword of keywords) {
      if (contentLower.includes(keyword)) {
        matches++;
      }
    }

    const keywordRelevance = keywords.length > 0 ? matches / keywords.length : 0;
    const recencyScore = 1 - (Date.now() - entry.timestamp) / (7 * 24 * 60 * 60 * 1000);
    const recencyWeight = Math.max(0, Math.min(1, recencyScore));

    return keywordRelevance * 0.6 + entry.importance * 0.3 + recencyWeight * 0.1;
  }

  async addConversationSummary(
    summary: string,
    keyPoints: string[],
    messageCount: number
  ): Promise<void> {
    if (!this.memory) {
      throw new Error("Memory not initialized");
    }

    const summaryEntry: ConversationSummary = {
      sessionId: this.sessionId,
      summary,
      keyPoints,
      timestamp: Date.now(),
      messageCount,
    };

    this.memory.conversationSummaries.push(summaryEntry);
    this.memory.lastUpdated = Date.now();
    this.persist();
  }

  async getRecentMemories(limit: number = 10): Promise<MemoryEntry[]> {
    if (!this.memory) {
      throw new Error("Memory not initialized");
    }
    return this.memory.shortTermMemory.slice(-limit);
  }

  async getImportantMemories(limit: number = 10): Promise<MemoryEntry[]> {
    if (!this.memory) {
      throw new Error("Memory not initialized");
    }
    return this.memory.longTermMemory
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
  }

  async getConversationSummaries(): Promise<ConversationSummary[]> {
    if (!this.memory) {
      throw new Error("Memory not initialized");
    }
    return this.memory.conversationSummaries;
  }

  async updateUserPreference(key: string, value: unknown): Promise<void> {
    if (!this.memory) {
      throw new Error("Memory not initialized");
    }
    this.memory.userPreferences[key] = value;
    this.memory.lastUpdated = Date.now();
    this.persist();
  }

  async getUserPreferences(): Promise<Record<string, unknown>> {
    if (!this.memory) {
      throw new Error("Memory not initialized");
    }
    return this.memory.userPreferences;
  }

  private persist(): void {
    if (!this.memory) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.memory));
    } catch (e) {
      console.warn("Failed to persist memory to localStorage:", e);
    }
  }

  async clear(): Promise<void> {
    if (!this.memory) return;
    this.memory.shortTermMemory = [];
    this.memory.longTermMemory = [];
    this.memory.conversationSummaries = [];
    this.memory.lastUpdated = Date.now();
    this.persist();
  }
}
