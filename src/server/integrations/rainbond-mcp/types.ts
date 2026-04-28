export interface McpSessionContext {
  sessionId: string;
  protocolVersion: string;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpTextContentItem {
  type: string;
  text: string;
}

export interface McpToolResult<T = unknown> {
  isError: boolean;
  structuredContent: T;
  content: McpTextContentItem[];
}

export interface McpRpcSuccess<TResult> {
  jsonrpc: "2.0";
  id: number | string | null;
  result: TResult;
}

export interface McpRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: {
    code: number;
    message: string;
  };
}

export type McpRpcResponse<TResult> =
  | McpRpcSuccess<TResult>
  | McpRpcError;

export interface McpInitializeResult {
  protocolVersion: string;
  serverInfo?: {
    name: string;
    version: string;
  };
}

export interface McpListToolsResult {
  tools: McpToolDefinition[];
}
