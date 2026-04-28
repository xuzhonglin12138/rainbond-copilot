import { createServerId } from "../utils/id.js";
import { buildExecutionScopeCandidate, buildScopeSignature } from "../workflows/context-resolver.js";
import { createSessionRecord, } from "../stores/session-store.js";
export class CopilotSessionService {
    constructor(sessionStore) {
        this.sessionStore = sessionStore;
    }
    async createSession(input) {
        const candidateScope = buildExecutionScopeCandidate({
            uiContext: input.context,
        });
        const session = createSessionRecord({
            sessionId: createServerId("cs"),
            tenantId: input.actor.tenantId,
            userId: input.actor.userId,
            username: input.actor.username,
            sourceSystem: input.actor.sourceSystem,
            authMode: input.actor.authMode,
            teamName: input.actor.tenantName || input.actor.tenantId,
            context: input.context,
            contextSignature: buildScopeSignature(candidateScope),
        });
        await this.sessionStore.create(session);
        return session;
    }
    async getSession(sessionId, actor) {
        const session = await this.sessionStore.getById(sessionId, actor.tenantId);
        if (!session || session.userId !== actor.userId) {
            throw new Error("Session not found");
        }
        return session;
    }
    async updateSessionContext(sessionId, actor, context) {
        const session = await this.getSession(sessionId, actor);
        if (!context || Object.keys(context).length === 0) {
            return session;
        }
        const candidateScope = buildExecutionScopeCandidate({
            uiContext: context,
        });
        const nextContextSignature = buildScopeSignature(candidateScope);
        const contextChanged = nextContextSignature !== session.contextSignature;
        const updatedSession = {
            ...session,
            teamName: candidateScope.teamName ||
                actor.tenantName ||
                session.teamName ||
                session.tenantId,
            context,
            contextSignature: nextContextSignature,
            updatedAt: new Date().toISOString(),
            lastVerifiedScopeSignature: contextChanged
                ? undefined
                : session.lastVerifiedScopeSignature,
            verifiedScope: contextChanged ? undefined : session.verifiedScope,
            pendingWorkflowAction: contextChanged
                ? undefined
                : session.pendingWorkflowAction,
            pendingLlmContinuation: contextChanged
                ? undefined
                : session.pendingLlmContinuation,
            pendingWorkflowContinuation: contextChanged
                ? undefined
                : session.pendingWorkflowContinuation,
        };
        await this.sessionStore.update(updatedSession);
        return updatedSession;
    }
}
