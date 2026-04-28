import type { RequestActor } from "../../shared/types.js";
import { createServerId } from "../utils/id.js";
import {
  createRunRecord,
  type RunRecord,
  type RunStore,
} from "../stores/run-store.js";
import type { SessionStore } from "../stores/session-store.js";

export interface CreateRunInput {
  actor: RequestActor;
  sessionId: string;
  message: string;
}

export class CopilotRunService {
  constructor(
    private readonly runStore: RunStore,
    private readonly sessionStore: SessionStore
  ) {}

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const session = await this.sessionStore.getById(
      input.sessionId,
      input.actor.tenantId
    );

    if (!session || session.userId !== input.actor.userId) {
      throw new Error("Session not found");
    }

    const run = createRunRecord({
      runId: createServerId("run"),
      tenantId: input.actor.tenantId,
      sessionId: input.sessionId,
      messageText: input.message,
    });

    await this.runStore.create(run);
    await this.sessionStore.update({
      ...session,
      latestRunId: run.runId,
      updatedAt: new Date().toISOString(),
    });

    return run;
  }
}
