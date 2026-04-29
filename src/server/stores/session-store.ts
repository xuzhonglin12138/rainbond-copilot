import type { ApprovalScope, AuthMode, RiskLevel } from "../../shared/types.js";
import type { ChatMessage } from "../../llm/types.js";
import {
  createApprovalLedger,
  type ApprovalLedgerAction,
  type SerializedApprovalLedger,
} from "../runtime/approval-ledger.js";
import type { PendingRunApproval } from "../runtime/run-execution-state.js";
import type { ResolvedExecutionScope } from "../workflows/types.js";

export type SessionRecordStatus = "active" | "archived";
export type PendingWorkflowActionKind = "mcp_tool" | "action_skill";

export interface PendingWorkflowAction {
  kind?: PendingWorkflowActionKind;
  toolName: string;
  toolCallId?: string;
  requiresApproval: boolean;
  risk?: RiskLevel;
  scope?: ApprovalScope;
  description?: string;
  arguments: Record<string, unknown>;
  followUpActions?: PendingWorkflowAction[];
}

export interface PendingLlmContinuation {
  iteration: number;
  messages: ChatMessage[];
}

export interface SuggestedWorkflowAction {
  optionKey?: string;
  label?: string;
  description: string;
  recommended?: boolean;
  pendingAction: PendingWorkflowAction;
}

export interface PendingWorkflowContinuation {
  workflowId: string;
  selectedWorkflow?: string;
  nextAction?: string;
  summary: string;
  subflowData?: Record<string, unknown>;
  toolCalls?: Array<{ name: string; status: string }>;
  suggestedActions?: SuggestedWorkflowAction[];
}

export interface SessionRecord {
  sessionId: string;
  tenantId: string;
  userId: string;
  username?: string;
  sourceSystem: string;
  authMode?: AuthMode;
  teamName?: string;
  context?: Record<string, unknown>;
  contextSignature?: string;
  lastVerifiedScopeSignature?: string;
  verifiedScope?: ResolvedExecutionScope;
  approvalLedger?: SerializedApprovalLedger;
  pendingWorkflowAction?: PendingWorkflowAction;
  pendingLlmContinuation?: PendingLlmContinuation;
  pendingWorkflowContinuation?: PendingWorkflowContinuation;
  chatHistory?: ChatMessage[];
  status: SessionRecordStatus;
  latestRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionRecordInput {
  sessionId: string;
  tenantId: string;
  userId: string;
  username?: string;
  sourceSystem: string;
  authMode?: AuthMode;
  teamName?: string;
  context?: Record<string, unknown>;
  contextSignature?: string;
  lastVerifiedScopeSignature?: string;
  verifiedScope?: ResolvedExecutionScope;
  approvalLedger?: SerializedApprovalLedger;
  pendingWorkflowAction?: PendingWorkflowAction;
  pendingLlmContinuation?: PendingLlmContinuation;
  pendingWorkflowContinuation?: PendingWorkflowContinuation;
  chatHistory?: ChatMessage[];
  status?: SessionRecordStatus;
  latestRunId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionStore {
  create(session: SessionRecord): Promise<void>;
  getById(sessionId: string, tenantId: string): Promise<SessionRecord | null>;
  update(session: SessionRecord): Promise<void>;
}

export function cloneChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    ...(message.tool_calls
      ? {
          tool_calls: message.tool_calls.map((toolCall) => ({
            ...toolCall,
            function: {
              ...toolCall.function,
            },
          })),
        }
      : {}),
  }));
}

export function deriveCompletedToolCallIds(messages: ChatMessage[]): string[] {
  return messages
    .filter((message) => message.role === "tool" && !!message.tool_call_id)
    .map((message) => String(message.tool_call_id));
}

function toPendingWorkflowActionFromApprovalLedger(
  action: ApprovalLedgerAction
): PendingWorkflowAction {
  return {
    kind: action.kind,
    toolName: action.toolName,
    toolCallId: action.toolCallId,
    requiresApproval: true,
    risk: action.risk,
    scope: action.scope,
    description: action.description,
    arguments: action.arguments ? { ...action.arguments } : {},
    followUpActions: action.followUpActions?.map((item) =>
      toPendingWorkflowActionFromApprovalLedger(item)
    ),
  };
}

export function toRunPendingApproval(
  action: PendingWorkflowAction
): PendingRunApproval {
  return {
    kind: action.kind,
    toolName: action.toolName,
    toolCallId: action.toolCallId || action.toolName,
    requiresApproval: action.requiresApproval,
    risk: action.risk || "medium",
    scope: action.scope,
    description: action.description,
    arguments: { ...action.arguments },
    followUpActions: action.followUpActions?.map((item) =>
      toRunPendingApproval(item)
    ),
  };
}

export function toPendingWorkflowActionFromRunApproval(
  approval: PendingRunApproval
): PendingWorkflowAction {
  return {
    kind: approval.kind,
    toolName: approval.toolName,
    toolCallId: approval.toolCallId,
    requiresApproval: approval.requiresApproval !== false,
    risk: approval.risk,
    scope: approval.scope,
    description: approval.description,
    arguments: { ...approval.arguments },
    followUpActions: approval.followUpActions?.map((item) =>
      toPendingWorkflowActionFromRunApproval(item)
    ),
  };
}

function derivePendingWorkflowAction(
  approvalLedger?: SerializedApprovalLedger
): PendingWorkflowAction | undefined {
  const firstPendingApproval = createApprovalLedger(approvalLedger).getPending()[0];

  return firstPendingApproval
    ? toPendingWorkflowActionFromApprovalLedger(firstPendingApproval)
    : undefined;
}

export function normalizeSessionRecord(session: SessionRecord): SessionRecord {
  return {
    ...session,
    chatHistory: normalizeChatHistory(session.chatHistory),
    pendingWorkflowAction:
      session.pendingWorkflowAction ??
      derivePendingWorkflowAction(session.approvalLedger),
  };
}

export function createSessionRecord(
  input: CreateSessionRecordInput
): SessionRecord {
  const now = input.createdAt ?? new Date().toISOString();

  return normalizeSessionRecord({
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    userId: input.userId,
    username: input.username,
    sourceSystem: input.sourceSystem,
    authMode: input.authMode,
    teamName: input.teamName,
    context: input.context,
    contextSignature: input.contextSignature,
    lastVerifiedScopeSignature: input.lastVerifiedScopeSignature,
    verifiedScope: input.verifiedScope,
    approvalLedger: input.approvalLedger,
    pendingWorkflowAction: input.pendingWorkflowAction,
    pendingLlmContinuation: input.pendingLlmContinuation,
    pendingWorkflowContinuation: input.pendingWorkflowContinuation,
    chatHistory: normalizeChatHistory(input.chatHistory),
    status: input.status ?? "active",
    latestRunId: input.latestRunId,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
  });
}

const MAX_CHAT_HISTORY_MESSAGES = 12;

export function normalizeChatHistory(
  messages?: ChatMessage[]
): ChatMessage[] | undefined {
  if (!Array.isArray(messages) || messages.length === 0) {
    return undefined;
  }

  const filtered = messages
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({
      role: message.role,
      content: message.content || "",
    } satisfies ChatMessage));

  if (filtered.length === 0) {
    return undefined;
  }

  return filtered.slice(-MAX_CHAT_HISTORY_MESSAGES);
}

export function appendChatHistoryTurn(
  existingHistory: ChatMessage[] | undefined,
  turn: ChatMessage[]
): ChatMessage[] {
  const normalizedExisting = normalizeChatHistory(existingHistory) || [];
  const normalizedTurn = normalizeChatHistory(turn) || [];
  return normalizeChatHistory([
    ...normalizedExisting,
    ...normalizedTurn,
  ]) || [];
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>();

  async create(session: SessionRecord): Promise<void> {
    this.sessions.set(
      this.key(session.sessionId, session.tenantId),
      normalizeSessionRecord(session)
    );
  }

  async getById(
    sessionId: string,
    tenantId: string
  ): Promise<SessionRecord | null> {
    const session = this.sessions.get(this.key(sessionId, tenantId));
    return session ? normalizeSessionRecord(session) : null;
  }

  async update(session: SessionRecord): Promise<void> {
    this.sessions.set(
      this.key(session.sessionId, session.tenantId),
      normalizeSessionRecord(session)
    );
  }

  private key(sessionId: string, tenantId: string): string {
    return `${tenantId}:${sessionId}`;
  }
}

export function createInMemorySessionStore(): SessionStore {
  return new InMemorySessionStore();
}
