import type { ApprovalRecord, ApprovalStore } from "./approval-store";
import type { EventRecord, EventStore } from "./event-store";
import { readJsonArray, resolveStoreFile, writeJsonArray } from "./file-store-utils";
import type { RunRecord, RunStore } from "./run-store";
import type { SessionRecord, SessionStore } from "./session-store";

export class FileSessionStore implements SessionStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = resolveStoreFile(dataDir, "sessions");
  }

  async create(session: SessionRecord): Promise<void> {
    const sessions = await readJsonArray<SessionRecord>(this.filePath);
    sessions.push(session);
    await writeJsonArray(this.filePath, sessions);
  }

  async getById(sessionId: string, tenantId: string): Promise<SessionRecord | null> {
    const sessions = await readJsonArray<SessionRecord>(this.filePath);
    return (
      sessions.find(
        (session) =>
          session.sessionId === sessionId && session.tenantId === tenantId
      ) ?? null
    );
  }

  async update(session: SessionRecord): Promise<void> {
    const sessions = await readJsonArray<SessionRecord>(this.filePath);
    const next = sessions.map((current) =>
      current.sessionId === session.sessionId &&
      current.tenantId === session.tenantId
        ? session
        : current
    );
    await writeJsonArray(this.filePath, next);
  }
}

export class FileRunStore implements RunStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = resolveStoreFile(dataDir, "runs");
  }

  async create(run: RunRecord): Promise<void> {
    const runs = await readJsonArray<RunRecord>(this.filePath);
    runs.push(run);
    await writeJsonArray(this.filePath, runs);
  }

  async getById(runId: string, tenantId: string): Promise<RunRecord | null> {
    const runs = await readJsonArray<RunRecord>(this.filePath);
    return (
      runs.find((run) => run.runId === runId && run.tenantId === tenantId) ??
      null
    );
  }

  async update(run: RunRecord): Promise<void> {
    const runs = await readJsonArray<RunRecord>(this.filePath);
    const next = runs.map((current) =>
      current.runId === run.runId && current.tenantId === run.tenantId
        ? run
        : current
    );
    await writeJsonArray(this.filePath, next);
  }

  async listBySession(sessionId: string, tenantId: string): Promise<RunRecord[]> {
    const runs = await readJsonArray<RunRecord>(this.filePath);
    return runs.filter(
      (run) => run.sessionId === sessionId && run.tenantId === tenantId
    );
  }
}

export class FileEventStore implements EventStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = resolveStoreFile(dataDir, "events");
  }

  async append(event: EventRecord): Promise<void> {
    const events = await readJsonArray<EventRecord>(this.filePath);
    events.push(event);
    await writeJsonArray(this.filePath, events);
  }

  async listByRun(
    runId: string,
    tenantId: string,
    options?: { afterSequence?: number }
  ): Promise<EventRecord[]> {
    const events = await readJsonArray<EventRecord>(this.filePath);
    return events.filter((event) => {
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

export class FileApprovalStore implements ApprovalStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = resolveStoreFile(dataDir, "approvals");
  }

  async create(approval: ApprovalRecord): Promise<void> {
    const approvals = await readJsonArray<ApprovalRecord>(this.filePath);
    approvals.push(approval);
    await writeJsonArray(this.filePath, approvals);
  }

  async getById(
    approvalId: string,
    tenantId: string
  ): Promise<ApprovalRecord | null> {
    const approvals = await readJsonArray<ApprovalRecord>(this.filePath);
    return (
      approvals.find(
        (approval) =>
          approval.approvalId === approvalId && approval.tenantId === tenantId
      ) ?? null
    );
  }

  async update(approval: ApprovalRecord): Promise<void> {
    const approvals = await readJsonArray<ApprovalRecord>(this.filePath);
    const next = approvals.map((current) =>
      current.approvalId === approval.approvalId &&
      current.tenantId === approval.tenantId
        ? approval
        : current
    );
    await writeJsonArray(this.filePath, next);
  }

  async listPendingBySession(
    sessionId: string,
    tenantId: string
  ): Promise<ApprovalRecord[]> {
    const approvals = await readJsonArray<ApprovalRecord>(this.filePath);
    return approvals.filter(
      (approval) =>
        approval.sessionId === sessionId &&
        approval.tenantId === tenantId &&
        approval.status === "pending"
    );
  }
}
