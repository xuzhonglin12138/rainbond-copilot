# Rainbond Copilot Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Phase 1 Rainbond Copilot prototype with an OpenClaw-style agent runtime, hybrid skills, mock action adapter, approval flow, and event-driven right drawer UI.

**Architecture:** Implement an in-process TypeScript prototype with a React drawer UI, a runtime that emits normalized events, a file-backed session/workspace layer, and a hybrid skill registry. Keep all business-facing actions behind action skills so the mock adapter can later be swapped for Rainbond MCP or API adapters without changing the runtime or UI protocol.

**Tech Stack:** TypeScript, React, Vite, Vitest, Testing Library, Zod, Node file system APIs

---

> Current workspace note: `/Users/liufan/Code/openclaw` is not a git repository right now. The commit steps below assume you either initialize git first or execute the plan in a git-tracked project/worktree.

### Task 1: Bootstrap the Prototype App and Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `tests/setup.ts`
- Create: `tests/app/App.test.tsx`

**Step 1: Write the failing UI smoke test**

```tsx
import { render, screen } from "@testing-library/react";
import App from "../../src/App";

it("renders the Rainbond Copilot drawer shell", () => {
  render(<App />);
  expect(screen.getByText("Rainbond Copilot")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/app/App.test.tsx -r`
Expected: FAIL because `src/App.tsx` and the test harness do not exist yet.

**Step 3: Write the minimal app shell**

```tsx
export default function App() {
  return <div>Rainbond Copilot</div>;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/app/App.test.tsx -r`
Expected: PASS with 1 passing test.

**Step 5: Commit**

```bash
git add package.json tsconfig.json vite.config.ts src/main.tsx src/App.tsx tests/setup.ts tests/app/App.test.tsx
git commit -m "chore: bootstrap rainbond copilot prototype"
```

### Task 2: Define Shared Runtime and Drawer Event Contracts

**Files:**
- Create: `src/shared/contracts.ts`
- Create: `src/shared/types.ts`
- Create: `tests/shared/contracts.test.ts`

**Step 1: Write the failing contract test**

```ts
import { drawerEventSchema } from "../../src/shared/contracts";

it("accepts a ui.effect highlight event", () => {
  const parsed = drawerEventSchema.parse({
    type: "ui.effect",
    runId: "run-1",
    effect: "highlight_node",
    payload: { targetId: "frontend-ui" },
  });

  expect(parsed.type).toBe("ui.effect");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/shared/contracts.test.ts -r`
Expected: FAIL because `drawerEventSchema` does not exist yet.

**Step 3: Implement the minimal contract schemas**

```ts
import { z } from "zod";

export const drawerEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ui.effect"),
    runId: z.string(),
    effect: z.enum(["highlight_node", "clear_highlight", "focus_panel", "show_step"]),
    payload: z.unknown(),
  }),
]);
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/shared/contracts.test.ts -r`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/contracts.ts src/shared/types.ts tests/shared/contracts.test.ts
git commit -m "feat: add shared copilot event contracts"
```

### Task 3: Add File-Backed Session Store and Workspace Manager

**Files:**
- Create: `src/session/file-session-store.ts`
- Create: `src/workspace/workspace-manager.ts`
- Create: `src/workspace/templates/AGENTS.md`
- Create: `src/workspace/templates/RAINBOND.md`
- Create: `src/workspace/templates/USER.md`
- Create: `tests/session/file-session-store.test.ts`
- Create: `tests/workspace/workspace-manager.test.ts`

**Step 1: Write the failing session persistence test**

```ts
import { FileSessionStore } from "../../src/session/file-session-store";

it("creates a new session directory with transcript and metadata files", async () => {
  const store = new FileSessionStore(".tmp/copilot");
  const session = await store.createSession("session-1");

  expect(session.sessionId).toBe("session-1");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/session/file-session-store.test.ts tests/workspace/workspace-manager.test.ts -r`
Expected: FAIL because the store and workspace manager do not exist yet.

**Step 3: Implement minimal file-backed session/workspace support**

```ts
export class FileSessionStore {
  async createSession(sessionId: string) {
    return { sessionId, transcriptIds: [], pendingApprovals: [], openTasks: [] };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/session/file-session-store.test.ts tests/workspace/workspace-manager.test.ts -r`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/session/file-session-store.ts src/workspace/workspace-manager.ts src/workspace/templates tests/session/file-session-store.test.ts tests/workspace/workspace-manager.test.ts
git commit -m "feat: add file-backed session and workspace foundation"
```

### Task 4: Build the Hybrid Skill Registry

**Files:**
- Create: `src/skills/types.ts`
- Create: `src/skills/registry.ts`
- Create: `src/skills/load-markdown-skill.ts`
- Create: `src/skills/load-plugin-skill.ts`
- Create: `src/skills/prompt/rainbond-core/SKILL.md`
- Create: `src/skills/prompt/diagnose-service/SKILL.md`
- Create: `tests/skills/registry.test.ts`

**Step 1: Write the failing registry test**

```ts
import { SkillRegistry } from "../../src/skills/registry";

it("loads both markdown and plugin skills into one registry", async () => {
  const registry = new SkillRegistry("src/skills");
  const skills = await registry.loadAll();

  expect(skills.some((skill) => skill.kind === "prompt")).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/skills/registry.test.ts -r`
Expected: FAIL because the registry does not exist yet.

**Step 3: Implement the minimal hybrid registry**

```ts
export type SkillDescriptor = {
  id: string;
  name: string;
  kind: "prompt" | "action";
  description: string;
  risk?: "low" | "medium" | "high";
  requiresApproval?: boolean;
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/skills/registry.test.ts -r`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/skills src/skills/prompt tests/skills/registry.test.ts
git commit -m "feat: add hybrid skill registry"
```

### Task 5: Add Mock World State and Action Skills

**Files:**
- Create: `src/adapters/mock/world-state.ts`
- Create: `src/adapters/mock/mock-action-adapter.ts`
- Create: `src/skills/actions/get-component-status/plugin.ts`
- Create: `src/skills/actions/get-component-logs/plugin.ts`
- Create: `src/skills/actions/restart-component/plugin.ts`
- Create: `src/skills/actions/scale-component-memory/plugin.ts`
- Create: `tests/adapters/mock-action-adapter.test.ts`

**Step 1: Write the failing adapter test**

```ts
import { MockActionAdapter } from "../../src/adapters/mock/mock-action-adapter";

it("marks frontend-ui as running after restart", async () => {
  const adapter = new MockActionAdapter();
  await adapter.restartComponent({ name: "frontend-ui" });
  const status = await adapter.getComponentStatus({ name: "frontend-ui" });

  expect(status.status).toBe("running");
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/adapters/mock-action-adapter.test.ts -r`
Expected: FAIL because the adapter and world state do not exist yet.

**Step 3: Implement the minimal mock world and adapter**

```ts
export class MockActionAdapter {
  async getComponentStatus(input: { name: string }) {
    return { name: input.name, status: "running" };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/adapters/mock-action-adapter.test.ts -r`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/adapters/mock src/skills/actions tests/adapters/mock-action-adapter.test.ts
git commit -m "feat: add mock action adapter and action skills"
```

### Task 6: Implement the Core Agent Runtime and Approval Flow

**Files:**
- Create: `src/runtime/agent-runtime.ts`
- Create: `src/runtime/planner.ts`
- Create: `src/runtime/approval-manager.ts`
- Create: `tests/runtime/agent-runtime.test.ts`

**Step 1: Write the failing runtime test**

```ts
import { AgentRuntime } from "../../src/runtime/agent-runtime";

it("emits approval.requested before executing a high-risk action", async () => {
  const runtime = new AgentRuntime();
  const events = await runtime.run("scale frontend-ui memory to 1024MB");

  expect(events.some((event) => event.type === "approval.requested")).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/runtime/agent-runtime.test.ts -r`
Expected: FAIL because the runtime does not exist yet.

**Step 3: Implement the minimal runtime loop**

```ts
export class AgentRuntime {
  async run(input: string) {
    return [{ type: "run.status", runId: "run-1", status: "thinking" }] as const;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/runtime/agent-runtime.test.ts -r`
Expected: PASS for the minimal path, then expand tests until skill selection, tool calls, and approvals all pass.

**Step 5: Commit**

```bash
git add src/runtime tests/runtime/agent-runtime.test.ts
git commit -m "feat: add core agent runtime with approval flow"
```

### Task 7: Add the In-Process Gateway and Event Normalization

**Files:**
- Create: `src/gateway/in-process-gateway.ts`
- Create: `tests/gateway/in-process-gateway.test.ts`

**Step 1: Write the failing gateway test**

```ts
import { InProcessGateway } from "../../src/gateway/in-process-gateway";

it("normalizes runtime tool.call events into drawer trace events", async () => {
  const gateway = new InProcessGateway();
  const drawerEvents = await gateway.handleMessage("session-1", "check frontend-ui");

  expect(drawerEvents.some((event) => event.type === "chat.trace")).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/gateway/in-process-gateway.test.ts -r`
Expected: FAIL because the gateway does not exist yet.

**Step 3: Implement the minimal gateway**

```ts
export class InProcessGateway {
  async handleMessage() {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/gateway/in-process-gateway.test.ts -r`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/gateway tests/gateway/in-process-gateway.test.ts
git commit -m "feat: add in-process copilot gateway"
```

### Task 8: Refactor the Drawer Prototype to Consume Gateway Events

**Files:**
- Modify: `src/App.tsx`
- Create: `src/ui/CopilotDrawer.tsx`
- Create: `src/ui/use-copilot-stream.ts`
- Create: `src/ui/ui-effect-reducer.ts`
- Create: `tests/ui/CopilotDrawer.test.tsx`

**Step 1: Write the failing drawer test**

```tsx
import { render, screen } from "@testing-library/react";
import { CopilotDrawer } from "../../src/ui/CopilotDrawer";

it("renders a pending approval card when the stream emits chat.approval", () => {
  render(<CopilotDrawer />);
  expect(screen.queryByText("需要您的授权执行")).not.toBeNull();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/ui/CopilotDrawer.test.tsx -r`
Expected: FAIL because the drawer does not consume event streams yet.

**Step 3: Implement the minimal event-driven drawer**

```tsx
export function CopilotDrawer() {
  return <aside>Rainbond Copilot</aside>;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/ui/CopilotDrawer.test.tsx -r`
Expected: PASS, then expand until the drawer renders streamed messages, traces, approvals, and highlights.

**Step 5: Commit**

```bash
git add src/App.tsx src/ui tests/ui/CopilotDrawer.test.tsx
git commit -m "feat: connect copilot drawer to runtime event stream"
```

### Task 9: Add an End-to-End Mock Scenario and Regression Tests

**Files:**
- Create: `tests/e2e/frontend-diagnosis-flow.test.ts`
- Modify: `src/adapters/mock/world-state.ts`
- Modify: `src/skills/prompt/diagnose-service/SKILL.md`

**Step 1: Write the failing scenario test**

```ts
it("runs the frontend-ui diagnosis flow from trace to approval to recovery", async () => {
  // send user message
  // expect tool call trace
  // expect approval
  // approve
  // expect running status and final answer
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/e2e/frontend-diagnosis-flow.test.ts -r`
Expected: FAIL because the full flow is not connected yet.

**Step 3: Implement the minimal flow glue**

```ts
// Use the existing runtime, gateway, and mock adapter to drive one deterministic scenario end to end.
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/e2e/frontend-diagnosis-flow.test.ts -r`
Expected: PASS, with tool trace, approval, and final message all asserted.

**Step 5: Commit**

```bash
git add tests/e2e/frontend-diagnosis-flow.test.ts src/adapters/mock/world-state.ts src/skills/prompt/diagnose-service/SKILL.md
git commit -m "test: cover frontend diagnosis approval flow"
```

### Task 10: Document the Phase 2 Rainbond Integration Seam

**Files:**
- Create: `docs/plans/phase-2-rainbond-integration-notes.md`
- Modify: `src/skills/types.ts`
- Modify: `src/adapters/mock/mock-action-adapter.ts`
- Create: `tests/skills/adapter-compatibility.test.ts`

**Step 1: Write the failing compatibility test**

```ts
it("keeps action skill input/output stable across adapters", () => {
  expect(true).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/skills/adapter-compatibility.test.ts -r`
Expected: FAIL.

**Step 3: Implement the adapter seam contract**

```ts
export interface ActionAdapter {
  getComponentStatus(input: { name: string }): Promise<{ name: string; status: string }>;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/skills/adapter-compatibility.test.ts -r`
Expected: PASS.

**Step 5: Commit**

```bash
git add docs/plans/phase-2-rainbond-integration-notes.md src/skills/types.ts src/adapters/mock/mock-action-adapter.ts tests/skills/adapter-compatibility.test.ts
git commit -m "docs: define phase 2 rainbond integration seam"
```

## Validation Checklist
- `pnpm vitest -r`
- `pnpm vite build`
- Manual check: send `frontend-ui` failure prompt, inspect trace, approve action, verify mock topology returns to running

## Execution Notes
- Keep the first runtime single-session and in-process. Do not add queues or remote workers in Phase 1.
- Treat `ui.effect` as a first-class event. Do not encode highlight instructions inside assistant text.
- Keep action skills adapter-backed from day one so Phase 2 remains a swap, not a rewrite.
