export type RunRecordStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunRecord {
  runId: string;
  tenantId: string;
  sessionId: string;
  messageText: string;
  status: RunRecordStatus;
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface CreateRunRecordInput {
  runId: string;
  tenantId: string;
  sessionId: string;
  messageText: string;
  status?: RunRecordStatus;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunStore {
  create(run: RunRecord): Promise<void>;
  getById(runId: string, tenantId: string): Promise<RunRecord | null>;
  update(run: RunRecord): Promise<void>;
  listBySession(sessionId: string, tenantId: string): Promise<RunRecord[]>;
}

export function createRunRecord(input: CreateRunRecordInput): RunRecord {
  return {
    runId: input.runId,
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    messageText: input.messageText,
    status: input.status ?? "pending",
    errorMessage: input.errorMessage,
    startedAt: input.startedAt ?? new Date().toISOString(),
    finishedAt: input.finishedAt,
  };
}

export class InMemoryRunStore implements RunStore {
  private runs = new Map<string, RunRecord>();

  async create(run: RunRecord): Promise<void> {
    this.runs.set(this.key(run.runId, run.tenantId), run);
  }

  async getById(runId: string, tenantId: string): Promise<RunRecord | null> {
    return this.runs.get(this.key(runId, tenantId)) ?? null;
  }

  async update(run: RunRecord): Promise<void> {
    this.runs.set(this.key(run.runId, run.tenantId), run);
  }

  async listBySession(
    sessionId: string,
    tenantId: string
  ): Promise<RunRecord[]> {
    return Array.from(this.runs.values()).filter(
      (run) => run.sessionId === sessionId && run.tenantId === tenantId
    );
  }

  private key(runId: string, tenantId: string): string {
    return `${tenantId}:${runId}`;
  }
}

export function createInMemoryRunStore(): RunStore {
  return new InMemoryRunStore();
}
