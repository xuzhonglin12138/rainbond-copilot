export function createEventRecord(input) {
    return {
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        runId: input.runId,
        sequence: input.sequence,
        eventType: input.eventType,
        payload: input.payload,
        createdAt: input.createdAt ?? new Date().toISOString(),
    };
}
export class InMemoryEventStore {
    constructor() {
        this.events = [];
    }
    async append(event) {
        this.events.push(event);
    }
    async listByRun(runId, tenantId, options) {
        return this.events.filter((event) => {
            if (event.runId !== runId || event.tenantId !== tenantId) {
                return false;
            }
            if (options?.afterSequence !== undefined &&
                event.sequence <= options.afterSequence) {
                return false;
            }
            return true;
        });
    }
}
export function createInMemoryEventStore() {
    return new InMemoryEventStore();
}
