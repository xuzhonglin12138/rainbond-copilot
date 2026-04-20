# Copilot API Integration Notes

## Goal

Use Rainbond Copilot as a reusable multi-tenant HTTP + SSE service from another project while keeping the caller project's own UI.

## Integration Checklist

1. Start the API server:

```bash
npm run build:server
npm run start:server
```

2. Ensure the caller project's backend forwards trusted actor headers:

- `x-copilot-tenant-id`
- `x-copilot-user-id`
- `x-copilot-username`
- `x-copilot-source-system`
- optional: `x-copilot-roles`
- optional: `x-copilot-display-name`
- optional: `x-copilot-tenant-name`

3. Create a session:

```http
POST /api/v1/copilot/sessions
```

4. Start a run:

```http
POST /api/v1/copilot/sessions/:session_id/messages
```

5. Open the SSE stream returned in `stream_url`:

```http
GET /api/v1/copilot/sessions/:session_id/runs/:run_id/events?after_sequence=0
Accept: text/event-stream
```

6. If the stream emits `approval.requested`, collect `approval_id` and submit a decision:

```http
POST /api/v1/copilot/approvals/:approval_id/decisions
```

7. Keep the SSE connection open to receive:

- `approval.resolved`
- `chat.message`
- `run.status`

## Store Modes

### Memory Mode

Best for:

- tests
- local debugging
- disposable sessions

Config:

```bash
COPILOT_STORE_MODE=memory
```

### File Mode

Best for:

- local demos
- preview deployments
- restart-safe persistence without extra infrastructure

Config:

```bash
COPILOT_STORE_MODE=file
COPILOT_DATA_DIR=.copilot-data
```

### PostgreSQL Mode
## Example Caller Flow

```ts
const session = await fetch("/api/v1/copilot/sessions", {
  method: "POST",
  headers,
  body: JSON.stringify({ context: { app_id: "app-001" } }),
}).then((res) => res.json());

const run = await fetch(`/api/v1/copilot/sessions/${session.data.session_id}/messages`, {
  method: "POST",
  headers,
  body: JSON.stringify({ message: "restart frontend-ui", stream: true }),
}).then((res) => res.json());

const source = new EventSource(run.data.stream_url);

source.addEventListener("approval.requested", async (event) => {
  const payload = JSON.parse((event as MessageEvent).data);
  await fetch(`/api/v1/copilot/approvals/${payload.data.approval_id}/decisions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approved", comment: "确认执行" }),
  });
});
```

## Current Limitations

- The API server currently provides a minimal deterministic execution path plus approval lifecycle wiring.
- Browser-oriented runtime modules still need further server-side adaptation before full LLM orchestration runs directly behind the HTTP server.
- The recommended deployment persistence path is file-backed local storage; multi-instance shared persistence is intentionally deferred.
