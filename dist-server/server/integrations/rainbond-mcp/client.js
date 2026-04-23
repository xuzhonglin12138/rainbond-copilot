import { MCP_HTTP_PROTOCOL_VERSION, } from "./tool-catalog.js";
function trimTrailingSlash(input) {
    return input.endsWith("/") ? input.slice(0, -1) : input;
}
function getHeader(headers, name) {
    if (!headers || typeof headers.get !== "function") {
        return "";
    }
    return headers.get(name) || "";
}
export class RainbondMcpClient {
    constructor(options) {
        this.requestId = 0;
        this.session = null;
        this.forwardedHeaders = {};
        this.fetchImpl = options.fetchImpl || fetch;
        this.endpoint = `${trimTrailingSlash(options.baseUrl)}/console/mcp/query`;
    }
    async initialize(headers = {}) {
        const response = await this.request({
            jsonrpc: "2.0",
            id: this.nextRequestId(),
            method: "initialize",
        }, headers, false);
        const result = response.result;
        this.forwardedHeaders = { ...headers };
        this.session = {
            sessionId: getHeader(response.headers, "Mcp-Session-Id"),
            protocolVersion: getHeader(response.headers, "MCP-Protocol-Version") ||
                result.protocolVersion ||
                MCP_HTTP_PROTOCOL_VERSION,
        };
        return this.session;
    }
    async listTools() {
        if (!this.session) {
            throw new Error("Rainbond MCP session has not been initialized");
        }
        const response = await this.request({
            jsonrpc: "2.0",
            id: this.nextRequestId(),
            method: "tools/list",
        });
        return response.result.tools || [];
    }
    async callTool(name, arguments_) {
        if (!this.session) {
            throw new Error("Rainbond MCP session has not been initialized");
        }
        const response = await this.request({
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
    nextRequestId() {
        this.requestId += 1;
        return this.requestId;
    }
    async request(payload, headers = this.forwardedHeaders, includeSession = true) {
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
        const json = (await response.json());
        if ("error" in json) {
            throw new Error(json.error.message);
        }
        return {
            result: json.result,
            headers: response.headers,
        };
    }
}
