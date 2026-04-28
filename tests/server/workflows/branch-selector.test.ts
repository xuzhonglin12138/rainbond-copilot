// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  evalWhenExpression,
  selectBranch,
  type BranchEvalContext,
} from "../../../src/server/workflows/branch-selector";
import type { CompiledWorkflowBranch } from "../../../src/server/workflows/compiled-types";

const ctx = (
  overrides: Partial<BranchEvalContext> = {}
): BranchEvalContext => ({
  input: overrides.input || {},
  context: overrides.context || {},
});

describe("evalWhenExpression", () => {
  it("matches string equality", () => {
    expect(
      evalWhenExpression('$input.mode == "build_logs"', ctx({ input: { mode: "build_logs" } }))
    ).toBe(true);
    expect(
      evalWhenExpression('$input.mode == "build_logs"', ctx({ input: { mode: "logs" } }))
    ).toBe(false);
  });

  it("matches string inequality", () => {
    expect(
      evalWhenExpression('$input.mode != "build_logs"', ctx({ input: { mode: "logs" } }))
    ).toBe(true);
    expect(
      evalWhenExpression('$input.mode != "build_logs"', ctx({ input: { mode: "build_logs" } }))
    ).toBe(false);
  });

  it("matches numeric equality with loose coercion", () => {
    expect(
      evalWhenExpression("$input.count == 3", ctx({ input: { count: 3 } }))
    ).toBe(true);
    expect(
      evalWhenExpression("$input.count == 3", ctx({ input: { count: "3" } }))
    ).toBe(true);
  });

  it("matches boolean equality", () => {
    expect(
      evalWhenExpression("$input.flag == true", ctx({ input: { flag: true } }))
    ).toBe(true);
    expect(
      evalWhenExpression("$input.flag == false", ctx({ input: { flag: true } }))
    ).toBe(false);
  });

  it("supports truthy and falsy bare references", () => {
    expect(evalWhenExpression("$input.value", ctx({ input: { value: "x" } }))).toBe(true);
    expect(evalWhenExpression("$input.value", ctx({ input: {} }))).toBe(false);
    expect(evalWhenExpression("!$input.value", ctx({ input: {} }))).toBe(true);
    expect(evalWhenExpression("!$input.value", ctx({ input: { value: 1 } }))).toBe(false);
  });

  it("reads from $context too", () => {
    expect(
      evalWhenExpression('$context.team == "team-a"', ctx({ context: { team: "team-a" } }))
    ).toBe(true);
  });

  it("returns false on unknown / malformed expressions", () => {
    expect(evalWhenExpression("", ctx())).toBe(false);
    expect(evalWhenExpression("nonsense", ctx())).toBe(false);
  });
});

describe("selectBranch", () => {
  const branches: CompiledWorkflowBranch[] = [
    {
      id: "build",
      tool: "rainbond_get_component_build_logs",
      when: '$input.mode == "build_logs"',
      args: {},
    },
    {
      id: "logs",
      tool: "rainbond_get_component_logs",
      when: '$input.mode == "logs"',
      args: {},
    },
    {
      id: "summary",
      tool: "rainbond_get_component_summary",
      args: {},
    },
  ];

  it("selects the first matching when-branch", () => {
    const sel = selectBranch(branches, ctx({ input: { mode: "build_logs" } }));
    expect(sel?.branch.id).toBe("build");
    expect(sel?.matched).toBe("when");
  });

  it("falls back to the unconditional branch when no when matches", () => {
    const sel = selectBranch(branches, ctx({ input: { mode: "weird" } }));
    expect(sel?.branch.id).toBe("summary");
    expect(sel?.matched).toBe("default");
  });

  it("uses the first branch when no branch declares when", () => {
    const all: CompiledWorkflowBranch[] = [
      { id: "a", tool: "tool_a", args: {} },
      { id: "b", tool: "tool_b", args: {} },
    ];
    const sel = selectBranch(all, ctx());
    expect(sel?.branch.id).toBe("a");
    expect(sel?.matched).toBe("default");
  });

  it("returns null for empty branch list", () => {
    expect(selectBranch([], ctx())).toBeNull();
  });

  it("returns null when all branches have when and none match", () => {
    const allConditional: CompiledWorkflowBranch[] = [
      { id: "a", tool: "tool_a", when: '$input.x == "1"', args: {} },
      { id: "b", tool: "tool_b", when: '$input.x == "2"', args: {} },
    ];
    expect(selectBranch(allConditional, ctx({ input: { x: "3" } }))).toBeNull();
  });
});
