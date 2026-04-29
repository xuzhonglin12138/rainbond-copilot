export function readWorkflowValueRef(ref, ctx) {
    if (!ref.startsWith("$")) {
        return undefined;
    }
    if (ref.startsWith("$input.")) {
        return readPathValue(ctx.input, ref.slice("$input.".length));
    }
    if (ref.startsWith("$context.")) {
        return readPathValue(ctx.context, ref.slice("$context.".length));
    }
    if (ref.startsWith("$tool.")) {
        return readPathValue(ctx.tool, ref.slice("$tool.".length));
    }
    return undefined;
}
export function readPathValue(root, path) {
    if (!path) {
        return root;
    }
    const tokens = tokenizePath(path);
    let current = root;
    for (const token of tokens) {
        if (current === undefined || current === null) {
            return undefined;
        }
        if (typeof token === "number") {
            if (!Array.isArray(current)) {
                return undefined;
            }
            current = current[token];
            continue;
        }
        if (typeof current !== "object") {
            return undefined;
        }
        current = current[token];
    }
    return current;
}
function tokenizePath(path) {
    const tokens = [];
    let index = 0;
    let current = "";
    while (index < path.length) {
        const char = path[index];
        if (char === ".") {
            if (current) {
                tokens.push(current);
                current = "";
            }
            index += 1;
            continue;
        }
        if (char === "[") {
            if (current) {
                tokens.push(current);
                current = "";
            }
            const end = path.indexOf("]", index);
            if (end === -1) {
                break;
            }
            const raw = path.slice(index + 1, end).trim();
            if (/^\d+$/.test(raw)) {
                tokens.push(Number(raw));
            }
            else if ((raw.startsWith('"') && raw.endsWith('"')) ||
                (raw.startsWith("'") && raw.endsWith("'"))) {
                tokens.push(raw.slice(1, -1));
            }
            else if (raw) {
                tokens.push(raw);
            }
            index = end + 1;
            continue;
        }
        current += char;
        index += 1;
    }
    if (current) {
        tokens.push(current);
    }
    return tokens;
}
