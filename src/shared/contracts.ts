import { z } from "zod";

export const drawerEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ui.effect"),
    runId: z.string(),
    effect: z.enum(["highlight_node", "clear_highlight", "focus_panel", "show_step"]),
    payload: z.unknown(),
  }),
  z.object({
    type: z.literal("run.status"),
    runId: z.string(),
    status: z.enum(["thinking", "running", "waiting_approval", "done", "error"]),
  }),
  z.object({
    type: z.literal("chat.message"),
    runId: z.string(),
    role: z.enum(["assistant", "user"]),
    content: z.string(),
  }),
  z.object({
    type: z.literal("chat.trace"),
    runId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    output: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("chat.approval"),
    runId: z.string(),
    approvalId: z.string(),
    skillId: z.string(),
    description: z.string(),
    risk: z.enum(["low", "medium", "high"]),
  }),
  z.object({
    type: z.literal("approval.requested"),
    runId: z.string(),
    approvalId: z.string(),
    skillId: z.string(),
    description: z.string(),
    risk: z.enum(["low", "medium", "high"]),
  }),
  // ── Agentic 能力可见性事件 ─────────────────────────────────────
  // Goal 创建：runtime 接收用户输入后立即 emit
  z.object({
    type: z.literal("goal.created"),
    runId: z.string(),
    goalId: z.string(),
    description: z.string(),
  }),
  // Goal 完成：所有步骤执行结束后 emit
  z.object({
    type: z.literal("goal.completed"),
    runId: z.string(),
    goalId: z.string(),
  }),
  // 记忆写入：重要度 >= 0.7 的记忆存储时 emit
  z.object({
    type: z.literal("memory.stored"),
    runId: z.string(),
    content: z.string(),
    importance: z.number(),
  }),
  z.object({
    type: z.literal("memory.recalled"),
    runId: z.string(),
    query: z.string(),
    entries: z.array(
      z.object({
        content: z.string(),
        relevance: z.number(),
      })
    ),
  }),
  // 反思洞察：执行结束后 analyzePatterns 生成的每条规律
  z.object({
    type: z.literal("reflection.insight"),
    runId: z.string(),
    insight: z.string(),
  }),
]);

export type DrawerEvent = z.infer<typeof drawerEventSchema>;

export const publicCopilotEventSchema = z.object({
  type: z.string(),
  tenantId: z.string(),
  sessionId: z.string(),
  runId: z.string(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string(),
  data: z.record(z.unknown()),
});

export type PublicCopilotEvent = z.infer<typeof publicCopilotEventSchema>;
