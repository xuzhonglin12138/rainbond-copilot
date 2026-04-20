export interface EventRecord {
  tenantId: string;
  sessionId: string;
  runId: string;
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CreateEventRecordInput {
  tenantId: string;
  sessionId: string;
  runId: string;
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}

export interface EventStore {
  append(event: EventRecord): Promise<void>;
  listByRun(
    runId: string,
    tenantId: string,
    options?: { afterSequence?: number }
  ): Promise<EventRecord[]>;
}

export function createEventRecord(input: CreateEventRecordInput): EventRecord {
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

export class InMemoryEventStore implements EventStore {
  private events: EventRecord[] = [];

  async append(event: EventRecord): Promise<void> {
    this.events.push(event);
  }

  async listByRun(
    runId: string,
    tenantId: string,
    options?: { afterSequence?: number }
  ): Promise<EventRecord[]> {
    return this.events.filter((event) => {
      if (event.runId !== runId || event.tenantId !== tenantId) {
        return false;
      }

      if (
        options?.afterSequence !== undefined &&
        event.sequence <= options.afterSequence
      ) {
        return false;
      }

      return true;
    });
  }
}

export function createInMemoryEventStore(): EventStore {
  return new InMemoryEventStore();
}
