import type { ToolDefinition } from "../../../llm/types.js";
import type { McpToolDefinition } from "./types.js";
import {
  evaluateMutableToolApproval as evaluateMutableToolApprovalFromPolicy,
  renderMutableToolApprovalMessage,
  type MutableToolPolicyEntry,
} from "./mutable-tool-policy.js";
import { isReadOnlyMcpToolName } from "./query-tools.js";

export interface MutableToolApprovalDecision {
  requiresApproval: boolean;
  risk: MutableToolPolicyEntry["riskLevel"];
  reason: string;
}

export function isMutableMcpToolName(name: string): boolean {
  return !!name && name.startsWith("rainbond_") && !isReadOnlyMcpToolName(name);
}

export function filterMutableMcpTools(
  tools: McpToolDefinition[]
): McpToolDefinition[] {
  return tools.filter((tool) => !!tool.name && isMutableMcpToolName(tool.name));
}

export function toMutableLlmToolDefinition(
  tool: McpToolDefinition
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description:
        tool.description || `Call Rainbond MCP mutable tool ${tool.name}`,
      parameters: ((tool.inputSchema as ToolDefinition["function"]["parameters"]) || {
        type: "object",
        properties: {},
      }),
    },
  };
}

export function buildMutableMcpToolDefinitions(
  tools: McpToolDefinition[]
): ToolDefinition[] {
  return filterMutableMcpTools(tools).map(toMutableLlmToolDefinition);
}

export function evaluateMutableToolApproval(
  toolName: string,
  input: Record<string, unknown>
): MutableToolApprovalDecision {
  return evaluateMutableToolApprovalFromPolicy(toolName, input);
}

export { renderMutableToolApprovalMessage };
