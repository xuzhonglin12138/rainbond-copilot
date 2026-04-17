import type { MemoryManager, ConversationSummary } from "../memory";
import { WS_STORAGE_KEY_PREFIX } from "../workspace/workspace-manager";

export interface ContextComponents {
  agentsDoc?: string;
  rainbondDoc?: string;
  userDoc?: string;
  conversationSummaries?: ConversationSummary[];
  recentMemories?: string[];
  importantMemories?: string[];
}

/**
 * 从 localStorage 中读取工作区文档和记忆，组装 LLM 上下文。
 * workspaceDir 格式：`.workspace/{sessionId}`
 */
export class ContextBuilder {
  constructor(
    private readonly workspaceDir: string,
    private readonly memoryManager?: MemoryManager
  ) {}

  async buildContext(): Promise<ContextComponents> {
    const context: ContextComponents = {};

    // 从 localStorage 读取工作区文档
    context.agentsDoc = this.readWorkspaceFile("AGENTS.md");
    context.rainbondDoc = this.readWorkspaceFile("RAINBOND.md");
    context.userDoc = this.readWorkspaceFile("USER.md");

    // 读取记忆数据
    if (this.memoryManager) {
      context.conversationSummaries =
        await this.memoryManager.getConversationSummaries();

      const recentMemories = await this.memoryManager.getRecentMemories(5);
      context.recentMemories = recentMemories.map(
        (m) => `[${m.type}] ${m.content}`
      );

      const importantMemories = await this.memoryManager.getImportantMemories(5);
      context.importantMemories = importantMemories.map(
        (m) => `[${m.type}] ${m.content}`
      );
    }

    return context;
  }

  private readWorkspaceFile(filename: string): string | undefined {
    const key = `${WS_STORAGE_KEY_PREFIX}${this.workspaceDir}/${filename}`;
    return localStorage.getItem(key) ?? undefined;
  }

  formatContextForPrompt(context: ContextComponents): string {
    const sections: string[] = [];

    if (context.agentsDoc) {
      sections.push(`## Agent 协作信息\n\n${context.agentsDoc}`);
    }

    if (context.rainbondDoc) {
      sections.push(`## Rainbond 环境信息\n\n${context.rainbondDoc}`);
    }

    if (context.userDoc) {
      sections.push(`## 用户偏好和历史\n\n${context.userDoc}`);
    }

    if (
      context.conversationSummaries &&
      context.conversationSummaries.length > 0
    ) {
      const summaries = context.conversationSummaries
        .slice(-3)
        .map(
          (s) =>
            `### 对话摘要 (${new Date(s.timestamp).toLocaleString()})\n${s.summary}\n\n**关键点**:\n${s.keyPoints.map((p) => `- ${p}`).join("\n")}`
        )
        .join("\n\n");

      sections.push(`## 历史对话摘要\n\n${summaries}`);
    }

    if (context.recentMemories && context.recentMemories.length > 0) {
      sections.push(
        `## 最近的交互记录\n\n${context.recentMemories.map((m) => `- ${m}`).join("\n")}`
      );
    }

    if (context.importantMemories && context.importantMemories.length > 0) {
      sections.push(
        `## 重要记忆\n\n${context.importantMemories.map((m) => `- ${m}`).join("\n")}`
      );
    }

    return sections.join("\n\n---\n\n");
  }
}
