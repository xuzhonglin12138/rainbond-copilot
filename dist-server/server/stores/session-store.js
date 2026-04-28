import { createApprovalLedger, } from "../runtime/approval-ledger.js";
export function cloneChatMessages(messages) {
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
export function deriveCompletedToolCallIds(messages) {
    return messages
        .filter((message) => message.role === "tool" && !!message.tool_call_id)
        .map((message) => String(message.tool_call_id));
}
function toPendingWorkflowActionFromApprovalLedger(action) {
    return {
        kind: action.kind,
        toolName: action.toolName,
        toolCallId: action.toolCallId,
        requiresApproval: true,
        risk: action.risk,
        scope: action.scope,
        description: action.description,
        arguments: action.arguments ? { ...action.arguments } : {},
        followUpActions: action.followUpActions?.map((item) => toPendingWorkflowActionFromApprovalLedger(item)),
    };
}
export function toRunPendingApproval(action) {
    return {
        kind: action.kind,
        toolName: action.toolName,
        toolCallId: action.toolCallId || action.toolName,
        requiresApproval: action.requiresApproval,
        risk: action.risk || "medium",
        scope: action.scope,
        description: action.description,
        arguments: { ...action.arguments },
        followUpActions: action.followUpActions?.map((item) => toRunPendingApproval(item)),
    };
}
export function toPendingWorkflowActionFromRunApproval(approval) {
    return {
        kind: approval.kind,
        toolName: approval.toolName,
        toolCallId: approval.toolCallId,
        requiresApproval: approval.requiresApproval !== false,
        risk: approval.risk,
        scope: approval.scope,
        description: approval.description,
        arguments: { ...approval.arguments },
        followUpActions: approval.followUpActions?.map((item) => toPendingWorkflowActionFromRunApproval(item)),
    };
}
function derivePendingWorkflowAction(approvalLedger) {
    const firstPendingApproval = createApprovalLedger(approvalLedger).getPending()[0];
    return firstPendingApproval
        ? toPendingWorkflowActionFromApprovalLedger(firstPendingApproval)
        : undefined;
}
export function normalizeSessionRecord(session) {
    return {
        ...session,
        pendingWorkflowAction: session.pendingWorkflowAction ??
            derivePendingWorkflowAction(session.approvalLedger),
    };
}
export function createSessionRecord(input) {
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
        status: input.status ?? "active",
        latestRunId: input.latestRunId,
        createdAt: now,
        updatedAt: input.updatedAt ?? now,
    });
}
export class InMemorySessionStore {
    constructor() {
        this.sessions = new Map();
    }
    async create(session) {
        this.sessions.set(this.key(session.sessionId, session.tenantId), normalizeSessionRecord(session));
    }
    async getById(sessionId, tenantId) {
        const session = this.sessions.get(this.key(sessionId, tenantId));
        return session ? normalizeSessionRecord(session) : null;
    }
    async update(session) {
        this.sessions.set(this.key(session.sessionId, session.tenantId), normalizeSessionRecord(session));
    }
    key(sessionId, tenantId) {
        return `${tenantId}:${sessionId}`;
    }
}
export function createInMemorySessionStore() {
    return new InMemorySessionStore();
}
