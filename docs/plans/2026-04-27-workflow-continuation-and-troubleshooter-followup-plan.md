# Workflow Continuation And Troubleshooter Follow-Up Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three linked issues in the embedded Rainbond workflow path: weak follow-up continuation after workflow summaries, unstable component alias/service_id handling, and shallow troubleshooter continuation that stops after the first summary pass.

**Architecture:** Keep the current `rainbond-app-assistant -> selected subflow -> handwritten fallback` runtime shape, but strengthen the handoff points. Persist workflow-summary continuations in session state, normalize component-scoped MCP tool inputs back to canonical `service_id`, and teach troubleshooter continuation to run a deterministic second-pass inspection before falling back to generic LLM chat.

**Tech Stack:** TypeScript, existing `agent` workflow runtime, in-memory/file session and run stores, Rainbond MCP client, generated Rainbond skill contracts.

---

### Task 1: Persist Workflow Summary Continuations

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/src/server/stores/session-store.ts`
- Modify: `/Users/guox/Desktop/agent/agent/src/server/services/copilot-session-service.ts`
- Modify: `/Users/guox/Desktop/agent/agent/src/server/workflows/executor.ts`
- Modify: `/Users/guox/Desktop/agent/agent/src/server/controllers/copilot-controller.ts`

**Purpose:**
- Persist a lightweight `pendingWorkflowContinuation` when a workflow ends with a summary but no pending tool action.
- Reuse that continuation when the user replies with `继续` or other short follow-up prompts.

### Task 2: Canonicalize Component IDs

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/src/server/runtime/server-llm-executor.ts`
- Modify: `/Users/guox/Desktop/agent/agent/src/server/workflows/executor.ts`

**Purpose:**
- Always resolve component-scoped MCP inputs back to canonical `service_id` when app scope is available.
- Persist canonical component identity inside workflow continuation metadata so later follow-up steps do not drift back to `service_alias`.

### Task 3: Deepen Troubleshooter Follow-Up

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/src/server/workflows/executor.ts`
- Modify: `/Users/guox/Desktop/agent/agent/tests/server/api/copilot-workflow-routing.test.ts`

**Purpose:**
- When a troubleshooter summary is followed by `继续`, run a deterministic second-pass MCP inspection:
  - refresh app detail
  - refresh component list
  - resolve canonical component id
  - inspect pods
  - inspect events
  - inspect component detail
  - inspect pod detail when a target pod is available
- Return a new workflow summary and refresh stored continuation state for the next turn.

### Task 4: Verification

**Files:**
- Local build outputs under `/Users/guox/Desktop/agent/agent/dist-server/`

**Steps:**
1. Run `npm run build:skills`
2. Run `npm run build:server`
3. Smoke-check that:
   - a troubleshooter summary writes `pendingWorkflowContinuation`
   - a follow-up `继续` no longer falls back to generic LLM
   - component-scoped calls use canonical `service_id`
4. Do not create any git commit in this round
