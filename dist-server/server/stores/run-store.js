export function createRunRecord(input) {
    return {
        runId: input.runId,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        messageText: input.messageText,
        status: input.status ?? "pending",
        errorMessage: input.errorMessage,
        startedAt: input.startedAt ?? new Date().toISOString(),
        finishedAt: input.finishedAt,
    };
}
export class InMemoryRunStore {
    constructor() {
        this.runs = new Map();
    }
    async create(run) {
        this.runs.set(this.key(run.runId, run.tenantId), run);
    }
    async getById(runId, tenantId) {
        return this.runs.get(this.key(runId, tenantId)) ?? null;
    }
    async update(run) {
        this.runs.set(this.key(run.runId, run.tenantId), run);
    }
    async listBySession(sessionId, tenantId) {
        return Array.from(this.runs.values()).filter((run) => run.sessionId === sessionId && run.tenantId === tenantId);
    }
    key(runId, tenantId) {
        return `${tenantId}:${runId}`;
    }
}
export function createInMemoryRunStore() {
    return new InMemoryRunStore();
}
