const READ_ONLY_NAME_PREFIXES = [
    "rainbond_get_",
    "rainbond_query_",
    "rainbond_list_",
];
export function isReadOnlyMcpToolName(name) {
    return READ_ONLY_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}
export function filterReadOnlyMcpTools(tools) {
    return tools.filter((tool) => !!tool.name && isReadOnlyMcpToolName(tool.name));
}
export function toLlmToolDefinition(tool) {
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description || `Call Rainbond MCP query tool ${tool.name}`,
            parameters: (tool.inputSchema || {
                type: "object",
                properties: {},
            }),
        },
    };
}
export function buildReadOnlyMcpToolDefinitions(tools) {
    return filterReadOnlyMcpTools(tools).map(toLlmToolDefinition);
}
