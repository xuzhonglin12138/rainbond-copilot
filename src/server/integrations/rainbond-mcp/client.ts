import {
  MCP_HTTP_PROTOCOL_VERSION,
} from "./tool-catalog.js";
import type {
  McpInitializeResult,
  McpListToolsResult,
  McpRpcResponse,
  McpSessionContext,
  McpToolDefinition,
  McpToolResult,
} from "./types.js";

type FetchLike = typeof fetch;

export interface RainbondMcpClientHeaders {
  authorization?: string;
  cookie?: string;
  teamName?: string;
  regionName?: string;
}

export interface RainbondMcpClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
}

interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

function trimTrailingSlash(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function getHeader(
  headers: Headers | { get?: (name: string) => string | null } | undefined,
  name: string
): string {
  if (!headers || typeof headers.get !== "function") {
    return "";
  }
  return headers.get(name) || "";
}

export class RainbondMcpClient {
  private readonly fetchImpl: FetchLike;
  private readonly endpoint: string;
  private requestId = 0;
  private session: McpSessionContext | null = null;
  private forwardedHeaders: RainbondMcpClientHeaders = {};

  constructor(options: RainbondMcpClientOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.endpoint = `${trimTrailingSlash(options.baseUrl)}/console/mcp/query`;
  }

  async initialize(
    headers: RainbondMcpClientHeaders = {}
  ): Promise<McpSessionContext> {
    const response = await this.request<McpInitializeResult>(
      {
        jsonrpc: "2.0",
        id: this.nextRequestId(),
        method: "initialize",
      },
      headers,
      false
    );
    const result = response.result;

    this.forwardedHeaders = { ...headers };
    this.session = {
      sessionId: getHeader(response.headers, "Mcp-Session-Id"),
      protocolVersion:
        getHeader(response.headers, "MCP-Protocol-Version") ||
        result.protocolVersion ||
        MCP_HTTP_PROTOCOL_VERSION,
    };

    return this.session;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    if (!this.session) {
      throw new Error("Rainbond MCP session has not been initialized");
    }

    const response = await this.request<McpListToolsResult>({
      jsonrpc: "2.0",
      id: this.nextRequestId(),
      method: "tools/list",
    });

    return response.result.tools || [];
  }

  async callTool<T = unknown>(
    name: string,
    arguments_: Record<string, unknown>
  ): Promise<McpToolResult<T>> {
    if (!this.session) {
      throw new Error("Rainbond MCP session has not been initialized");
    }

    const response = await this.request<McpToolResult<T>>({
      jsonrpc: "2.0",
      id: this.nextRequestId(),
      method: "tools/call",
      params: {
        name,
        arguments: arguments_,
      },
    });

    return response.result;
  }

  private nextRequestId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private async request<TResult>(
    payload: RpcRequest,
    headers: RainbondMcpClientHeaders = this.forwardedHeaders,
    includeSession = true
  ): Promise<{ result: TResult; headers: Headers }> {
    const requestHeaders = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      "MCP-Protocol-Version": this.session?.protocolVersion || MCP_HTTP_PROTOCOL_VERSION,
    });

    if (headers.authorization) {
      requestHeaders.set("Authorization", headers.authorization);
    }
    if (headers.cookie) {
      requestHeaders.set("Cookie", headers.cookie);
    }
    if (headers.teamName) {
      requestHeaders.set("X-Team-Name", headers.teamName);
    }
    if (headers.regionName) {
      requestHeaders.set("X-Region-Name", headers.regionName);
    }
    if (includeSession && this.session?.sessionId) {
      requestHeaders.set("Mcp-Session-Id", this.session.sessionId);
    }

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Rainbond MCP request failed with status ${response.status}`);
    }

    const json = (await response.json()) as McpRpcResponse<TResult>;
    if ("error" in json) {
      throw new Error(json.error.message);
    }

    return {
      result: json.result,
      headers: response.headers,
    };
  }
}
