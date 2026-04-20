function readHeader(headers, name) {
    const value = headers[name];
    if (Array.isArray(value)) {
        return value[0]?.trim() ?? "";
    }
    return typeof value === "string" ? value.trim() : "";
}
function parseRoles(rawRoles) {
    if (!rawRoles) {
        return [];
    }
    return rawRoles
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean);
}
export function parseRequestActor(headers) {
    const tenantId = readHeader(headers, "x-copilot-tenant-id");
    const userId = readHeader(headers, "x-copilot-user-id");
    const username = readHeader(headers, "x-copilot-username");
    const sourceSystem = readHeader(headers, "x-copilot-source-system");
    if (!tenantId || !userId || !username || !sourceSystem) {
        throw new Error("Missing trusted Copilot actor headers");
    }
    return {
        tenantId,
        userId,
        username,
        sourceSystem,
        roles: parseRoles(readHeader(headers, "x-copilot-roles")),
        displayName: readHeader(headers, "x-copilot-display-name") || undefined,
        tenantName: readHeader(headers, "x-copilot-tenant-name") || undefined,
    };
}
