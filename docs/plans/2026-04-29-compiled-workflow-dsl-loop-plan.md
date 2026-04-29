# Compiled Workflow DSL Loop Extension Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the generic compiled Rainbond workflow DSL so a skill can keep collecting evidence within one compiled run by looping over low-risk probes and branching on prior tool results.

**Architecture:** Keep `SKILL.md` as the source of truth, but upgrade the machine-readable workflow contract. Add generic support for `loop` stages, `$tool.*` references in `when` expressions and tool args, and bounded iteration inside the compiled executor. Then remodel `rainbond-fullstack-troubleshooter` to use the new DSL instead of relying on one-pass execution plus prose-only “next steps”.

**Tech Stack:** TypeScript, existing Markdown skill loader, compiled workflow executor, Rainbond MCP tools, Vitest, `zod`, `yaml`, `markdown-it`.

---

### Task 1: Extend The Compiled Workflow Contract

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/src/server/workflows/compiled-types.ts`
- Modify: `/Users/guox/Desktop/agent/agent/src/server/workflows/skill-loader.ts`
- Test: `/Users/guox/Desktop/agent/agent/tests/server/workflows/skill-loader.test.ts`

**Purpose:**
- Add a generic `loop` stage kind with `branches` and optional `max_iterations`
- Let workflow placeholders and conditions reference prior tool outputs via `$tool.*`

**Acceptance criteria:**
- loader parses loop stages successfully
- loader rejects malformed loop stages
- loader allows `$tool.*` placeholders in args and `when`

### Task 2: Extend Branch Evaluation

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/src/server/workflows/branch-selector.ts`
- Test: `/Users/guox/Desktop/agent/agent/tests/server/workflows/branch-selector.test.ts`

**Purpose:**
- Make `when` expressions able to read prior tool outputs and combine predicates

**Target support:**
- `$tool.rainbond_get_component_summary.status.status == "waiting"`
- `$tool.rainbond_get_component_events.items[0].event_id`
- `!$tool.rainbond_get_component_build_logs`
- boolean composition with `&&` and `||`

### Task 3: Extend Template Argument Resolution

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/src/server/workflows/compiled-executor.ts`
- Test: `/Users/guox/Desktop/agent/agent/tests/server/workflows/compiled-executor.test.ts`

**Purpose:**
- Allow tool args to resolve from prior tool outputs, e.g. `event_id` extracted from component events

**Acceptance criteria:**
- `$tool.<tool>.items[0].event_id` resolves into a real MCP arg value
- unresolved `$tool.*` placeholders are omitted just like unresolved `$input.*`

### Task 4: Add Generic Loop Execution To The Compiled Executor

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/src/server/workflows/compiled-executor.ts`
- Test: `/Users/guox/Desktop/agent/agent/tests/server/workflows/compiled-executor.test.ts`

**Purpose:**
- Run loop stages generically, not as troubleshooter-specific TypeScript

**Runtime behavior:**
- each loop iteration rebuilds branch-eval context from latest tool outputs
- first matching loop branch runs
- loop stops when:
  - no loop branch matches
  - optional loop condition turns false
  - `max_iterations` is reached

### Task 5: Remodel Troubleshooter Onto The New DSL

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/skills-src/rainbond/rainbond-fullstack-troubleshooter/SKILL.md`
- Modify: `/Users/guox/Desktop/agent/agent/tests/server/workflows/skill-loader.test.ts`
- Modify: `/Users/guox/Desktop/agent/agent/tests/server/skills/skill-flow-integration.test.ts`

**Purpose:**
- Keep `inspect-runtime` for explicit `inspection_mode`
- Add a generic loop stage for evidence collection after default summary inspection

**Target evidence chain:**
- `summary -> events -> build_logs`
- or `summary -> pods -> pod_detail -> logs`

### Task 6: Verification

**Files:**
- Verify runtime and tests only

**Run:**
- `npm test -- agent/tests/server/workflows/branch-selector.test.ts`
- `npm test -- agent/tests/server/workflows/skill-loader.test.ts`
- `npm test -- agent/tests/server/workflows/compiled-executor.test.ts`
- `npm test -- agent/tests/server/skills/skill-flow-integration.test.ts`
- `npm run build:server`

**Expected outcome:**
- generic DSL supports loops and `$tool.*`
- troubleshooter no longer needs bespoke executor logic to continue probing
