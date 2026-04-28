function readHeader(headers, name) {
    const value = headers[name];
    if (Array.isArray(value)) {
        return value[0]?.trim() ?? "";
    }
    return typeof value === "string" ? value.trim() : "";
}
export function extractConsoleForwardHeaders(headers) {
    return {
        authorization: readHeader(headers, "authorization") || undefined,
        cookie: readHeader(headers, "cookie") || undefined,
        regionName: readHeader(headers, "x-region-name") || undefined,
        teamName: readHeader(headers, "x-team-name") || undefined,
    };
}
