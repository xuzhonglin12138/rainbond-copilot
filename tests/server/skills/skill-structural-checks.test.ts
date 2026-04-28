// @vitest-environment node
/**
 * Layer-1 structural checks for every SKILL.md the framework loads.
 *
 * These run on every `npm test` and catch regressions like:
 *   - SKILL.md fails to compile (yaml block syntax broken, missing required fields)
 *   - branch references an MCP tool that does not exist
 *   - when-expression cannot be parsed by branch-selector
 *   - $input.<key> references a key absent from input_schema.properties
 *   - output_contract.schema_ref points to a missing or unparseable file
 *   - eval fixture pairs are incomplete or have unparseable yaml
 *
 * They do NOT call the LLM. Live LLM golden replay is a separate (Layer-2)
 * workflow that runs nightly / on-demand outside default CI.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  getRegisteredSkills,
  initializeSkillRegistry,
} from "../../../src/server/skills/skill-registry";

await initializeSkillRegistry();
import { evalWhenExpression } from "../../../src/server/workflows/branch-selector";
import { isReadOnlyMcpToolName } from "../../../src/server/integrations/rainbond-mcp/query-tools";
import type {
  CompiledSkill,
  CompiledWorkflowBranch,
  CompiledWorkflowStage,
} from "../../../src/server/workflows/compiled-types";

const MUTABLE_POLICY_PATH = join(
  process.cwd(),
  "src/server/integrations/rainbond-mcp/mutable-tool-policy.ts"
);

beforeAll(async () => {
  await initializeSkillRegistry();
});

function loadKnownMutableToolNames(): Set<string> {
  const raw = readFileSync(MUTABLE_POLICY_PATH, "utf-8");
  const names = new Set<string>();
  const re = /\{\s*name:\s*"(rainbond_[a-z_]+)"/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    names.add(m[1]);
  }
  return names;
}

function isKnownMcpTool(name: string, mutable: Set<string>): boolean {
  if (isReadOnlyMcpToolName(name)) return true;
  return mutable.has(name);
}

function eachToolInvocation(
  skill: CompiledSkill
): Array<{ location: string; tool: string; args: Record<string, unknown> }> {
  const out: Array<{ location: string; tool: string; args: Record<string, unknown> }> = [];
  for (const stage of skill.workflow.stages as CompiledWorkflowStage[]) {
    if (stage.kind === "tool_call" && stage.tool) {
      out.push({
        location: `stage ${stage.id}`,
        tool: stage.tool,
        args: stage.args || {},
      });
    }
    for (const branch of (stage.branches || []) as CompiledWorkflowBranch[]) {
      out.push({
        location: `stage ${stage.id} branch ${branch.id}`,
        tool: branch.tool,
        args: branch.args || {},
      });
    }
  }
  return out;
}

function collectInputRefs(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    if (value.startsWith("$input.")) {
      into.add(value.slice("$input.".length));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectInputRefs(v, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectInputRefs(v, into);
  }
}

function collectInputRefsFromWhen(when: string | undefined, into: Set<string>): void {
  if (!when) return;
  const re = /\$input\.([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(when)) !== null) {
    into.add(m[1]);
  }
}

const mutableToolNames = loadKnownMutableToolNames();

describe("skill structural checks (Layer 1) – global", () => {
  it("loads at least the four embedded skills the framework expects", () => {
    const skills = getRegisteredSkills();
    const ids = skills.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "rainbond-app-version-assistant",
        "rainbond-delivery-verifier",
        "rainbond-fullstack-troubleshooter",
        "rainbond-template-installer",
      ])
    );
  });

  it("knows the mutable MCP tool catalog (sanity check)", () => {
    expect(mutableToolNames.size).toBeGreaterThanOrEqual(40);
    expect(mutableToolNames.has("rainbond_install_app_model")).toBe(true);
  });

  describe.each(getRegisteredSkills().map((s) => [s.id, s] as const))(
    "%s",
    (_id, skill) => {
      it("has a non-empty narrative body with no leftover yaml machine fences", () => {
        expect(skill.narrativeBody.length).toBeGreaterThan(100);
        expect(skill.narrativeBody).not.toMatch(/```ya?ml\s+(?:workflow|tool_policy|output_contract)/);
      });

      it("declares at least one entry intent for LLM router discovery", () => {
        const intents = skill.workflow.entry?.intents || [];
        expect(intents.length).toBeGreaterThan(0);
        for (const intent of intents) {
          expect(intent).toMatch(/\S/);
        }
      });

      it("input_schema.required is a subset of input_schema.properties", () => {
        const required = skill.workflow.input_schema?.required || [];
        const properties = Object.keys(
          skill.workflow.input_schema?.properties || {}
        );
        for (const key of required) {
          expect(properties).toContain(key);
        }
      });

      it("input_schema enum values (if any) are non-empty unique string arrays", () => {
        const properties = skill.workflow.input_schema?.properties || {};
        for (const [name, prop] of Object.entries(properties)) {
          const enumValues = (prop as { enum?: unknown }).enum;
          if (enumValues === undefined) continue;
          expect(Array.isArray(enumValues), `${name}.enum must be array`).toBe(true);
          const arr = enumValues as unknown[];
          expect(arr.length, `${name}.enum must be non-empty`).toBeGreaterThan(0);
          expect(new Set(arr).size, `${name}.enum has duplicates`).toBe(arr.length);
          for (const v of arr) {
            expect(typeof v, `${name}.enum entries must be string`).toBe("string");
          }
        }
      });

      it("every branch when-expression parses without throwing", () => {
        const ctx = { input: {}, context: {} };
        for (const stage of skill.workflow.stages) {
          for (const branch of stage.branches || []) {
            if (!branch.when) continue;
            expect(
              () => evalWhenExpression(branch.when!, ctx),
              `${stage.id}/${branch.id} when="${branch.when}"`
            ).not.toThrow();
          }
        }
      });

      it("every $input.<key> reference points to a declared input_schema property", () => {
        const declared = new Set(
          Object.keys(skill.workflow.input_schema?.properties || {})
        );
        const referenced = new Set<string>();
        for (const stage of skill.workflow.stages) {
          collectInputRefs(stage.args, referenced);
          for (const branch of stage.branches || []) {
            collectInputRefs(branch.args, referenced);
            collectInputRefsFromWhen(branch.when, referenced);
          }
        }
        for (const key of referenced) {
          expect(
            declared.has(key),
            `$input.${key} referenced but not declared in input_schema.properties`
          ).toBe(true);
        }
      });

      it("every tool referenced is a known MCP tool (read-only prefix or mutable policy)", () => {
        for (const inv of eachToolInvocation(skill)) {
          expect(
            isKnownMcpTool(inv.tool, mutableToolNames),
            `${inv.location} references unknown MCP tool "${inv.tool}"`
          ).toBe(true);
        }
      });

      it("output_contract.schema_ref (if declared) points to a parseable yaml file", () => {
        const ref = (skill.outputContract as { schema_ref?: string } | undefined)
          ?.schema_ref;
        if (!ref) return;
        const resolved = ref.startsWith(".")
          ? join(dirname(skill.sourcePath), ref)
          : ref;
        expect(existsSync(resolved), `schema not found: ${resolved}`).toBe(true);
        const raw = readFileSync(resolved, "utf-8");
        expect(() => YAML.parse(raw), `yaml parse failed: ${resolved}`).not.toThrow();
      });

      it("eval fixtures (if directory exists) are paired and parse cleanly", () => {
        const evalDir = join(dirname(skill.sourcePath), "evals");
        if (!existsSync(evalDir) || !statSync(evalDir).isDirectory()) return;

        const files = readdirSync(evalDir);
        const expectedFiles = files.filter((f) => f.endsWith(".expected.yaml"));
        const responseFiles = files.filter((f) => f.endsWith(".response.md"));

        expect(expectedFiles.length, "expects at least one .expected.yaml").toBeGreaterThan(0);

        const expectedBases = new Set(
          expectedFiles.map((f) => f.replace(/\.expected\.yaml$/, ""))
        );
        const responseBases = new Set(
          responseFiles.map((f) => f.replace(/\.response\.md$/, ""))
        );
        for (const base of expectedBases) {
          expect(
            responseBases.has(base),
            `eval fixture missing response markdown: ${base}.response.md`
          ).toBe(true);
        }

        for (const f of expectedFiles) {
          const raw = readFileSync(join(evalDir, f), "utf-8");
          expect(() => YAML.parse(raw), `yaml parse failed: ${f}`).not.toThrow();
        }
      });
    }
  );
});
