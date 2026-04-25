function runKey(tenantId, runId) {
    return `${tenantId}:${runId}`;
}
export class InMemoryRunResumer {
    constructor() {
        this.handlers = new Map();
    }
    register(tenantId, runId, handler) {
        this.handlers.set(runKey(tenantId, runId), handler);
    }
    unregister(tenantId, runId) {
        this.handlers.delete(runKey(tenantId, runId));
    }
    async resume(input) {
        const key = runKey(input.tenantId, input.runId);
        const handler = this.handlers.get(key);
        if (!handler) {
            return false;
        }
        await handler(input);
        return true;
    }
}
export function createInMemoryRunResumer() {
    return new InMemoryRunResumer();
}
