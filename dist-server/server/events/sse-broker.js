import { createInMemoryEventStore, } from "../stores/event-store.js";
function streamKey(tenantId, runId) {
    return `${tenantId}:${runId}`;
}
export function createSseBroker(eventStore = createInMemoryEventStore()) {
    const subscribers = new Map();
    return {
        async publish(event) {
            await eventStore.append(event);
            const listeners = subscribers.get(streamKey(event.tenantId, event.runId));
            if (!listeners) {
                return;
            }
            for (const listener of listeners) {
                await listener(event);
            }
        },
        replay(runId, tenantId, options) {
            return eventStore.listByRun(runId, tenantId, {
                afterSequence: options?.afterSequence,
            });
        },
        subscribe(runId, tenantId, listener) {
            const key = streamKey(tenantId, runId);
            const listeners = subscribers.get(key) ?? new Set();
            listeners.add(listener);
            subscribers.set(key, listeners);
            return () => {
                const current = subscribers.get(key);
                if (!current) {
                    return;
                }
                current.delete(listener);
                if (current.size === 0) {
                    subscribers.delete(key);
                }
            };
        },
    };
}
