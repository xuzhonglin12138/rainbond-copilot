import { createRunRecord, } from "../stores/run-store";
export class CopilotRunService {
    constructor(runStore, sessionStore) {
        this.runStore = runStore;
        this.sessionStore = sessionStore;
    }
    async createRun(input) {
        const session = await this.sessionStore.getById(input.sessionId, input.actor.tenantId);
        if (!session) {
            throw new Error("Session not found");
        }
        const run = createRunRecord({
            runId: `run_${Date.now()}`,
            tenantId: input.actor.tenantId,
            sessionId: input.sessionId,
            messageText: input.message,
        });
        await this.runStore.create(run);
        await this.sessionStore.update({
            ...session,
            latestRunId: run.runId,
            updatedAt: new Date().toISOString(),
        });
        return run;
    }
}
