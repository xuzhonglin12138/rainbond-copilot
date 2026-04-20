import {
  createInMemoryEventStore,
  type EventRecord,
  type EventStore,
} from "../stores/event-store.js";

type Subscriber = (event: EventRecord) => void | Promise<void>;

export interface ReplayOptions {
  afterSequence?: number;
}

export interface SseBroker {
  publish(event: EventRecord): Promise<void>;
  replay(
    runId: string,
    tenantId: string,
    options?: ReplayOptions
  ): Promise<EventRecord[]>;
  subscribe(
    runId: string,
    tenantId: string,
    listener: Subscriber
  ): () => void;
}

function streamKey(tenantId: string, runId: string): string {
  return `${tenantId}:${runId}`;
}

export function createSseBroker(eventStore: EventStore = createInMemoryEventStore()): SseBroker {
  const subscribers = new Map<string, Set<Subscriber>>();

  return {
    async publish(event: EventRecord): Promise<void> {
      await eventStore.append(event);

      const listeners = subscribers.get(streamKey(event.tenantId, event.runId));
      if (!listeners) {
        return;
      }

      for (const listener of listeners) {
        await listener(event);
      }
    },

    replay(
      runId: string,
      tenantId: string,
      options?: ReplayOptions
    ): Promise<EventRecord[]> {
      return eventStore.listByRun(runId, tenantId, {
        afterSequence: options?.afterSequence,
      });
    },

    subscribe(
      runId: string,
      tenantId: string,
      listener: Subscriber
    ): () => void {
      const key = streamKey(tenantId, runId);
      const listeners = subscribers.get(key) ?? new Set<Subscriber>();
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
