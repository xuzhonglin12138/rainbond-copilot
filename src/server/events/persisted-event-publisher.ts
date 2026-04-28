import {
  publicCopilotEventSchema,
  type PublicCopilotEvent,
} from "../../shared/contracts.js";
import { createEventRecord } from "../stores/event-store.js";
import type { SseBroker } from "./sse-broker.js";

export interface PublishCopilotEventInput {
  type: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  sequence: number;
  data: Record<string, unknown>;
  timestamp?: string;
}

export class PersistedEventPublisher {
  constructor(private readonly broker: SseBroker) {}

  async publish(input: PublishCopilotEventInput): Promise<PublicCopilotEvent> {
    const event = publicCopilotEventSchema.parse({
      type: input.type,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      runId: input.runId,
      sequence: input.sequence,
      timestamp: input.timestamp ?? new Date().toISOString(),
      data: input.data,
    });

    await this.broker.publish(
      createEventRecord({
        tenantId: event.tenantId,
        sessionId: event.sessionId,
        runId: event.runId,
        sequence: event.sequence,
        eventType: event.type,
        payload: event,
        createdAt: event.timestamp,
      })
    );

    return event;
  }
}
