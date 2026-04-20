function toJson(value) {
    return JSON.stringify(value);
}
export class PostgresSessionStore {
    constructor(client) {
        this.client = client;
    }
    async create(session) {
        await this.client.query(`insert into copilot_sessions
        (session_id, tenant_id, user_id, source_system, status, latest_run_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`, [
            session.sessionId,
            session.tenantId,
            session.userId,
            session.sourceSystem,
            session.status,
            session.latestRunId ?? null,
            session.createdAt,
            session.updatedAt,
        ]);
    }
    async getById(sessionId, tenantId) {
        const result = await this.client.query(`select session_id as "sessionId",
              tenant_id as "tenantId",
              user_id as "userId",
              source_system as "sourceSystem",
              status,
              latest_run_id as "latestRunId",
              created_at as "createdAt",
              updated_at as "updatedAt"
         from copilot_sessions
        where session_id = $1 and tenant_id = $2
        limit 1`, [sessionId, tenantId]);
        return result.rows[0] ?? null;
    }
    async update(session) {
        await this.client.query(`update copilot_sessions
          set user_id = $3,
              source_system = $4,
              status = $5,
              latest_run_id = $6,
              created_at = $7,
              updated_at = $8
        where session_id = $1 and tenant_id = $2`, [
            session.sessionId,
            session.tenantId,
            session.userId,
            session.sourceSystem,
            session.status,
            session.latestRunId ?? null,
            session.createdAt,
            session.updatedAt,
        ]);
    }
}
export class PostgresRunStore {
    constructor(client) {
        this.client = client;
    }
    async create(run) {
        await this.client.query(`insert into copilot_runs
        (run_id, tenant_id, session_id, message_text, status, error_message, started_at, finished_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`, [
            run.runId,
            run.tenantId,
            run.sessionId,
            run.messageText,
            run.status,
            run.errorMessage ?? null,
            run.startedAt,
            run.finishedAt ?? null,
        ]);
    }
    async getById(runId, tenantId) {
        const result = await this.client.query(`select run_id as "runId",
              tenant_id as "tenantId",
              session_id as "sessionId",
              message_text as "messageText",
              status,
              error_message as "errorMessage",
              started_at as "startedAt",
              finished_at as "finishedAt"
         from copilot_runs
        where run_id = $1 and tenant_id = $2
        limit 1`, [runId, tenantId]);
        return result.rows[0] ?? null;
    }
    async update(run) {
        await this.client.query(`update copilot_runs
          set session_id = $3,
              message_text = $4,
              status = $5,
              error_message = $6,
              started_at = $7,
              finished_at = $8
        where run_id = $1 and tenant_id = $2`, [
            run.runId,
            run.tenantId,
            run.sessionId,
            run.messageText,
            run.status,
            run.errorMessage ?? null,
            run.startedAt,
            run.finishedAt ?? null,
        ]);
    }
    async listBySession(sessionId, tenantId) {
        const result = await this.client.query(`select run_id as "runId",
              tenant_id as "tenantId",
              session_id as "sessionId",
              message_text as "messageText",
              status,
              error_message as "errorMessage",
              started_at as "startedAt",
              finished_at as "finishedAt"
         from copilot_runs
        where session_id = $1 and tenant_id = $2
        order by started_at asc`, [sessionId, tenantId]);
        return result.rows;
    }
}
export class PostgresEventStore {
    constructor(client) {
        this.client = client;
    }
    async append(event) {
        await this.client.query(`insert into copilot_events
        (tenant_id, session_id, run_id, sequence, event_type, payload_json, created_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)`, [
            event.tenantId,
            event.sessionId,
            event.runId,
            event.sequence,
            event.eventType,
            toJson(event.payload),
            event.createdAt,
        ]);
    }
    async listByRun(runId, tenantId, options) {
        const result = await this.client.query(`select tenant_id as "tenantId",
              session_id as "sessionId",
              run_id as "runId",
              sequence,
              event_type as "eventType",
              payload_json,
              created_at as "createdAt"
         from copilot_events
        where run_id = $1
          and tenant_id = $2
          and sequence > $3
        order by sequence asc`, [runId, tenantId, options?.afterSequence ?? 0]);
        return result.rows.map((row) => ({
            tenantId: row.tenantId,
            sessionId: row.sessionId,
            runId: row.runId,
            sequence: row.sequence,
            eventType: row.eventType,
            payload: row.payload_json,
            createdAt: row.createdAt,
        }));
    }
}
export class PostgresApprovalStore {
    constructor(client) {
        this.client = client;
    }
    async create(approval) {
        await this.client.query(`insert into copilot_approvals
        (approval_id, tenant_id, session_id, run_id, skill_id, description, risk, status,
         requested_by, requested_at, resolved_by, resolved_at, comment)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [
            approval.approvalId,
            approval.tenantId,
            approval.sessionId,
            approval.runId,
            approval.skillId,
            approval.description,
            approval.risk,
            approval.status,
            approval.requestedBy,
            approval.requestedAt,
            approval.resolvedBy ?? null,
            approval.resolvedAt ?? null,
            approval.comment ?? null,
        ]);
    }
    async getById(approvalId, tenantId) {
        const result = await this.client.query(`select approval_id as "approvalId",
              tenant_id as "tenantId",
              session_id as "sessionId",
              run_id as "runId",
              skill_id as "skillId",
              description,
              risk,
              status,
              requested_by as "requestedBy",
              requested_at as "requestedAt",
              resolved_by as "resolvedBy",
              resolved_at as "resolvedAt",
              comment
         from copilot_approvals
        where approval_id = $1 and tenant_id = $2
        limit 1`, [approvalId, tenantId]);
        return result.rows[0] ?? null;
    }
    async update(approval) {
        await this.client.query(`update copilot_approvals
          set session_id = $3,
              run_id = $4,
              skill_id = $5,
              description = $6,
              risk = $7,
              status = $8,
              requested_by = $9,
              requested_at = $10,
              resolved_by = $11,
              resolved_at = $12,
              comment = $13
        where approval_id = $1 and tenant_id = $2`, [
            approval.approvalId,
            approval.tenantId,
            approval.sessionId,
            approval.runId,
            approval.skillId,
            approval.description,
            approval.risk,
            approval.status,
            approval.requestedBy,
            approval.requestedAt,
            approval.resolvedBy ?? null,
            approval.resolvedAt ?? null,
            approval.comment ?? null,
        ]);
    }
    async listPendingBySession(sessionId, tenantId) {
        const result = await this.client.query(`select approval_id as "approvalId",
              tenant_id as "tenantId",
              session_id as "sessionId",
              run_id as "runId",
              skill_id as "skillId",
              description,
              risk,
              status,
              requested_by as "requestedBy",
              requested_at as "requestedAt",
              resolved_by as "resolvedBy",
              resolved_at as "resolvedAt",
              comment
         from copilot_approvals
        where session_id = $1 and tenant_id = $2 and status = 'pending'
        order by requested_at asc`, [sessionId, tenantId]);
        return result.rows;
    }
}
