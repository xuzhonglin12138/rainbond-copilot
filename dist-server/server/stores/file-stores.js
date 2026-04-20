import { readJsonArray, resolveStoreFile, writeJsonArray } from "./file-store-utils.js";
export class FileSessionStore {
    constructor(dataDir) {
        this.filePath = resolveStoreFile(dataDir, "sessions");
    }
    async create(session) {
        const sessions = await readJsonArray(this.filePath);
        sessions.push(session);
        await writeJsonArray(this.filePath, sessions);
    }
    async getById(sessionId, tenantId) {
        const sessions = await readJsonArray(this.filePath);
        return (sessions.find((session) => session.sessionId === sessionId && session.tenantId === tenantId) ?? null);
    }
    async update(session) {
        const sessions = await readJsonArray(this.filePath);
        const next = sessions.map((current) => current.sessionId === session.sessionId &&
            current.tenantId === session.tenantId
            ? session
            : current);
        await writeJsonArray(this.filePath, next);
    }
}
export class FileRunStore {
    constructor(dataDir) {
        this.filePath = resolveStoreFile(dataDir, "runs");
    }
    async create(run) {
        const runs = await readJsonArray(this.filePath);
        runs.push(run);
        await writeJsonArray(this.filePath, runs);
    }
    async getById(runId, tenantId) {
        const runs = await readJsonArray(this.filePath);
        return (runs.find((run) => run.runId === runId && run.tenantId === tenantId) ??
            null);
    }
    async update(run) {
        const runs = await readJsonArray(this.filePath);
        const next = runs.map((current) => current.runId === run.runId && current.tenantId === run.tenantId
            ? run
            : current);
        await writeJsonArray(this.filePath, next);
    }
    async listBySession(sessionId, tenantId) {
        const runs = await readJsonArray(this.filePath);
        return runs.filter((run) => run.sessionId === sessionId && run.tenantId === tenantId);
    }
}
export class FileEventStore {
    constructor(dataDir) {
        this.filePath = resolveStoreFile(dataDir, "events");
    }
    async append(event) {
        const events = await readJsonArray(this.filePath);
        events.push(event);
        await writeJsonArray(this.filePath, events);
    }
    async listByRun(runId, tenantId, options) {
        const events = await readJsonArray(this.filePath);
        return events.filter((event) => {
            if (event.runId !== runId || event.tenantId !== tenantId) {
                return false;
            }
            if (options?.afterSequence !== undefined &&
                event.sequence <= options.afterSequence) {
                return false;
            }
            return true;
        });
    }
}
export class FileApprovalStore {
    constructor(dataDir) {
        this.filePath = resolveStoreFile(dataDir, "approvals");
    }
    async create(approval) {
        const approvals = await readJsonArray(this.filePath);
        approvals.push(approval);
        await writeJsonArray(this.filePath, approvals);
    }
    async getById(approvalId, tenantId) {
        const approvals = await readJsonArray(this.filePath);
        return (approvals.find((approval) => approval.approvalId === approvalId && approval.tenantId === tenantId) ?? null);
    }
    async update(approval) {
        const approvals = await readJsonArray(this.filePath);
        const next = approvals.map((current) => current.approvalId === approval.approvalId &&
            current.tenantId === approval.tenantId
            ? approval
            : current);
        await writeJsonArray(this.filePath, next);
    }
    async listPendingBySession(sessionId, tenantId) {
        const approvals = await readJsonArray(this.filePath);
        return approvals.filter((approval) => approval.sessionId === sessionId &&
            approval.tenantId === tenantId &&
            approval.status === "pending");
    }
}
