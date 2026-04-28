// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { RainbondMcpClient } from "../../src/server/integrations/rainbond-mcp/client";

function jsonResponse(payload: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name: string) {
        const key = Object.keys(headers).find(
          (item) => item.toLowerCase() === name.toLowerCase()
        );
        return key ? headers[key] : null;
      },
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
    clone() {
      return jsonResponse(payload, headers);
    },
  };
}

function errorJsonResponse(status: number, payload: unknown) {
  return {
    ok: false,
    status,
    headers: {
      get() {
        return null;
      },
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
    clone() {
      return errorJsonResponse(status, payload);
    },
  };
}

describe("RainbondMcpClient", () => {
  it("initializes MCP session and lists visible tools", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            jsonrpc: "2.0",
            id: 1,
            result: {
              protocolVersion: "2025-03-26",
              serverInfo: { name: "rainbond-console-mcp", version: "0.1.0" },
            },
          },
          {
            "Mcp-Session-Id": "session_123",
            "MCP-Protocol-Version": "2025-03-26",
          }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: {
            tools: [{ name: "rainbond_get_current_user" }],
          },
        })
      );

    const client = new RainbondMcpClient({
      baseUrl: "http://console.test",
      fetchImpl,
    });

    const session = await client.initialize({ authorization: "GRJWT token" });
    const tools = await client.listTools();

    expect(session.sessionId).toBe("session_123");
    expect(session.protocolVersion).toBe("2025-03-26");
    expect(tools).toEqual([{ name: "rainbond_get_current_user" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("calls a tool and returns structuredContent", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            jsonrpc: "2.0",
            id: 1,
            result: {
              protocolVersion: "2025-03-26",
              serverInfo: { name: "rainbond-console-mcp", version: "0.1.0" },
            },
          },
          {
            "Mcp-Session-Id": "session_123",
            "MCP-Protocol-Version": "2025-03-26",
          }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: {
            isError: false,
            structuredContent: {
              user_id: "u_1",
              nick_name: "alice",
            },
            content: [{ type: "text", text: "{\"user_id\":\"u_1\"}" }],
          },
        })
      );

    const client = new RainbondMcpClient({
      baseUrl: "http://console.test",
      fetchImpl,
    });

    await client.initialize({ authorization: "GRJWT token" });
    const result = await client.callTool("rainbond_get_current_user", {});

    expect(result).toHaveProperty("structuredContent");
    expect(result.structuredContent).toMatchObject({
      user_id: "u_1",
      nick_name: "alice",
    });
  });

  it("forwards authorization and cookie headers across initialize and tool calls", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            jsonrpc: "2.0",
            id: 1,
            result: {
              protocolVersion: "2025-03-26",
              serverInfo: { name: "rainbond-console-mcp", version: "0.1.0" },
            },
          },
          {
            "Mcp-Session-Id": "session_123",
            "MCP-Protocol-Version": "2025-03-26",
          }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: {
            isError: false,
            structuredContent: { ok: true },
            content: [],
          },
        })
      );

    const client = new RainbondMcpClient({
      baseUrl: "http://console.test",
      fetchImpl,
    });

    await client.initialize({
      authorization: "GRJWT token",
      cookie: "token=jwt-token; sessionid=abc",
      teamName: "team-a",
      regionName: "region-a",
    });
    await client.callTool("rainbond_get_current_user", {});

    const initializeHeaders = fetchImpl.mock.calls[0][1]?.headers as Headers;
    const toolHeaders = fetchImpl.mock.calls[1][1]?.headers as Headers;

    expect(initializeHeaders.get("Authorization")).toBe("GRJWT token");
    expect(initializeHeaders.get("Cookie")).toBe("token=jwt-token; sessionid=abc");
    expect(initializeHeaders.get("X-Team-Name")).toBe("team-a");
    expect(initializeHeaders.get("X-Region-Name")).toBe("region-a");

    expect(toolHeaders.get("Authorization")).toBe("GRJWT token");
    expect(toolHeaders.get("Cookie")).toBe("token=jwt-token; sessionid=abc");
    expect(toolHeaders.get("Mcp-Session-Id")).toBe("session_123");
  });

  it("includes structured backend error details for non-200 MCP responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            jsonrpc: "2.0",
            id: 1,
            result: {
              protocolVersion: "2025-03-26",
              serverInfo: { name: "rainbond-console-mcp", version: "0.1.0" },
            },
          },
          {
            "Mcp-Session-Id": "session_123",
            "MCP-Protocol-Version": "2025-03-26",
          }
        )
      )
      .mockResolvedValueOnce(
        errorJsonResponse(500, {
          isError: true,
          structuredContent: {
            msg_show: "组件异常",
          },
        })
      );

    const client = new RainbondMcpClient({
      baseUrl: "http://console.test",
      fetchImpl,
    });

    await client.initialize({ authorization: "GRJWT token" });

    await expect(
      client.callTool("rainbond_vertical_scale_component", {})
    ).rejects.toThrow(
      "Rainbond MCP request failed with status 500: 组件异常"
    );
  });
});
