# Rainbond Skills Markdown Loader Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let `agent` ingest vendored `rainbond-skills` Markdown sources, compile them into stable generated workflow artifacts at build time, and expose those workflows through the existing Copilot API so they can be verified through `rainbond-ui` conversations.

**Architecture:** Treat Markdown skills as the source of truth, but do not execute free-form prose directly. Instead, copy the target `rainbond-skills` into `agent/skills-src/rainbond/`, require small machine-readable YAML blocks inside `SKILL.md`, compile them into generated TypeScript artifacts under `src/generated/rainbond/`, and let the server runtime consume the generated artifacts through a hybrid workflow registry and executor. Preserve the existing `/api/v1/copilot/*` contract and SSE event model so `rainbond-ui` can validate the result with normal Copilot conversations.

**Tech Stack:** TypeScript, Node ESM, `gray-matter`, `markdown-it`, `yaml`, `zod`, `glob` or `fast-glob`, optional `chokidar`, Rainbond MCP, existing `agent` workflow runtime, existing `rainbond-ui` Copilot drawer and SSE client.

---

## Confirmed Decisions From Conversation

1. The target model is **Markdown as the source of truth**, not "write a second full JS skill by hand for every Rainbond skill."
2. The runtime must **not** infer execution logic from free-form prose. It must consume **machine-readable YAML blocks** embedded inside `SKILL.md`.
3. The first integration should support copying `rainbond-skills` into an internal `agent` folder and processing them there.
4. Build time must produce generated artifacts that the runtime can load directly, instead of scanning Markdown on every request.
5. The existing `agent` API contract and `rainbond-ui` conversation validation flow must remain intact.
6. The first embedded-first skills remain:
   - `rainbond-app-assistant`
   - `rainbond-fullstack-bootstrap`
   - `rainbond-fullstack-troubleshooter`
   - `rainbond-delivery-verifier`
   - `rainbond-template-installer`
   - `rainbond-app-version-assistant`
7. `rainbond-project-init` and `rainbond-env-sync` remain workspace-oriented and out of the first embedded runtime path.
8. No git commit should be made during the first local validation pass.
9. Current local environment uses Node `v14.15.0`; package choices must acknowledge this constraint. If the team will remain on Node 14 for some time, prefer `fast-glob` over the latest `glob` runtime path.

## Target Directory Layout

```text
/Users/guox/Desktop/agent/agent/
  skills-src/
    rainbond/
      rainbond-app-assistant/
      rainbond-app-version-assistant/
      rainbond-delivery-verifier/
      rainbond-fullstack-bootstrap/
      rainbond-fullstack-troubleshooter/
      rainbond-template-installer/
  scripts/
    build-rainbond-skills.mjs
    watch-rainbond-skills.mjs
    sync-rainbond-skills.sh
  src/
    generated/
      rainbond/
        compiled-skills.ts
        workflow-metadata.ts
        capability-knowledge.ts
        compile-report.json
    server/
      workflows/
        skill-loader.ts
        compiled-executor.ts
        compiled-registry.ts
  tests/
    server/
      workflows/
        skill-loader.test.ts
        compiled-registry.test.ts
        compiled-executor.test.ts
```

## Library Selection and Responsibilities

### File discovery

- Preferred library: `glob`
- Node-14-safe fallback: `fast-glob`
- Responsibility:
  - scan `skills-src/rainbond/*/SKILL.md`
  - return deterministic absolute paths for build-time compilation

### Frontmatter parsing

- Library: `gray-matter`
- Responsibility:
  - parse `name`, `description`, `mode`, and future metadata from Markdown frontmatter

### Markdown fenced-block extraction

- Library: `markdown-it`
- Responsibility:
  - tokenize Markdown body
  - extract fenced blocks with info strings such as:
    - ````yaml workflow````
    - ````yaml tool_policy````
    - ````yaml output_contract````

### Structured block parsing

- Library: `yaml`
- Responsibility:
  - parse YAML from each machine-readable fenced block
  - reject malformed or non-object block payloads

### Validation and typed IR compilation

- Library: `zod`
- Responsibility:
  - validate frontmatter
  - validate block payloads
  - validate the merged compiled skill shape
  - define the internal `CompiledSkill` type boundary

### Optional dev-time hot reload

- Library: `chokidar`
- Responsibility:
  - watch `skills-src/rainbond/**/*`
  - rerun the build step when a skill changes
- Scope:
  - optional, not required for the first local integration

## Machine-Readable Markdown Contract

Each machine-loadable `SKILL.md` must contain:

1. Valid frontmatter:
   - `name`
   - `description`
   - `mode`
2. Required fenced YAML block:
   - ````yaml workflow````
3. Optional fenced YAML blocks:
   - ````yaml tool_policy````
   - ````yaml output_contract````

The runtime must not derive execution logic from prose-only sections such as `## Workflow`.

### Minimal `workflow` block example

```yaml
id: rainbond-delivery-verifier
entry:
  intents:
    - 交付
    - 验收
    - verify delivery
required_context:
  - team_name
  - region_name
  - app_id
stages:
  - id: resolve-scope
    kind: resolve_context
  - id: inspect-app
    kind: tool_call
    tool: rainbond_get_app_detail
    args:
      team_name: $context.team_name
      region_name: $context.region_name
      app_id: $context.app_id
  - id: inspect-components
    kind: tool_call
    tool: rainbond_query_components
    args:
      enterprise_id: $actor.enterprise_id
      app_id: $context.app_id
  - id: report
    kind: summarize
```

### Minimal `tool_policy` block example

```yaml
preferred_tools:
  - rainbond_get_app_detail
  - rainbond_query_components
approval:
  mutable_tools_require_scope_verification: true
```

### Minimal `output_contract` block example

```yaml
schema_ref: ./schemas/delivery-verification-result.schema.yaml
top_level_object: DeliveryVerificationResult
```

## Generated Artifact Contract

Build time must produce the following files.

### `src/generated/rainbond/compiled-skills.ts`

Purpose:

- the main runtime input for machine-loadable skills

Exports:

- `compiledRainbondSkills: CompiledSkill[]`

Each compiled skill should include at minimum:

- `id`
- `name`
- `description`
- `mode`
- `sourcePath`
- `workflow`
- `toolPolicy`
- `outputContract`

### `src/generated/rainbond/workflow-metadata.ts`

Purpose:

- the UI display projection

Exports:

- `generatedRainbondWorkflowMetadata`

Each metadata entry should include:

- `id`
- `title`
- `summary`
- `stages`

### `src/generated/rainbond/capability-knowledge.ts`

Purpose:

- the prompt-knowledge projection for the system prompt

Exports:

- `generatedEmbeddedWorkflowKnowledge`

Each entry should include:

- `useWhen`
- `avoidWhen`
- `preferredTools`
- `scopeHint`
- `vocabulary`

### `src/generated/rainbond/compile-report.json`

Purpose:

- local verification and debugging

Fields should include:

- `compiled`
- `skipped`
- `errors`
- `generatedAt`

## Runtime Integration Model

The runtime integration should be **hybrid**, not all-or-nothing.

### Hybrid rules

1. If a workflow exists in generated compiled form and the executor supports its stage kinds, use the compiled path.
2. If a workflow still needs custom logic not covered by the stage primitives, keep the current handwritten fallback.
3. The registry should expose one merged embedded list so the UI and prompt layers still see one workflow system.

This avoids blocking delivery on a full rewrite of:

- `rainbond-app-assistant`
- `rainbond-fullstack-bootstrap`
- `rainbond-fullstack-troubleshooter`

## Stage Primitive Set for First Execution Pass

The first compiled executor should support only a small primitive set:

- `resolve_context`
- `tool_call`
- `branch`
- `summarize`
- `handoff`
- `stop`

Do not attempt to model every complex rule in V1.

## Validation Surface Through `rainbond-ui`

The final integration must still validate through the existing conversation flow:

`rainbond-ui -> /api/v1/copilot/* -> agent -> Rainbond MCP -> agent -> SSE -> rainbond-ui`

`rainbond-ui` should continue consuming:

- `workflow.selected`
- `workflow.stage`
- `workflow.completed`
- `chat.message.*`
- approval events

The user should be able to validate the new path through normal Copilot prompts in the UI.

## Implementation Tasks

### Task 1: Add internal vendored skill source layout and sync tooling

**Files:**
- Create: `/Users/guox/Desktop/agent/agent/skills-src/rainbond/`
- Create: `/Users/guox/Desktop/agent/agent/scripts/sync-rainbond-skills.sh`
- Modify: `/Users/guox/Desktop/agent/agent/package.json`
- Reference: `/Users/guox/Desktop/agent/rainbond-skills/`

**Step 1: Create the vendored source root**

Create the directory:

```bash
mkdir -p /Users/guox/Desktop/agent/agent/skills-src/rainbond
```

**Step 2: Add a sync script**

Write a script that copies only the desired Rainbond skills into the internal source tree.

The first version should support:

- syncing all `rainbond-*` directories
- or syncing a filtered list through arguments

Example behavior:

```bash
./scripts/sync-rainbond-skills.sh
./scripts/sync-rainbond-skills.sh rainbond-delivery-verifier rainbond-template-installer
```

**Step 3: Add `package.json` scripts**

Add:

- `skills:sync`
- `build:skills`
- optional `watch:skills`

**Step 4: Verify the sync result**

Run:

```bash
cd /Users/guox/Desktop/agent/agent
./scripts/sync-rainbond-skills.sh rainbond-delivery-verifier rainbond-template-installer rainbond-app-version-assistant
```

Expected:

- `skills-src/rainbond/rainbond-delivery-verifier/SKILL.md` exists
- `skills-src/rainbond/rainbond-template-installer/SKILL.md` exists
- `skills-src/rainbond/rainbond-app-version-assistant/SKILL.md` exists

### Task 2: Define the machine-readable Markdown contract

**Files:**
- Create: `/Users/guox/Desktop/agent/agent/src/server/workflows/compiled-types.ts`
- Modify: `/Users/guox/Desktop/agent/agent/skills-src/rainbond/rainbond-delivery-verifier/SKILL.md`
- Modify: `/Users/guox/Desktop/agent/agent/skills-src/rainbond/rainbond-template-installer/SKILL.md`
- Modify: `/Users/guox/Desktop/agent/agent/skills-src/rainbond/rainbond-app-version-assistant/SKILL.md`

**Step 1: Define the internal compiled types**

Add:

- `CompiledSkill`
- `CompiledWorkflowDefinition`
- `CompiledWorkflowStage`

**Step 2: Add `zod` schemas for the contract**

The schema layer must validate:

- frontmatter
- `workflow`
- `tool_policy`
- `output_contract`

**Step 3: Patch the first three skills with machine-readable blocks**

Update the vendored copies, not the original repository, so `agent` can own its build-time contract.

**Step 4: Verify the contract shape locally**

Expected:

- each vendored skill still reads cleanly as Markdown
- each vendored skill now contains machine-readable YAML blocks

### Task 3: Build the Markdown skill compiler

**Files:**
- Create: `/Users/guox/Desktop/agent/agent/src/server/workflows/skill-loader.ts`
- Create: `/Users/guox/Desktop/agent/agent/scripts/build-rainbond-skills.mjs`
- Test: `/Users/guox/Desktop/agent/agent/tests/server/workflows/skill-loader.test.ts`

**Step 1: Implement discovery**

Use:

- `glob` if Node baseline is raised to 18+
- otherwise `fast-glob` if the team decides to preserve Node 14 compatibility

**Step 2: Implement frontmatter parsing**

Use `gray-matter`.

**Step 3: Implement fenced-block extraction**

Use `markdown-it`.

**Step 4: Implement YAML parsing**

Use `yaml`.

**Step 5: Implement `zod` validation and compilation**

Compile to `CompiledSkill`.

**Step 6: Write the failing tests**

The test should verify:

- skill discovery
- successful compilation of `rainbond-delivery-verifier`
- failure when the `workflow` block is missing

**Step 7: Run the loader tests**

Run:

```bash
cd /Users/guox/Desktop/agent/agent
npm test -- --run tests/server/workflows/skill-loader.test.ts
```

Expected:

- PASS once the local Node runtime is compatible with the current Vitest syntax baseline

### Task 4: Generate runtime artifacts at build time

**Files:**
- Create: `/Users/guox/Desktop/agent/agent/src/generated/rainbond/compiled-skills.ts`
- Create: `/Users/guox/Desktop/agent/agent/src/generated/rainbond/workflow-metadata.ts`
- Create: `/Users/guox/Desktop/agent/agent/src/generated/rainbond/capability-knowledge.ts`
- Create: `/Users/guox/Desktop/agent/agent/src/generated/rainbond/compile-report.json`
- Modify: `/Users/guox/Desktop/agent/agent/scripts/build-rainbond-skills.mjs`

**Step 1: Emit generated compiled skills**

Write a deterministic TypeScript export file.

**Step 2: Emit workflow metadata**

Build a UI-safe projection from the compiled workflow.

**Step 3: Emit capability knowledge**

Build a prompt-safe projection from the compiled workflow and tool policy.

**Step 4: Emit a compile report**

The compile report should be written even when some skills are skipped or fail validation.

**Step 5: Verify the build output**

Run:

```bash
cd /Users/guox/Desktop/agent/agent
npm run build:skills
```

Expected:

- all four generated artifacts exist
- `compile-report.json` lists compiled and skipped skills

### Task 5: Replace handwritten metadata and capability duplication with generated inputs

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/src/shared/workflow-metadata/rainbond.ts`
- Modify: `/Users/guox/Desktop/agent/agent/src/server/runtime/rainbond-capability-knowledge.ts`
- Reference: `/Users/guox/Desktop/agent/agent/src/generated/rainbond/workflow-metadata.ts`
- Reference: `/Users/guox/Desktop/agent/agent/src/generated/rainbond/capability-knowledge.ts`

**Step 1: Replace handwritten metadata exports**

Prefer generated workflow metadata.

**Step 2: Replace handwritten capability map**

Prefer generated capability entries for machine-loadable skills.

**Step 3: Keep workspace-only exclusions intact**

Do not accidentally expose:

- `rainbond-project-init`
- `rainbond-env-sync`

on the embedded-first list.

### Task 6: Build a compiled registry and keep handwritten fallbacks

**Files:**
- Create: `/Users/guox/Desktop/agent/agent/src/server/workflows/compiled-registry.ts`
- Modify: `/Users/guox/Desktop/agent/agent/src/server/workflows/registry.ts`
- Test: `/Users/guox/Desktop/agent/agent/tests/server/workflows/compiled-registry.test.ts`

**Step 1: Create the compiled registry**

Load generated compiled skills and filter:

- `mode === embedded`

**Step 2: Merge with handwritten workflow definitions**

The merged registry should:

- expose generated skills first when available
- preserve handwritten fallbacks for the more complex workflows

**Step 3: Test the merged registry**

Expected:

- generated skill IDs appear in the registry
- excluded workspace skills do not appear

### Task 7: Add a compiled executor path

**Files:**
- Create: `/Users/guox/Desktop/agent/agent/src/server/workflows/compiled-executor.ts`
- Modify: `/Users/guox/Desktop/agent/agent/src/server/workflows/executor.ts`
- Test: `/Users/guox/Desktop/agent/agent/tests/server/workflows/compiled-executor.test.ts`

**Step 1: Implement primitive handlers**

Support:

- `resolve_context`
- `tool_call`
- `branch`
- `summarize`
- `handoff`
- `stop`

**Step 2: Route generated skills to the compiled executor**

Only do this when:

- the skill exists in generated form
- every stage kind is supported

**Step 3: Preserve fallback behavior**

If the compiled path is unavailable, continue using the existing handwritten workflow path.

### Task 8: Enable the workflow path in the actual server entry

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/src/server/http.ts`
- Modify: `/Users/guox/Desktop/agent/agent/src/server/controllers/copilot-controller.ts`

**Step 1: Ensure embedded workflow mode is enabled**

The server entry must explicitly pass:

- `enableRainbondAppAssistantWorkflow: true`

when constructing the controller.

**Step 2: Keep MCP client wiring unchanged**

Do not break:

- `workflowToolClientFactory`
- `queryToolClientFactory`
- approval flow

### Task 9: Validate end-to-end through `rainbond-ui`

**Files:**
- Reference: `/Users/guox/Desktop/agent/agent/src/App.tsx`
- Reference: current `rainbond-ui` Copilot drawer integration

**Step 1: Build and start the server**

Run:

```bash
cd /Users/guox/Desktop/agent/agent
npm run build:skills
npm run build:server
npm run start:server
```

**Step 2: Open `rainbond-ui` on a page with app context**

Ensure the page supplies:

- `team_name`
- `region_name`
- `app_id`

**Step 3: Validate explicit prompts**

Use:

- `只帮我确认当前应用是否已经交付成功，并给我访问地址`
- `从云市场安装模板到当前应用`
- `在版本中心给当前应用创建一个快照`

**Step 4: Validate event flow**

The UI should show:

- `workflow.selected`
- `workflow.stage`
- `workflow.completed`

**Step 5: Validate generated and runtime artifacts**

Check:

- generated artifacts exist
- runtime selected the intended workflow
- MCP tools were called with page context reused directly

## Verification Commands

### Build-time verification

```bash
cd /Users/guox/Desktop/agent/agent
npm run build:skills
npm run build:server
```

### Loader smoke verification

```bash
cd /Users/guox/Desktop/agent/agent
node -e "import('./dist-server/server/workflows/skill-loader.js').then(async (m) => { const skill = await m.loadSkillFromFile('./skills-src/rainbond/rainbond-delivery-verifier/SKILL.md'); console.log(JSON.stringify({ id: skill.id, mode: skill.mode, workflowId: skill.workflow?.id, stageIds: skill.workflow?.stages.map((stage) => stage.id), outputSchema: skill.outputContract?.schema_ref }, null, 2)); })"
```

### UI validation prompts

```text
只帮我确认当前应用是否已经交付成功，并给我访问地址
从云市场安装模板到当前应用
在版本中心给当前应用创建一个快照
```

## Explicit Non-Goals for the First Pass

- full migration of every Rainbond skill
- direct runtime execution of prose-only Markdown
- workspace-first support for `project-init` and `env-sync`
- hot reload as a release blocker
- removing all handwritten workflow code immediately
- committing generated files before the user validates them locally

## Notes for the First Local Validation Round

1. Do not commit any files in this round.
2. Favor deterministic build output over dynamic runtime discovery.
3. If the repository remains on Node 14, revise the scan dependency decision before finalizing implementation.
4. Keep generated files checked and inspectable so the user can compare source Markdown to compiled workflow output before enabling the runtime path.
