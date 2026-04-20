# Rainbond Copilot API Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the current browser-hosted Rainbond Copilot into a reusable multi-tenant HTTP + SSE API service that another project can call while keeping its own UI.

**Architecture:** Preserve the current runtime, skill registry, and event model, then introduce a server layer that owns auth context, persistence, SSE fanout, and approval resumption. Replace browser-only state carriers with injected service-side store interfaces so the runtime can run safely in a multi-tenant backend process.

**Tech Stack:** TypeScript, Node.js server runtime, existing Copilot runtime modules, Vitest, PostgreSQL/MySQL for canonical persistence, Redis for active runtime and streaming coordination.

---

### Task 1: Define Service-Side Request Actor and Auth Context

**Files:**
- Create: `src/server/auth/request-context.ts`
- Create: `src/server/auth/auth-middleware.ts`
- Create: `tests/server/auth/request-context.test.ts`
- Modify: `src/shared/types.ts`

**Step 1: Write the failing test**

```ts
// tests/server/auth/request-context.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseRequestActor } from "../../../src/server/auth/request-context";

describe("parseRequestActor", () => {
  it("extracts trusted tenant and user identity from headers", () => {
    const actor = parseRequestActor({
      "x-copilot-tenant-id": "t_123",
      "x-copilot-user-id": "u_456",
      "x-copilot-username": "alice",
      "x-copilot-source-system": "ops-console",
    });

    expect(actor.tenantId).toBe("t_123");
    expect(actor.userId).toBe("u_456");
    expect(actor.username).toBe("alice");
    expect(actor.sourceSystem).toBe("ops-console");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/auth/request-context.test.ts`

Expected: FAIL because `parseRequestActor` does not exist yet.

**Step 3: Write minimal implementation**

```ts
// src/server/auth/request-context.ts
export type RequestActor = {
  tenantId: string;
  userId: string;
  username: string;
  sourceSystem: string;
  roles: string[];
};

export function parseRequestActor(headers: Record<string, string | string[] | undefined>): RequestActor {
  const tenantId = String(headers["x-copilot-tenant-id"] || "");
  const userId = String(headers["x-copilot-user-id"] || "");
  const username = String(headers["x-copilot-username"] || "");
  const sourceSystem = String(headers["x-copilot-source-system"] || "");

  if (!tenantId || !userId || !username || !sourceSystem) {
    throw new Error("Missing trusted Copilot actor headers");
  }

  return {
    tenantId,
    userId,
    username,
    sourceSystem,
    roles: [],
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/auth/request-context.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/server/auth/request-context.ts src/server/auth/auth-middleware.ts tests/server/auth/request-context.test.ts src/shared/types.ts
git commit -m "feat: add copilot request actor parsing"
```

### Task 2: Introduce Store Interfaces for Session, Run, Event, and Approval

**Files:**
- Create: `src/server/stores/session-store.ts`
- Create: `src/server/stores/run-store.ts`
- Create: `src/server/stores/event-store.ts`
- Create: `src/server/stores/approval-store.ts`
- Create: `tests/server/stores/store-contracts.test.ts`

**Step 1: Write the failing test**

```ts
// tests/server/stores/store-contracts.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSessionRecord } from "../../../src/server/stores/session-store";

describe("session store contracts", () => {
  it("creates a tenant-scoped session record", () => {
    const session = createSessionRecord({
      sessionId: "cs_123",
      tenantId: "t_123",
      userId: "u_456",
    });

    expect(session.tenantId).toBe("t_123");
    expect(session.userId).toBe("u_456");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/stores/store-contracts.test.ts`

Expected: FAIL because store helpers do not exist.

**Step 3: Write minimal implementation**

Add TypeScript interfaces and record factory helpers that enforce:

- `tenantId`
- `sessionId`
- `runId`
- `approvalId`
- timestamps

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/stores/store-contracts.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/server/stores/session-store.ts src/server/stores/run-store.ts src/server/stores/event-store.ts src/server/stores/approval-store.ts tests/server/stores/store-contracts.test.ts
git commit -m "feat: define copilot persistence contracts"
```

### Task 3: Make Runtime Dependencies Injectable

**Files:**
- Modify: `src/runtime/enhanced-agent-runtime.ts`
- Modify: `src/context/context-builder.ts`
- Modify: `src/memory/memory-manager.ts`
- Create: `src/runtime/runtime-dependencies.ts`
- Create: `tests/runtime/enhanced-agent-runtime.server.test.ts`

**Step 1: Write the failing test**

```ts
// tests/runtime/enhanced-agent-runtime.server.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createServerRuntimeConfig } from "../../src/runtime/runtime-dependencies";

describe("server runtime dependencies", () => {
  it("accepts injected stores instead of browser localStorage", () => {
    const config = createServerRuntimeConfig({
      sessionId: "cs_123",
      tenantId: "t_123",
    });

    expect(config.sessionId).toBe("cs_123");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runtime/enhanced-agent-runtime.server.test.ts`

Expected: FAIL because server runtime dependency builder does not exist.

**Step 3: Write minimal implementation**

Refactor runtime construction so these dependencies can be injected:

- session actor
- workspace store
- memory store
- event publisher
- approval store
- LLM client

Do not remove the current browser path yet; add a server-capable path first.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runtime/enhanced-agent-runtime.server.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/runtime/enhanced-agent-runtime.ts src/context/context-builder.ts src/memory/memory-manager.ts src/runtime/runtime-dependencies.ts tests/runtime/enhanced-agent-runtime.server.test.ts
git commit -m "refactor: inject server runtime dependencies"
```

### Task 4: Add Event Persistence and SSE Fanout

**Files:**
- Create: `src/server/events/sse-broker.ts`
- Create: `src/server/events/persisted-event-publisher.ts`
- Create: `tests/server/events/sse-broker.test.ts`
- Modify: `src/shared/contracts.ts`

**Step 1: Write the failing test**

```ts
// tests/server/events/sse-broker.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSseBroker } from "../../../src/server/events/sse-broker";

describe("SSE broker", () => {
  it("replays only events after the requested sequence", async () => {
    const broker = createSseBroker();
    broker.publish("run_1", { sequence: 1, type: "run.status" });
    broker.publish("run_1", { sequence: 2, type: "chat.message" });

    const events = broker.replay("run_1", 1);
    expect(events).toHaveLength(1);
    expect(events[0].sequence).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/events/sse-broker.test.ts`

Expected: FAIL because broker does not exist.

**Step 3: Write minimal implementation**

Implement a broker that:

- accepts published normalized events
- stores them through `EventStore`
- replays by `runId` and `afterSequence`
- exposes a subscription API for live SSE connections

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/events/sse-broker.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/server/events/sse-broker.ts src/server/events/persisted-event-publisher.ts tests/server/events/sse-broker.test.ts src/shared/contracts.ts
git commit -m "feat: add persisted SSE event broker"
```

### Task 5: Expose Session and Message APIs

**Files:**
- Create: `src/server/routes/copilot-routes.ts`
- Create: `src/server/controllers/copilot-controller.ts`
- Create: `src/server/services/copilot-session-service.ts`
- Create: `src/server/services/copilot-run-service.ts`
- Create: `tests/server/api/copilot-api.test.ts`

**Step 1: Write the failing test**

```ts
// tests/server/api/copilot-api.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCopilotController } from "../../../src/server/controllers/copilot-controller";

describe("copilot api", () => {
  it("creates a run and returns a stream URL", async () => {
    const controller = createCopilotController();
    const response = await controller.createMessageRun({
      params: { sessionId: "cs_123" },
      body: { message: "check frontend-ui", stream: true },
    });

    expect(response.data.run_id).toBeTruthy();
    expect(response.data.stream_url).toContain("/events");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/api/copilot-api.test.ts`

Expected: FAIL because controller does not exist.

**Step 3: Write minimal implementation**

Implement controller and service methods for:

- `POST /sessions`
- `POST /sessions/:sessionId/messages`
- `GET /sessions/:sessionId`

The message endpoint should create a run and return a stream URL instead of blocking on final output.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/api/copilot-api.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/server/routes/copilot-routes.ts src/server/controllers/copilot-controller.ts src/server/services/copilot-session-service.ts src/server/services/copilot-run-service.ts tests/server/api/copilot-api.test.ts
git commit -m "feat: add copilot session and message APIs"
```

### Task 6: Implement Approval Persistence and Run Resumption

**Files:**
- Create: `src/server/services/copilot-approval-service.ts`
- Create: `src/server/runtime/run-resumer.ts`
- Modify: `src/runtime/approval-manager.ts`
- Create: `tests/server/api/copilot-approval.test.ts`

**Step 1: Write the failing test**

```ts
// tests/server/api/copilot-approval.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createApprovalService } from "../../../src/server/services/copilot-approval-service";

describe("approval decisions", () => {
  it("marks approval approved and resumes the waiting run", async () => {
    const service = createApprovalService();
    const result = await service.decide("ap_001", {
      decision: "approved",
      comment: "确认执行",
    });

    expect(result.status).toBe("approved");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/api/copilot-approval.test.ts`

Expected: FAIL because approval decision service does not exist.

**Step 3: Write minimal implementation**

Implement:

- persisted approval decision update
- run status transition from `waiting_approval` to `running`
- resumption hook that continues runtime execution after approval

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/api/copilot-approval.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/server/services/copilot-approval-service.ts src/server/runtime/run-resumer.ts src/runtime/approval-manager.ts tests/server/api/copilot-approval.test.ts
git commit -m "feat: add approval resumption flow"
```

### Task 7: Add SSE Events Endpoint and Replay Support

**Files:**
- Modify: `src/server/routes/copilot-routes.ts`
- Modify: `src/server/controllers/copilot-controller.ts`
- Create: `tests/server/api/copilot-events.test.ts`

**Step 1: Write the failing test**

```ts
// tests/server/api/copilot-events.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCopilotController } from "../../../src/server/controllers/copilot-controller";

describe("copilot event stream", () => {
  it("returns replayable SSE events after a sequence", async () => {
    const controller = createCopilotController();
    const stream = await controller.streamRunEvents({
      params: { sessionId: "cs_123", runId: "run_123" },
      query: { after_sequence: "10" },
    });

    expect(stream.contentType).toBe("text/event-stream");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/api/copilot-events.test.ts`

Expected: FAIL because stream endpoint does not exist.

**Step 3: Write minimal implementation**

Add:

- `GET /sessions/:sessionId/runs/:runId/events`
- support for `after_sequence`
- normalized SSE emission using public event names

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/api/copilot-events.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/server/routes/copilot-routes.ts src/server/controllers/copilot-controller.ts tests/server/api/copilot-events.test.ts
git commit -m "feat: add copilot SSE events endpoint"
```

### Task 8: Add Persistent Store Implementations and Production Config

**Files:**
- Create: `src/server/stores/postgres-session-store.ts`
- Create: `src/server/stores/postgres-run-store.ts`
- Create: `src/server/stores/postgres-event-store.ts`
- Create: `src/server/stores/postgres-approval-store.ts`
- Create: `src/server/config/server-config.ts`
- Modify: `package.json`
- Create: `tests/server/stores/postgres-store-smoke.test.ts`

**Step 1: Write the failing test**

```ts
// tests/server/stores/postgres-store-smoke.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createServerConfig } from "../../../src/server/config/server-config";

describe("server config", () => {
  it("requires persistence configuration for copilot api service", () => {
    const config = createServerConfig({
      COPILOT_DB_URL: "postgres://localhost/copilot",
      COPILOT_REDIS_URL: "redis://localhost:6379",
    });

    expect(config.dbUrl).toContain("postgres://");
    expect(config.redisUrl).toContain("redis://");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/stores/postgres-store-smoke.test.ts`

Expected: FAIL because config helpers do not exist.

**Step 3: Write minimal implementation**

Add:

- production config parsing
- store implementations backed by SQL
- Redis wiring for runtime and stream coordination
- package scripts for running the server

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/stores/postgres-store-smoke.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/server/stores/postgres-session-store.ts src/server/stores/postgres-run-store.ts src/server/stores/postgres-event-store.ts src/server/stores/postgres-approval-store.ts src/server/config/server-config.ts package.json tests/server/stores/postgres-store-smoke.test.ts
git commit -m "feat: add persistent copilot api stores"
```

### Task 9: Document External Integration and Verify End-to-End

**Files:**
- Create: `docs/plans/2026-04-20-copilot-api-integration-notes.md`
- Modify: `QUICKSTART.md`
- Create: `tests/e2e/copilot-api-sse-flow.test.ts`

**Step 1: Write the failing test**

```ts
// tests/e2e/copilot-api-sse-flow.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("copilot api sse flow", () => {
  it("creates session, starts run, emits approval request, and accepts decision", async () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/e2e/copilot-api-sse-flow.test.ts`

Expected: FAIL

**Step 3: Write minimal implementation**

Replace the placeholder with an end-to-end flow that verifies:

- session creation
- message run creation
- SSE event receipt
- approval decision
- resumed completion

Document caller integration steps in `QUICKSTART.md` and integration notes.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/e2e/copilot-api-sse-flow.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add docs/plans/2026-04-20-copilot-api-integration-notes.md QUICKSTART.md tests/e2e/copilot-api-sse-flow.test.ts
git commit -m "docs: add copilot api integration guide"
```
