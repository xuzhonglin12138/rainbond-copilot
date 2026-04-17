import { EnhancedAgentRuntime } from "../runtime/enhanced-agent-runtime";
import { MemorySessionStore } from "../session/memory-session-store";
import type { DrawerEvent } from "../shared/contracts";
import { drawerEventSchema } from "../shared/contracts";

export class InProcessGateway {
  private runtimes = new Map<string, EnhancedAgentRuntime>();
  private sessionStore = new MemorySessionStore();
  // 存储待审批的 Promise resolver，key 为 approvalId
  private pendingApprovals = new Map<string, {
    sessionId: string;
    resolve: (approved: boolean) => void;
  }>();

  /**
   * 按 sessionId 获取或创建 EnhancedAgentRuntime。
   * 每个 session 独立一个 runtime 实例，保证会话隔离。
   */
  private getOrCreateRuntime(sessionId: string): EnhancedAgentRuntime {
    if (!this.runtimes.has(sessionId)) {
      const runtime = new EnhancedAgentRuntime({
        sessionId,
        workspaceDir: `.workspace/${sessionId}`,
        enableMemory: true,
        enableGoals: true,
        enableReflection: true,
        enableSubAgents: true,
        // 当 runtime 需要审批时，挂起 Promise 等待 handleApproval 解析
        onApprovalRequest: async ({ approvalId }) => {
          return new Promise<boolean>((resolve) => {
            this.pendingApprovals.set(approvalId, { sessionId, resolve });
          });
        },
      });
      this.runtimes.set(sessionId, runtime);
    }
    return this.runtimes.get(sessionId)!;
  }

  async handleMessage(sessionId: string, userMessage: string): Promise<DrawerEvent[]> {
    // 确保 session 存在
    let session = await this.sessionStore.getSession(sessionId);
    if (!session) {
      session = await this.sessionStore.createSession(sessionId);
    }

    const runtime = this.getOrCreateRuntime(sessionId);
    const runtimeEvents = await runtime.run(userMessage);

    // 将 runtime events 归一化为 drawer events
    const drawerEvents: DrawerEvent[] = [];
    for (const event of runtimeEvents) {
      try {
        const normalized = drawerEventSchema.parse(event);
        drawerEvents.push(normalized);
      } catch {
        // 跳过不符合 drawer schema 的事件
      }
    }

    return drawerEvents;
  }

  async handleApproval(
    sessionId: string,
    approvalId: string,
    approved: boolean
  ): Promise<DrawerEvent[]> {
    const pending = this.pendingApprovals.get(approvalId);

    if (!pending || pending.sessionId !== sessionId) {
      return [
        {
          type: "chat.message",
          runId: "run-error",
          role: "assistant",
          content: "审批请求未找到或已过期",
        },
      ];
    }

    // 移除并解析 Promise，让 runtime 继续执行
    this.pendingApprovals.delete(approvalId);
    pending.resolve(approved);

    return [
      {
        type: "chat.message",
        runId: `run-${approvalId}`,
        role: "assistant",
        content: approved ? "审批已通过，继续执行" : "审批被拒绝，操作已取消",
      },
    ];
  }

  /**
   * 清理指定 session 的 runtime（释放内存）
   */
  destroySession(sessionId: string): void {
    this.runtimes.delete(sessionId);
    // 拒绝该 session 所有挂起的审批
    for (const [approvalId, pending] of this.pendingApprovals.entries()) {
      if (pending.sessionId === sessionId) {
        pending.resolve(false);
        this.pendingApprovals.delete(approvalId);
      }
    }
  }
}
