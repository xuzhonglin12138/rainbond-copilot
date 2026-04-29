import type { CompiledWorkflowBranch } from "./compiled-types.js";
import {
  readWorkflowValueRef,
  type WorkflowValueRefContext,
} from "./workflow-value-ref.js";

export interface BranchEvalContext extends WorkflowValueRefContext {}

export interface BranchSelection {
  branch: CompiledWorkflowBranch;
  matched: "when" | "default";
}

/**
 * Select a single branch from a list. The first branch whose `when` expression
 * evaluates truthy wins. If no branches declare `when`, the first one is taken
 * as the default. If at least one branch declares `when` but none match, no
 * fallback is returned (callers decide whether to skip the stage or error).
 */
export function selectBranch(
  branches: CompiledWorkflowBranch[],
  ctx: BranchEvalContext
): BranchSelection | null {
  if (!branches || branches.length === 0) {
    return null;
  }

  const hasAnyWhen = branches.some((branch) => Boolean(branch.when));

  for (const branch of branches) {
    if (!branch.when) {
      continue;
    }
    if (evalWhenExpression(branch.when, ctx)) {
      return { branch, matched: "when" };
    }
  }

  if (!hasAnyWhen) {
    return { branch: branches[0], matched: "default" };
  }

  const fallback = branches.find((branch) => !branch.when);
  return fallback ? { branch: fallback, matched: "default" } : null;
}

/**
 * Tiny expression evaluator. Intentionally minimal — supports only what
 * SKILL.md branches need today. No general-purpose expression library is
 * pulled in.
 *
 * Supported forms:
 *   $input.foo == "bar"
 *   $input.foo != "bar"
 *   $input.foo == 42
 *   $input.foo                  (truthy check)
 *   !$input.foo                 (falsy check)
 *   $context.team_name == "x"
 *
 * Whitespace around operators is tolerated. Quotes may be ' or ".
 */
export function evalWhenExpression(
  expression: string,
  ctx: BranchEvalContext
): boolean {
  const expr = (expression || "").trim();
  if (!expr) {
    return false;
  }

  const orParts = splitLogical(expr, "||");
  if (orParts.length > 1) {
    return orParts.some((part) => evalWhenExpression(part, ctx));
  }

  const andParts = splitLogical(expr, "&&");
  if (andParts.length > 1) {
    return andParts.every((part) => evalWhenExpression(part, ctx));
  }

  if (expr.startsWith("!")) {
    const inner = expr.slice(1).trim();
    return !readValueRef(inner, ctx);
  }

  const eqMatch = expr.match(/^(\$\S+)\s*(==|!=)\s*(.+)$/);
  if (eqMatch) {
    const [, lhsRef, op, rhsRaw] = eqMatch;
    const lhs = readValueRef(lhsRef.trim(), ctx);
    const rhs = rhsRaw.trim().startsWith("$")
      ? readValueRef(rhsRaw.trim(), ctx)
      : parseLiteral(rhsRaw.trim());
    const equal = compareLoose(lhs, rhs);
    return op === "==" ? equal : !equal;
  }

  if (expr.startsWith("$")) {
    return Boolean(readValueRef(expr, ctx));
  }

  return false;
}

function readValueRef(ref: string, ctx: BranchEvalContext): unknown {
  return readWorkflowValueRef(ref, ctx);
}

function parseLiteral(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;

  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }

  return raw;
}

function compareLoose(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return a == b;
  }
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

function splitLogical(expression: string, operator: "&&" | "||"): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    const next = expression[index + 1];

    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      current += char;
      continue;
    }
    if (quote && char === quote) {
      quote = null;
      current += char;
      continue;
    }
    if (!quote && char === operator[0] && next === operator[1]) {
      parts.push(current.trim());
      current = "";
      index += 1;
      continue;
    }
    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}
