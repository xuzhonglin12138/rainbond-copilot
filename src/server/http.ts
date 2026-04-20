import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { withRequestActor } from "./auth/auth-middleware";
import { createServerConfig, type ServerConfig } from "./config/server-config";
import { createCopilotController } from "./controllers/copilot-controller";
import { createSseBroker } from "./events/sse-broker";
import { createInMemoryRunResumer } from "./runtime/run-resumer";
import {
  createInMemoryApprovalStore,
  type ApprovalStore,
} from "./stores/approval-store";
import {
  createInMemoryEventStore,
  type EventStore,
} from "./stores/event-store";
import {
  FileApprovalStore,
  FileEventStore,
  FileRunStore,
  FileSessionStore,
} from "./stores/file-stores";
import {
  createInMemoryRunStore,
  type RunStore,
} from "./stores/run-store";
import {
  createInMemorySessionStore,
  type SessionStore,
} from "./stores/session-store";

interface CopilotStores {
  sessionStore: SessionStore;
  runStore: RunStore;
  approvalStore: ApprovalStore;
  eventStore: EventStore;
  cleanup: Array<() => Promise<void> | void>;
}

export interface CreateCopilotApiServerOptions {
  env?: Record<string, string | undefined>;
  config?: Partial<ServerConfig>;
}

function json(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function createStores(config: ServerConfig): CopilotStores {
  if (config.storeMode === "file") {
    return {
      sessionStore: new FileSessionStore(config.dataDir),
      runStore: new FileRunStore(config.dataDir),
      approvalStore: new FileApprovalStore(config.dataDir),
      eventStore: new FileEventStore(config.dataDir),
      cleanup: [],
    };
  }

  return {
    sessionStore: createInMemorySessionStore(),
    runStore: createInMemoryRunStore(),
    approvalStore: createInMemoryApprovalStore(),
    eventStore: createInMemoryEventStore(),
    cleanup: [],
  };
}

function formatSseEvent(event: unknown): string {
  const payload = event as { type: string };
  return `event: ${payload.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createCopilotApiServer(
  options: CreateCopilotApiServerOptions = {}
): http.Server {
  const config = {
    ...createServerConfig(options.env),
    ...options.config,
  };
  const stores = createStores(config);
  const broker = createSseBroker(stores.eventStore);
  const controller = createCopilotController({
    sessionStore: stores.sessionStore,
    runStore: stores.runStore,
    approvalStore: stores.approvalStore,
    broker,
    runResumer: createInMemoryRunResumer(),
  });
  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      json(response, 400, { error: { code: "bad_request", message: "Missing URL" } });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/healthz") {
      json(response, 200, { ok: true });
      return;
    }

    let actor;
    try {
      actor = withRequestActor({
        headers: request.headers,
      }).actor;
    } catch (error: any) {
      json(response, 401, {
        error: {
          code: "unauthorized",
          message: error.message,
        },
      });
      return;
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/v1/copilot/sessions") {
        const body = await readJsonBody(request);
        const result = await controller.createSession({ actor, body });
        json(response, 200, result);
        return;
      }

      const sessionMatch = url.pathname.match(/^\/api\/v1\/copilot\/sessions\/([^/]+)$/);
      if (request.method === "GET" && sessionMatch) {
        const result = await controller.getSession({
          actor,
          params: { sessionId: sessionMatch[1] },
        });
        json(response, 200, result);
        return;
      }

      const messageMatch = url.pathname.match(
        /^\/api\/v1\/copilot\/sessions\/([^/]+)\/messages$/
      );
      if (request.method === "POST" && messageMatch) {
        const body = await readJsonBody(request);
        const result = await controller.createMessageRun({
          actor,
          params: { sessionId: messageMatch[1] },
          body,
        });
        json(response, 200, result);
        return;
      }

      const eventsMatch = url.pathname.match(
        /^\/api\/v1\/copilot\/sessions\/([^/]+)\/runs\/([^/]+)\/events$/
      );
      if (request.method === "GET" && eventsMatch) {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const replay = await controller.streamRunEvents({
          actor,
          params: {
            sessionId: eventsMatch[1],
            runId: eventsMatch[2],
          },
          query: {
            after_sequence: url.searchParams.get("after_sequence") || "0",
          },
        });

        for (const event of replay.events) {
          response.write(formatSseEvent(event));
        }

        const unsubscribe = broker.subscribe(eventsMatch[2], actor.tenantId, (event) => {
          response.write(formatSseEvent(event.payload));
        });

        request.on("close", () => {
          unsubscribe();
          response.end();
        });
        return;
      }

      const approvalMatch = url.pathname.match(
        /^\/api\/v1\/copilot\/approvals\/([^/]+)\/decisions$/
      );
      if (request.method === "POST" && approvalMatch) {
        const body = await readJsonBody(request);
        const result = await controller.decideApproval({
          actor,
          params: { approvalId: approvalMatch[1] },
          body,
        });
        json(response, 200, result);
        return;
      }

      json(response, 404, {
        error: { code: "not_found", message: "Route not found" },
      });
    } catch (error: any) {
      json(response, 500, {
        error: {
          code: "internal_error",
          message: error.message,
        },
      });
    }
  });

  server.on("close", () => {
    for (const cleanup of stores.cleanup) {
      void cleanup();
    }
  });

  return server;
}
