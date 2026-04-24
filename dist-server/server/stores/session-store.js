export function createSessionRecord(input) {
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
export class InMemorySessionStore {
    constructor() {
        this.sessions = new Map();
    }
    async create(session) {
        this.sessions.set(this.key(session.sessionId, session.tenantId), session);
    }
    async getById(sessionId, tenantId) {
        return this.sessions.get(this.key(sessionId, tenantId)) ?? null;
    }
    async update(session) {
        this.sessions.set(this.key(session.sessionId, session.tenantId), session);
    }
    key(sessionId, tenantId) {
        return `${tenantId}:${sessionId}`;
    }
}
export function createInMemorySessionStore() {
    return new InMemorySessionStore();
}
