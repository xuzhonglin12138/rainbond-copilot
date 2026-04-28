# Rainbond Troubleshooter Skill Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate `rainbond-fullstack-troubleshooter` into `agent` through the existing vendored-skill and generated-artifact pipeline, aligned to the currently exposed `rainbond-console` MCP surface.

**Architecture:** Vendor the upstream skill into `agent/skills-src/rainbond/`, add machine-readable YAML blocks to the vendored copy, compile it into generated metadata and capability knowledge, and rely on the existing handwritten troubleshooter runtime path as the execution fallback. Only MCP tools confirmed in `rainbond-console` will be included in the executable contract.

**Tech Stack:** TypeScript, Node ESM, `gray-matter`, `markdown-it`, `yaml`, `zod`, existing `agent` workflow runtime, Rainbond MCP.

---

### Task 1: Vendor The Troubleshooter Skill

**Files:**
- Create: `/Users/guox/Desktop/agent/agent/skills-src/rainbond/rainbond-fullstack-troubleshooter/`
- Reference: `/Users/guox/Desktop/agent/rainbond-skills/rainbond-fullstack-troubleshooter/`

**Steps:**
1. Copy the upstream troubleshooter skill directory into `agent/skills-src/rainbond/`.
2. Keep relative assets such as schemas or scripts alongside the vendored copy when the skill references them.

### Task 2: Add Machine-Readable Contract

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/skills-src/rainbond/rainbond-fullstack-troubleshooter/SKILL.md`
- Modify: `/Users/guox/Desktop/agent/agent/src/server/workflows/skill-loader.ts`
- Modify: `/Users/guox/Desktop/agent/agent/scripts/build-rainbond-skills.mjs`

**Steps:**
1. Add `yaml workflow`, `yaml tool_policy`, and `yaml output_contract` blocks to the vendored troubleshooter skill.
2. Restrict executable tool references to MCP tools confirmed in `rainbond-console`.
3. Reuse existing loader/build validation so the new skill fails fast if required args or placeholders drift.

### Task 3: Add Contract Tests

**Files:**
- Modify: `/Users/guox/Desktop/agent/agent/tests/server/workflows/skill-loader.test.ts`
- Modify: `/Users/guox/Desktop/agent/agent/tests/server/workflows/compiled-registry.test.ts`

**Steps:**
1. Add a failing loader test that expects the troubleshooter skill to compile with the new contract.
2. Add a registry expectation that the compiled troubleshooter now appears in generated embedded workflows.

### Task 4: Verify Generated Outputs

**Files:**
- Generated: `/Users/guox/Desktop/agent/agent/src/generated/rainbond/*`

**Steps:**
1. Run `npm run build:skills`.
2. Run `npm run build:server`.
3. Smoke-load the compiled troubleshooter skill from `dist-server/server/workflows/skill-loader.js`.
4. Confirm the generated artifacts now include the troubleshooter while runtime execution still uses the existing fallback path for unsupported stage kinds.
