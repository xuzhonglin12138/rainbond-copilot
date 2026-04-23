import type { ToolDefinition } from "../../../llm/types.js";
import type { McpToolDefinition, McpToolResult } from "./types.js";

export interface RainbondQueryToolClient {
  listTools(): Promise<McpToolDefinition[]>;
  callTool<T = unknown>(
    name: string,
    arguments_: Record<string, unknown>
  ): Promise<McpToolResult<T>>;
}

const READ_ONLY_NAME_PREFIXES = [
  "rainbond_get_",
  "rainbond_query_",
  "rainbond_list_",
];

export function isReadOnlyMcpToolName(name: string): boolean {
  return READ_ONLY_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function filterReadOnlyMcpTools(
  tools: McpToolDefinition[]
): McpToolDefinition[] {
  return tools.filter(
    (tool) => !!tool.name && isReadOnlyMcpToolName(tool.name)
  );
}

export function toLlmToolDefinition(tool: McpToolDefinition): ToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description:
        tool.description || `Call Rainbond MCP query tool ${tool.name}`,
      parameters: ((tool.inputSchema as ToolDefinition["function"]["parameters"]) || {
        type: "object",
        properties: {},
      }),
    },
  };
}

export function buildReadOnlyMcpToolDefinitions(
  tools: McpToolDefinition[]
): ToolDefinition[] {
  return filterReadOnlyMcpTools(tools).map(toLlmToolDefinition);
}
