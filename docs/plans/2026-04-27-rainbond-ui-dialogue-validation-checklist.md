# Rainbond UI Dialogue Validation Checklist

## Purpose

This checklist is the manual validation path for the Markdown skill-loader integration work in:

- `/Users/guox/Desktop/agent/agent/.worktrees/codex/md-skill-loader`

It focuses on validating the current local runtime through the real Copilot API contract and Rainbond UI conversation flow.

## Current Integration Status

### Build-time integration completed

- vendored Rainbond skill sources live under:
  - `/Users/guox/Desktop/agent/agent/.worktrees/codex/md-skill-loader/skills-src/rainbond`
- generated artifacts live under:
  - `/Users/guox/Desktop/agent/agent/.worktrees/codex/md-skill-loader/src/generated/rainbond`
- registry now sees generated embedded workflows
- workflow metadata now prefers generated metadata
- capability knowledge now prefers generated capability entries

### Runtime integration completed in this pass

- `rainbond-delivery-verifier`
  - generated at build time
  - visible through registry
  - executable through the new compiled executor path

### Runtime integration intentionally deferred

These skills are generated and visible, but still use handwritten execution fallback:

- `rainbond-template-installer`
- `rainbond-app-version-assistant`

These skills are still handwritten-only in runtime behavior:

- `rainbond-app-assistant`
- `rainbond-fullstack-bootstrap`
- `rainbond-fullstack-troubleshooter`

## Local Runtime Preconditions

The local validation environment assumes:

- Node `20.20.0`
- `rainbond-ui` is already logged in to a reachable Rainbond console
- the local Copilot API server is reachable at:
  - `http://127.0.0.1:8787`

Required local `.env` fields in the worktree:

```dotenv
VITE_OPENAI_API_KEY=...
VITE_OPENAI_MODEL=...
VITE_OPENAI_BASE_URL=...
COPILOT_CONSOLE_BASE_URL=http://<rainbond-console-host>:7070/
```

## Start Sequence

From:

- `/Users/guox/Desktop/agent/agent/.worktrees/codex/md-skill-loader`

Run:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20.20.0

npm run build:skills
npm run build:server
./scripts/start-copilot-api.sh
```

Expected server log:

```text
Starting Rainbond Copilot API server on 127.0.0.1:8787
rainbond-copilot api server listening on http://127.0.0.1:8787
```

Health check:

```bash
curl -s http://127.0.0.1:8787/healthz
```

Expected:

```json
{"ok":true}
```

## Generated Artifact Verification

Check:

- `/Users/guox/Desktop/agent/agent/.worktrees/codex/md-skill-loader/src/generated/rainbond/compiled-skills.ts`
- `/Users/guox/Desktop/agent/agent/.worktrees/codex/md-skill-loader/src/generated/rainbond/workflow-metadata.ts`
- `/Users/guox/Desktop/agent/agent/.worktrees/codex/md-skill-loader/src/generated/rainbond/capability-knowledge.ts`
- `/Users/guox/Desktop/agent/agent/.worktrees/codex/md-skill-loader/src/generated/rainbond/compile-report.json`

Expected `compile-report.json`:

- `compiled` includes:
  - `rainbond-delivery-verifier`
  - `rainbond-template-installer`
  - `rainbond-app-version-assistant`
- `errors` is empty

## Rainbond UI Validation Setup

### API base URL

Point the UI-side Copilot client to:

- `http://127.0.0.1:8787`

If you are using the standalone demo App in this repository, set:

```dotenv
VITE_COPILOT_API_BASE_URL=http://127.0.0.1:8787
```

If you are validating from `rainbond-ui`, ensure its Copilot API proxy or direct base URL points to the local server.

### Required page context

Use a Rainbond page that already provides:

- `team_name`
- `region_name`
- `app_id`

Best candidates:

- app overview/detail page
- version center page for snapshot/version tests

## Manual Dialogue Cases

### Case 1: Compiled delivery verifier path

Open a current app page and send:

```text
只帮我确认当前应用是否已经交付成功，并给我访问地址
```

Expected:

- request enters `rainbond-app-assistant`
- selected subflow is `rainbond-delivery-verifier`
- server emits:
  - `workflow.selected`
  - `workflow.stage`
  - `workflow.completed`
- `workflow.completed.data.structured_result` contains:
  - `selectedWorkflow = rainbond-delivery-verifier`
  - `compiled_skill = true`
  - `compiled_workflow = rainbond-delivery-verifier`

Expected MCP calls:

- `rainbond_get_app_detail`
- `rainbond_query_components`

Important note:

- this case is the first real compiled runtime path
- if this passes, it proves generated Markdown skills are not only compiled, but also executed in the live workflow chain

### Case 2: Generated metadata + handwritten fallback for template installer

Open an app or team scope page and send:

```text
从云市场安装模板到当前应用
```

Expected:

- `selectedWorkflow = rainbond-template-installer`
- workflow metadata and capability description come from generated artifacts
- actual runtime behavior still follows handwritten executor logic

Expected MCP calls can include:

- `rainbond_query_cloud_markets`
- `rainbond_query_cloud_app_models`
- `rainbond_query_app_model_versions`

### Case 3: Generated metadata + handwritten fallback for app version assistant

Open the `/version` page and send:

```text
给当前应用创建一个快照
```

Expected:

- `selectedWorkflow = rainbond-app-version-assistant`
- workflow metadata and capability description come from generated artifacts
- actual runtime behavior still follows handwritten version-center logic

Expected MCP calls can include:

- `rainbond_get_app_version_overview`
- `rainbond_list_app_version_snapshots`
- possibly `rainbond_create_app_version_snapshot`

## What To Inspect In Browser DevTools

### Network

Inspect:

- `POST /api/v1/copilot/sessions`
- `POST /api/v1/copilot/sessions/:sessionId/messages`
- `GET /api/v1/copilot/sessions/:sessionId/runs/:runId/events`

Confirm:

- the request carries browser auth transport:
  - `Authorization`
  - `Cookie`
- page-scoped headers are present when available:
  - `X-Team-Name`
  - `X-Region-Name`

### SSE payload

Inspect the event stream for:

- `workflow.selected`
- `workflow.stage`
- `workflow.completed`
- `run.status`

For delivery verifier specifically, confirm:

- `structured_result.compiled_skill === true`
- `structured_result.compiled_workflow === "rainbond-delivery-verifier"`

## Known Boundaries In This Validation Pass

1. `rainbond-template-installer` and `rainbond-app-version-assistant` are not yet compiled-executor paths.
2. `rainbond-app-assistant`, `rainbond-fullstack-bootstrap`, and `rainbond-fullstack-troubleshooter` are still handwritten runtime logic.
3. Only the metadata, capability projection, registry visibility, and one compiled runtime path are validated in this pass.

## Pass Criteria

This pass is successful when:

1. local API server builds and starts
2. `healthz` returns `{"ok":true}`
3. generated skill artifacts are present and error-free
4. the Rainbond UI can talk to the local Copilot API server
5. the delivery-verifier prompt reaches the compiled runtime path
6. template-installer and app-version-assistant prompts still work through fallback runtime behavior

## Recommended Next Implementation Step

After this manual validation passes, the next safe step is:

- extend compiled executor support to one of:
  - `rainbond-template-installer`
  - `rainbond-app-version-assistant`

Recommended order:

1. `rainbond-template-installer`
2. `rainbond-app-version-assistant`
3. only then consider broader compiled support for `app-assistant`, `bootstrap`, or `troubleshooter`
