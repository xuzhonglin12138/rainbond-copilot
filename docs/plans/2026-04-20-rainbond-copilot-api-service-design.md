# Rainbond Copilot API Service Design

## 1. Background

The current Rainbond Copilot repository is primarily a browser-hosted application:

- The UI is mounted from `src/main.tsx` and `src/App.tsx`.
- Copilot orchestration is currently driven by `src/gateway/in-process-gateway.ts`.
- Runtime state depends on in-memory maps and browser `localStorage`.

This shape works for a demo or embedded single-project UI, but it is not sufficient for reuse from another project through network APIs. The target is to expose Rainbond Copilot as a reusable multi-tenant API service that another project can call over HTTP and SSE while keeping its own UI.

## 2. Goals

### Primary Goals

- Expose Rainbond Copilot as a standalone API service.
- Support multi-tenant isolation and user identity propagation.
- Support streaming interaction over HTTP + SSE.
- Let the caller project UI handle approval prompts and decisions.
- Preserve the current event-driven runtime model as much as possible.

### Non-Goals for Phase 1

- Full plugin marketplace support.
- Advanced long-term memory and semantic retrieval.
- Complex sub-agent durable orchestration across process restarts.
- Multi-provider failover and routing orchestration.

## 3. Service Boundary

The system is split into two roles:

### 3.1 Rainbond Copilot API Service

Owns:

- Runtime orchestration
- Skill registry and prompt assembly
- Session / run / event / approval persistence
- SSE streaming
- Audit logging

### 3.2 Caller Project UI

Owns:

- End-user authentication
- Tenant selection context
- Chat rendering
- Trace rendering
- Approval UI and approval submission

### 3.3 Core Domain Objects

- `tenant`
- `user`
- `session`
- `run`
- `event`
- `approval`

All persisted objects must be scoped by `tenant_id`. All approvals and high-risk actions must be traceable to a concrete `user_id`.

## 4. Multi-Tenant Auth Model

The recommended model is trusted backend-to-backend integration:

1. The user logs into the caller project.
2. The caller project's backend resolves the authenticated user.
3. The caller project's backend calls the Copilot API.
4. The Copilot API validates the caller's service token and trusted user context.
5. The Copilot API binds all session, run, event, and approval records to the resolved tenant and user.

### 4.1 Required Actor Context

```json
{
  "tenant_id": "t_123",
  "tenant_name": "acme-prod",
  "user_id": "u_456",
  "username": "alice",
  "display_name": "Alice",
  "roles": ["app_admin"],
  "source_system": "ops-console"
}
```

### 4.2 Auth Rules

- The browser must not call Copilot APIs directly in Phase 1.
- Caller-provided tenant identity must be accepted only from trusted service callers.
- Session, run, approval, and event queries must be tenant-scoped.
- Approval audit records must contain both requester and resolver identity.

## 5. HTTP + SSE API Design

Base path:

`/api/v1/copilot`

### 5.1 Create Session

`POST /api/v1/copilot/sessions`

Request:

```json
{
  "context": {
    "app_id": "app-001",
    "app_name": "trade-center",
    "page": "service-detail",
    "resource": {
      "type": "component",
      "id": "frontend-ui",
      "name": "frontend-ui"
    }
  }
}
```

Response:

```json
{
  "data": {
    "session_id": "cs_123",
    "tenant_id": "t_123",
    "created_at": "2026-04-20T10:00:00Z",
    "status": "active"
  }
}
```

### 5.2 Send Message

`POST /api/v1/copilot/sessions/:session_id/messages`

Request:

```json
{
  "message": "帮我检查 frontend-ui 为什么打不开",
  "client_message_id": "msg_001",
  "stream": true
}
```

Response:

```json
{
  "data": {
    "run_id": "run_789",
    "session_id": "cs_123",
    "stream_url": "/api/v1/copilot/sessions/cs_123/runs/run_789/events"
  }
}
```

### 5.3 Stream Run Events

`GET /api/v1/copilot/sessions/:session_id/runs/:run_id/events`

Optional query:

- `after_sequence=<number>`

This endpoint returns `text/event-stream` and streams all normalized runtime events for the specified run.

### 5.4 Submit Approval Decision

`POST /api/v1/copilot/approvals/:approval_id/decisions`

Request:

```json
{
  "decision": "approved",
  "comment": "确认执行"
}
```

Response:

```json
{
  "data": {
    "approval_id": "ap_001",
    "status": "approved",
    "resolved_at": "2026-04-20T10:05:00Z"
  }
}
```

### 5.5 Get Session Summary

`GET /api/v1/copilot/sessions/:session_id`

Response:

```json
{
  "data": {
    "session_id": "cs_123",
    "tenant_id": "t_123",
    "status": "active",
    "latest_run_id": "run_789",
    "pending_approvals": [
      {
        "approval_id": "ap_001",
        "description": "重启 frontend-ui",
        "risk": "high"
      }
    ]
  }
}
```

## 6. Public Event Contract

The public SSE contract should remain close to the existing runtime event model so that internal implementation can evolve without forcing a caller-side rewrite.

### 6.1 Event Types

- `run.status`
- `chat.message`
- `chat.trace`
- `approval.requested`
- `approval.resolved`
- `goal.created`
- `goal.completed`
- `memory.recalled`
- `memory.stored`
- `reflection.insight`
- `run.error`

### 6.2 Envelope

```json
{
  "type": "chat.message",
  "tenant_id": "t_123",
  "session_id": "cs_123",
  "run_id": "run_789",
  "sequence": 12,
  "timestamp": "2026-04-20T10:00:03Z",
  "data": {}
}
```

### 6.3 Required Contract Rules

- `sequence` must be strictly increasing per run.
- `session_id` and `run_id` must be present on every event.
- `timestamp` must be generated server-side.
- Event ordering must be replayable through `after_sequence`.

## 7. Persistence Model

Phase 1 persistence must include:

- `copilot_sessions`
- `copilot_runs`
- `copilot_events`
- `copilot_approvals`

Optional but recommended:

- `copilot_memories`
- `copilot_conversation_summaries`
- `copilot_user_preferences`

### 7.1 Storage Responsibilities

#### Database

Recommended: PostgreSQL or MySQL

Stores:

- canonical session state
- runs
- event history
- approvals
- memory metadata

#### Redis

Stores:

- active runtime lookup
- ephemeral streaming fanout state
- temporary approval wait state
- short-lived caches

### 7.2 Why Persistence Is Required

Without server-side persistence:

- service restarts lose sessions and approvals
- multi-instance deployments cannot resume approval flow safely
- SSE replay after disconnect is impossible
- audit history becomes unreliable

## 8. Internal Refactor Plan

### 8.1 Modules to Keep

These modules should remain core:

- `src/runtime/enhanced-agent-runtime.ts`
- `src/runtime/approval-manager.ts`
- `src/skills/registry.ts`
- `src/prompts/system-prompt.ts`
- `src/runtime/runtime-helpers.ts`

### 8.2 Modules to Replace

Replace browser-bound implementations with server-side abstractions:

- `src/session/memory-session-store.ts` -> DB / Redis-backed session store
- `src/workspace/workspace-manager.ts` -> DB or object-store-backed workspace store
- `src/context/context-builder.ts` -> server-side context providers
- `src/memory/memory-manager.ts` -> service-backed persistence adapters

### 8.3 New Service Modules

Suggested new areas:

- `src/server/auth/`
- `src/server/routes/`
- `src/server/controllers/`
- `src/server/services/`
- `src/server/events/`
- `src/server/stores/`

### 8.4 Approval Resume Strategy

Current approval flow relies on an in-memory promise resolver. That is acceptable for a browser demo, but not for multi-instance production services.

Phase 1 service behavior should be:

1. Persist approval as `pending`.
2. Mark run status as `waiting_approval`.
3. Stop forward execution.
4. Resume execution through a persisted resumption path after approval decision.

## 9. Phase 1 Delivery Scope

### Must Have

- multi-tenant auth context
- session / run / event / approval persistence
- send-message + SSE stream + approval decision loop
- caller-managed approval UI
- audit logging

### Deferred

- advanced memory retrieval
- complex durable sub-agent workflows
- plugin ecosystem
- sophisticated model routing

## 10. Acceptance Criteria

- Another project can create a session, start a run, and consume SSE events.
- High-risk actions produce approval requests that the caller UI can resolve.
- Service restart does not lose session or approval state.
- Tenant A cannot access Tenant B sessions, runs, approvals, or events.
- Events can be replayed with `after_sequence`.
- Audit records link tenant, user, run, and approval decision together.
