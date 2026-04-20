import { publicCopilotEventSchema } from "./contracts";
function trimTrailingSlash(input) {
    return input.endsWith("/") ? input.slice(0, -1) : input;
}
export function buildCopilotActorHeaders(actor) {
    const headers = {
        "x-copilot-tenant-id": actor.tenantId,
        "x-copilot-user-id": actor.userId,
        "x-copilot-username": actor.username,
        "x-copilot-source-system": actor.sourceSystem,
    };
    if (actor.roles.length > 0) {
        headers["x-copilot-roles"] = actor.roles.join(",");
    }
    if (actor.displayName) {
        headers["x-copilot-display-name"] = actor.displayName;
    }
    if (actor.tenantName) {
        headers["x-copilot-tenant-name"] = actor.tenantName;
    }
    return headers;
}
async function parseJsonResponse(response) {
    if (!response.ok) {
        throw new Error(`Copilot API request failed with ${response.status} ${response.statusText}`);
    }
    return (await response.json());
}
export function createCopilotApiClient(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const baseUrl = trimTrailingSlash(options.baseUrl);
    const actorHeaders = buildCopilotActorHeaders(options.actor);
    async function sendJson(path, init = {}) {
        const headers = {
            ...actorHeaders,
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...init.headers,
        };
        const response = await fetchImpl(`${baseUrl}${path}`, {
            ...init,
            headers,
        });
        return parseJsonResponse(response);
    }
    return {
        createSession(body = {}) {
            return sendJson("/api/v1/copilot/sessions", {
                method: "POST",
                body: JSON.stringify(body),
            });
        },
        getSession(sessionId) {
            return sendJson(`/api/v1/copilot/sessions/${sessionId}`);
        },
        createMessageRun(sessionId, body) {
            return sendJson(`/api/v1/copilot/sessions/${sessionId}/messages`, {
                method: "POST",
                body: JSON.stringify(body),
            });
        },
        decideApproval(approvalId, body) {
            return sendJson(`/api/v1/copilot/approvals/${approvalId}/decisions`, {
                method: "POST",
                body: JSON.stringify(body),
            });
        },
        openEventStream(sessionId, runId, options = {}) {
            const params = new URLSearchParams();
            if (options.afterSequence !== undefined) {
                params.set("after_sequence", String(options.afterSequence));
            }
            const suffix = params.toString() ? `?${params.toString()}` : "";
            return fetchImpl(`${baseUrl}/api/v1/copilot/sessions/${sessionId}/runs/${runId}/events${suffix}`, {
                headers: {
                    ...actorHeaders,
                    accept: "text/event-stream",
                },
            });
        },
    };
}
export async function readCopilotSseStream(response) {
    if (!response.ok) {
        throw new Error(`Copilot SSE request failed with ${response.status} ${response.statusText}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
        return [];
    }
    const decoder = new TextDecoder();
    const events = [];
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundaryIndex = buffer.indexOf("\n\n");
        while (boundaryIndex >= 0) {
            const rawEvent = buffer.slice(0, boundaryIndex);
            buffer = buffer.slice(boundaryIndex + 2);
            const dataLine = rawEvent
                .split("\n")
                .find((line) => line.startsWith("data: "));
            if (dataLine) {
                const parsed = publicCopilotEventSchema.parse(JSON.parse(dataLine.slice(6)));
                events.push(parsed);
            }
            boundaryIndex = buffer.indexOf("\n\n");
        }
    }
    return events;
}
