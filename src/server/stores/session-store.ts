export type SessionRecordStatus = "active" | "archived";

export interface SessionRecord {
  sessionId: string;
  tenantId: string;
  userId: string;
  sourceSystem: string;
  status: SessionRecordStatus;
  latestRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionRecordInput {
  sessionId: string;
  tenantId: string;
  userId: string;
  sourceSystem: string;
  status?: SessionRecordStatus;
  latestRunId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionStore {
  create(session: SessionRecord): Promise<void>;
  getById(sessionId: string, tenantId: string): Promise<SessionRecord | null>;
  update(session: SessionRecord): Promise<void>;
}

export function createSessionRecord(
  input: CreateSessionRecordInput
): SessionRecord {
  const now = input.createdAt ?? new Date().toISOString();

  return {
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    userId: input.userId,
    sourceSystem: input.sourceSystem,
    status: input.status ?? "active",
    latestRunId: input.latestRunId,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
  };
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>();

  async create(session: SessionRecord): Promise<void> {
    this.sessions.set(this.key(session.sessionId, session.tenantId), session);
  }

  async getById(
    sessionId: string,
    tenantId: string
  ): Promise<SessionRecord | null> {
    return this.sessions.get(this.key(sessionId, tenantId)) ?? null;
  }

  async update(session: SessionRecord): Promise<void> {
    this.sessions.set(this.key(session.sessionId, session.tenantId), session);
  }

  private key(sessionId: string, tenantId: string): string {
    return `${tenantId}:${sessionId}`;
  }
}

export function createInMemorySessionStore(): SessionStore {
  return new InMemorySessionStore();
}
