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
    async resume(input) {
        const key = runKey(input.tenantId, input.runId);
        const handler = this.handlers.get(key);
        if (!handler) {
            return false;
        }
        this.handlers.delete(key);
        await handler(input);
        return true;
    }
}
export function createInMemoryRunResumer() {
    return new InMemoryRunResumer();
}
