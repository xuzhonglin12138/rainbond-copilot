import { evaluateMutableToolApproval as evaluateMutableToolApprovalFromPolicy, renderMutableToolApprovalMessage, } from "./mutable-tool-policy.js";
import { isReadOnlyMcpToolName } from "./query-tools.js";
export function isMutableMcpToolName(name) {
    return !!name && name.startsWith("rainbond_") && !isReadOnlyMcpToolName(name);
}
export function filterMutableMcpTools(tools) {
    return tools.filter((tool) => !!tool.name && isMutableMcpToolName(tool.name));
}
export function toMutableLlmToolDefinition(tool) {
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description || `Call Rainbond MCP mutable tool ${tool.name}`,
            parameters: (tool.inputSchema || {
                type: "object",
                properties: {},
            }),
        },
    };
}
export function buildMutableMcpToolDefinitions(tools) {
    return filterMutableMcpTools(tools).map(toMutableLlmToolDefinition);
}
export function evaluateMutableToolApproval(toolName, input) {
    return evaluateMutableToolApprovalFromPolicy(toolName, input);
}
export { renderMutableToolApprovalMessage };
