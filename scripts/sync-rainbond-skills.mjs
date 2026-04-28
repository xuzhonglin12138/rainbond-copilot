#!/usr/bin/env node
/**
 * Smart sync from ~/code/rainbond-skills/<skill> into skills-src/rainbond/<skill>.
 *
 * Why this exists instead of plain rsync:
 *   The upstream SKILL.md files do not contain the `mode: embedded` frontmatter
 *   field or the embedded `yaml workflow` / `yaml tool_policy` / `yaml output_contract`
 *   machine blocks that the rainbond-copilot runtime consumes. Those were authored
 *   locally to wire each skill into the embedded executor + LLM router. A plain
 *   rsync would wipe them on every sync, breaking compiled-executor and the
 *   skill-router.
 *
 *   This script:
 *     1. Snapshots the local SKILL.md (frontmatter `mode:` + machine blocks)
 *     2. rsyncs the upstream skill directory over the local one (so narrative,
 *        scripts/, evals/, schemas/ etc. update in place)
 *     3. Re-injects `mode:` into the synced frontmatter and appends the machine
 *        blocks back to the end of the markdown body.
 *
 *   Skills present upstream but not yet mirrored locally are reported and
 *   skipped — they need human review to author their machine blocks before the
 *   runtime can drive them.
 *
 * Usage:
 *   node scripts/sync-rainbond-skills.mjs                 # sync all currently mirrored skills
 *   node scripts/sync-rainbond-skills.mjs <skill> <skill> # sync just these
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const targetRoot = join(projectRoot, "skills-src", "rainbond");
const MACHINE_BLOCK_KINDS = new Set(["workflow", "tool_policy", "output_contract"]);

const sourceRoot = resolveSourceRoot();
if (!sourceRoot) {
  console.error("ERROR: cannot find ../rainbond-skills above", projectRoot);
  process.exit(1);
}

const skills = process.argv.slice(2);
const skillsToSync =
  skills.length > 0 ? skills : listLocalSkills();

const upstreamSkills = listUpstreamSkills();
const newUpstreamOnly = upstreamSkills.filter(
  (name) => !skillsToSync.includes(name) && !existsSync(join(targetRoot, name))
);

console.log(`source:  ${sourceRoot}`);
console.log(`target:  ${targetRoot}`);
console.log(`syncing: ${skillsToSync.join(", ") || "(none)"}`);

for (const name of skillsToSync) {
  syncOne(name);
}

if (newUpstreamOnly.length > 0) {
  console.log("");
  console.log("Upstream-only skills (need machine blocks before runtime can use):");
  for (const name of newUpstreamOnly) {
    console.log(`  - ${name}`);
  }
}

function listLocalSkills() {
  if (!existsSync(targetRoot)) return [];
  return readdirSync(targetRoot)
    .filter((name) => statSync(join(targetRoot, name)).isDirectory());
}

function listUpstreamSkills() {
  return readdirSync(sourceRoot)
    .filter((name) => name.startsWith("rainbond-"))
    .filter((name) => {
      const p = join(sourceRoot, name);
      return statSync(p).isDirectory() && existsSync(join(p, "SKILL.md"));
    });
}

function resolveSourceRoot() {
  let cur = projectRoot;
  while (cur !== "/") {
    const candidate = join(cur, "rainbond-skills");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
    cur = dirname(cur);
  }
  return null;
}

function syncOne(name) {
  const srcDir = join(sourceRoot, name);
  const dstDir = join(targetRoot, name);

  if (!existsSync(srcDir)) {
    console.error(`  skip ${name}: missing upstream dir ${srcDir}`);
    return;
  }

  const localPatch = existsSync(join(dstDir, "SKILL.md"))
    ? snapshotLocalSkill(join(dstDir, "SKILL.md"))
    : null;

  execFileSync("rsync", ["-a", "--delete", `${srcDir}/`, `${dstDir}/`], {
    stdio: "inherit",
  });

  if (localPatch) {
    const upstream = readFileSync(join(dstDir, "SKILL.md"), "utf-8");
    const merged = applyLocalPatch(upstream, localPatch);
    writeFileSync(join(dstDir, "SKILL.md"), merged, "utf-8");
    console.log(`  synced ${name} (preserved mode:${localPatch.mode || "-"}, ${localPatch.blocks.length} machine block(s))`);
  } else {
    console.log(`  synced ${name} (NEW skill - no local patch to preserve; runtime may not pick it up until machine blocks are added)`);
  }
}

function snapshotLocalSkill(filePath) {
  const raw = readFileSync(filePath, "utf-8");
  const fm = parseFrontmatter(raw);
  const blocks = extractMachineBlocks(fm.body);

  return {
    mode: fm.data.mode,
    blocks,
  };
}

function applyLocalPatch(upstream, patch) {
  const fm = parseFrontmatter(upstream);
  const data = { ...fm.data };

  if (patch.mode && !data.mode) {
    data.mode = patch.mode;
  }

  let body = fm.body;
  for (const block of patch.blocks) {
    if (body.includes(block.fence)) continue;
    body = `${body.trimEnd()}\n\n${block.fence}\n`;
  }

  return rebuildMarkdown(data, body);
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: raw };
  }
  const data = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) {
      const [, key, value] = m;
      data[key] = value.trim();
    }
  }
  return { data, body: match[2] };
}

function rebuildMarkdown(data, body) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push("---");
  return `${lines.join("\n")}\n\n${body.trimStart()}`;
}

function extractMachineBlocks(markdown) {
  const blocks = [];
  const fenceRe = /```ya?ml\s+(\S+)\n([\s\S]*?)\n```/g;
  let match;
  while ((match = fenceRe.exec(markdown)) !== null) {
    const kind = match[1];
    if (MACHINE_BLOCK_KINDS.has(kind)) {
      blocks.push({ kind, fence: match[0] });
    }
  }
  return blocks;
}
