import type { ApprovalScope, AuthMode, RiskLevel } from "../../shared/types.js";
import type { ChatMessage } from "../../llm/types.js";
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
  pendingWorkflowAction?: PendingWorkflowAction;
  pendingLlmContinuation?: PendingLlmContinuation;
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
  pendingWorkflowAction?: PendingWorkflowAction;
  pendingLlmContinuation?: PendingLlmContinuation;
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

export function createSessionRecord(
  input: CreateSessionRecordInput
): SessionRecord {
  const now = input.createdAt ?? new Date().toISOString();

  return {
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
    pendingWorkflowAction: input.pendingWorkflowAction,
    pendingLlmContinuation: input.pendingLlmContinuation,
    status: input.status ?? "active",
    latestRunId: input.latestRunId,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
  };
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>();

  async create(session: SessionRecord): Promise<void> {
    this.sessions.set(this.key(session.sessionId, session.tenantId), session);
  }

  async getById(
    sessionId: string,
    tenantId: string
  ): Promise<SessionRecord | null> {
    return this.sessions.get(this.key(sessionId, tenantId)) ?? null;
  }

  async update(session: SessionRecord): Promise<void> {
    this.sessions.set(this.key(session.sessionId, session.tenantId), session);
  }

  private key(sessionId: string, tenantId: string): string {
    return `${tenantId}:${sessionId}`;
  }
}

export function createInMemorySessionStore(): SessionStore {
  return new InMemorySessionStore();
}
