import { publicCopilotEventSchema, type PublicCopilotEvent } from "./contracts.js";

export interface CopilotApiActor {
  tenantId: string;
  userId: string;
  username: string;
  sourceSystem: string;
  roles: string[];
  displayName?: string;
  tenantName?: string;
}

export interface CreateCopilotApiClientOptions {
  baseUrl: string;
  actor?: CopilotApiActor;
  fetchImpl?: typeof fetch;
}

type JsonValue = Record<string, unknown>;

function trimTrailingSlash(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

export function buildCopilotActorHeaders(
  actor?: CopilotApiActor
): Record<string, string> {
  if (!actor) {
    return {};
  }

  const headers: Record<string, string> = {
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

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(
      `Copilot API request failed with ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as T;
}

export function createCopilotApiClient(options: CreateCopilotApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const actorHeaders = buildCopilotActorHeaders(options.actor);

  async function sendJson<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const headers = {
      ...actorHeaders,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };

    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers,
    });

    return parseJsonResponse<T>(response);
  }

  return {
    createSession(body: JsonValue = {}) {
      return sendJson<{
        data: {
          session_id: string;
          tenant_id: string;
          status: string;
          created_at?: string;
        };
      }>("/api/v1/copilot/sessions", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    getSession(sessionId: string) {
      return sendJson<{
        data: {
          session_id: string;
          tenant_id: string;
          status: string;
          latest_run_id?: string;
          pending_approvals?: Array<{
            approval_id: string;
            description: string;
            risk: string;
            scope?: string;
          }>;
        };
      }>(`/api/v1/copilot/sessions/${sessionId}`);
    },

    createMessageRun(
      sessionId: string,
      body: {
        message: string;
        stream?: boolean;
      }
    ) {
      return sendJson<{
        data: {
          run_id: string;
          session_id: string;
          stream_url: string;
        };
      }>(`/api/v1/copilot/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    decideApproval(
      approvalId: string,
      body: {
        decision: "approved" | "rejected";
        comment?: string;
      }
    ) {
      return sendJson<{
        data: {
          approval_id: string;
          status: string;
          resolved_at?: string;
          resolved_by?: {
            user_id?: string;
          };
        };
      }>(`/api/v1/copilot/approvals/${approvalId}/decisions`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    openEventStream(
      sessionId: string,
      runId: string,
      options: { afterSequence?: number } = {}
    ) {
      const params = new URLSearchParams();
      if (options.afterSequence !== undefined) {
        params.set("after_sequence", String(options.afterSequence));
      }

      const suffix = params.toString() ? `?${params.toString()}` : "";
      return fetchImpl(
        `${baseUrl}/api/v1/copilot/sessions/${sessionId}/runs/${runId}/events${suffix}`,
        {
          headers: {
            ...actorHeaders,
            accept: "text/event-stream",
          },
        }
      );
    },
  };
}

export async function readCopilotSseStream(
  response: Response,
  options: {
    onEvent?: (event: PublicCopilotEvent) => void;
  } = {}
): Promise<PublicCopilotEvent[]> {
  return consumeCopilotSseStream(response, options);
}

export async function consumeCopilotSseStream(
  response: Response
  ,
  options: {
    onEvent?: (event: PublicCopilotEvent) => void;
  } = {}
): Promise<PublicCopilotEvent[]> {
  const { onEvent } = options;
  if (!response.ok) {
    throw new Error(
      `Copilot SSE request failed with ${response.status} ${response.statusText}`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return [];
  }

  const decoder = new TextDecoder();
  const events: PublicCopilotEvent[] = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex >= 0) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);

      const dataLine = rawEvent
        .split("\n")
        .find((line) => line.startsWith("data: "));

      if (dataLine) {
        const parsed = publicCopilotEventSchema.parse(
          JSON.parse(dataLine.slice(6))
        );
        events.push(parsed);
        onEvent?.(parsed);
      }

      boundaryIndex = buffer.indexOf("\n\n");
    }
  }

  return events;
}
