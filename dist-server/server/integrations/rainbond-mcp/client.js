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
async function readErrorResponseMessage(response) {
    try {
        const cloned = response.clone();
        const payload = await cloned.json();
        if (payload && typeof payload === "object") {
            const jsonrpcError = payload.error &&
                typeof payload.error.message === "string"
                ? payload.error.message
                : "";
            if (jsonrpcError) {
                return jsonrpcError;
            }
            const directMessage = typeof payload.msg_show === "string" && payload.msg_show
                ? payload.msg_show
                : typeof payload.msg === "string" && payload.msg
                    ? payload.msg
                    : typeof payload.message === "string" && payload.message
                        ? payload.message
                        : "";
            if (directMessage) {
                return directMessage;
            }
            if (payload.result && typeof payload.result === "object") {
                const result = payload.result;
                const structured = result.structuredContent && typeof result.structuredContent === "object"
                    ? result.structuredContent
                    : result;
                const structuredMessage = typeof structured.msg_show === "string" && structured.msg_show
                    ? structured.msg_show
                    : typeof structured.msg === "string" && structured.msg
                        ? structured.msg
                        : typeof structured.message === "string" && structured.message
                            ? structured.message
                            : "";
                if (structuredMessage) {
                    return structuredMessage;
                }
            }
        }
    }
    catch {
        // fall through to text body parsing
    }
    try {
        const cloned = response.clone();
        const text = (await cloned.text()).trim();
        if (text) {
            return text.slice(0, 500);
        }
    }
    catch {
        // ignore text parsing failure
    }
    return "";
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
            const detail = await readErrorResponseMessage(response);
            throw new Error(detail
                ? `Rainbond MCP request failed with status ${response.status}: ${detail}`
                : `Rainbond MCP request failed with status ${response.status}`);
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
