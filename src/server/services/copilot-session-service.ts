import type { RequestActor } from "../../shared/types.js";
import {
  createSessionRecord,
  type SessionRecord,
  type SessionStore,
} from "../stores/session-store.js";

export interface CreateSessionInput {
  actor: RequestActor;
  context?: Record<string, unknown>;
}

export class CopilotSessionService {
  constructor(private readonly sessionStore: SessionStore) {}

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const session = createSessionRecord({
      sessionId: `cs_${Date.now()}`,
      tenantId: input.actor.tenantId,
      userId: input.actor.userId,
      sourceSystem: input.actor.sourceSystem,
    });

    await this.sessionStore.create(session);
    return session;
  }

  async getSession(
    sessionId: string,
    actor: Pick<RequestActor, "tenantId">
  ): Promise<SessionRecord> {
    const session = await this.sessionStore.getById(sessionId, actor.tenantId);

    if (!session) {
      throw new Error("Session not found");
    }

    return session;
  }
}
