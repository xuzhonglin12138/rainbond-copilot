/**
 * Select a single branch from a list. The first branch whose `when` expression
 * evaluates truthy wins. If no branches declare `when`, the first one is taken
 * as the default. If at least one branch declares `when` but none match, no
 * fallback is returned (callers decide whether to skip the stage or error).
 */
export function selectBranch(branches, ctx) {
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
export function evalWhenExpression(expression, ctx) {
    const expr = (expression || "").trim();
    if (!expr) {
        return false;
    }
    if (expr.startsWith("!")) {
        const inner = expr.slice(1).trim();
        return !readValueRef(inner, ctx);
    }
    const eqMatch = expr.match(/^(\$\S+)\s*(==|!=)\s*(.+)$/);
    if (eqMatch) {
        const [, lhsRef, op, rhsRaw] = eqMatch;
        const lhs = readValueRef(lhsRef.trim(), ctx);
        const rhs = parseLiteral(rhsRaw.trim());
        const equal = compareLoose(lhs, rhs);
        return op === "==" ? equal : !equal;
    }
    if (expr.startsWith("$")) {
        return Boolean(readValueRef(expr, ctx));
    }
    return false;
}
function readValueRef(ref, ctx) {
    if (!ref.startsWith("$")) {
        return undefined;
    }
    if (ref.startsWith("$input.")) {
        return ctx.input[ref.slice("$input.".length)];
    }
    if (ref.startsWith("$context.")) {
        return ctx.context[ref.slice("$context.".length)];
    }
    return undefined;
}
function parseLiteral(raw) {
    if (raw === "true")
        return true;
    if (raw === "false")
        return false;
    if (raw === "null")
        return null;
    if ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))) {
        return raw.slice(1, -1);
    }
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
        return Number(raw);
    }
    return raw;
}
function compareLoose(a, b) {
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
