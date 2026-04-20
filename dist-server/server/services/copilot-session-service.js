import { createSessionRecord, } from "../stores/session-store.js";
export class CopilotSessionService {
    constructor(sessionStore) {
        this.sessionStore = sessionStore;
    }
    async createSession(input) {
        const session = createSessionRecord({
            sessionId: `cs_${Date.now()}`,
            tenantId: input.actor.tenantId,
            userId: input.actor.userId,
            sourceSystem: input.actor.sourceSystem,
        });
        await this.sessionStore.create(session);
        return session;
    }
    async getSession(sessionId, actor) {
        const session = await this.sessionStore.getById(sessionId, actor.tenantId);
        if (!session) {
            throw new Error("Session not found");
        }
        return session;
    }
}
