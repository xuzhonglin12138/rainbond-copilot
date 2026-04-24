import type { RequestActor } from "../../shared/types.js";
import { createServerId } from "../utils/id.js";
import { buildExecutionScopeCandidate, buildScopeSignature } from "../workflows/context-resolver.js";
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
    const candidateScope = buildExecutionScopeCandidate({
      uiContext: input.context as Record<string, unknown>,
    });

    const session = createSessionRecord({
      sessionId: createServerId("cs"),
      tenantId: input.actor.tenantId,
      userId: input.actor.userId,
      username: input.actor.username,
      sourceSystem: input.actor.sourceSystem,
      authMode: input.actor.authMode,
      teamName: input.actor.tenantName || input.actor.tenantId,
      context: input.context,
      contextSignature: buildScopeSignature(candidateScope),
    });

    await this.sessionStore.create(session);
    return session;
  }

  async getSession(
    sessionId: string,
    actor: Pick<RequestActor, "tenantId" | "userId">
  ): Promise<SessionRecord> {
    const session = await this.sessionStore.getById(sessionId, actor.tenantId);

    if (!session || session.userId !== actor.userId) {
      throw new Error("Session not found");
    }

    return session;
  }

  async updateSessionContext(
    sessionId: string,
    actor: Pick<RequestActor, "tenantId" | "userId" | "tenantName">,
    context?: Record<string, unknown>
  ): Promise<SessionRecord> {
    const session = await this.getSession(sessionId, actor);

    if (!context || Object.keys(context).length === 0) {
      return session;
    }

    const candidateScope = buildExecutionScopeCandidate({
      uiContext: context as Record<string, unknown>,
    });
    const nextContextSignature = buildScopeSignature(candidateScope);
    const contextChanged = nextContextSignature !== session.contextSignature;

    const updatedSession: SessionRecord = {
      ...session,
      teamName:
        candidateScope.teamName ||
        actor.tenantName ||
        session.teamName ||
        session.tenantId,
      context,
      contextSignature: nextContextSignature,
      updatedAt: new Date().toISOString(),
      lastVerifiedScopeSignature: contextChanged
        ? undefined
        : session.lastVerifiedScopeSignature,
      verifiedScope: contextChanged ? undefined : session.verifiedScope,
      pendingWorkflowAction: contextChanged
        ? undefined
        : session.pendingWorkflowAction,
      pendingLlmContinuation: contextChanged
        ? undefined
        : session.pendingLlmContinuation,
    };

    await this.sessionStore.update(updatedSession);
    return updatedSession;
  }
}
