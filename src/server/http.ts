import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  resolveRequestActor,
  type AuthSubjectResolverLike,
} from "./auth/auth-middleware.js";
import { AuthSubjectResolver } from "./auth/auth-subject-resolver.js";
import { createServerConfig, type ServerConfig } from "./config/server-config.js";
import { createCopilotController } from "./controllers/copilot-controller.js";
import { createSseBroker } from "./events/sse-broker.js";
import { RainbondMcpClient } from "./integrations/rainbond-mcp/client.js";
import { createInMemoryRunResumer } from "./runtime/run-resumer.js";
import { SessionScopedRainbondActionAdapter } from "./runtime/session-scoped-action-adapter.js";
import {
  createSkillRouter,
  type SkillRouter,
  type SkillRouterClient,
} from "./skills/skill-router.js";
import {
  createSkillSummarizer,
  type WorkflowSummarizer,
} from "./skills/skill-summarizer.js";
import { OpenAIClient } from "../llm/openai-client.js";
import { CustomAnthropicClient } from "../llm/custom-anthropic-client.js";
import { getLLMConfig } from "../llm/config.js";
import {
  createInMemoryApprovalStore,
  type ApprovalStore,
} from "./stores/approval-store.js";
import {
  createInMemoryEventStore,
  type EventStore,
} from "./stores/event-store.js";
import {
  FileApprovalStore,
  FileEventStore,
  FileRunStore,
  FileSessionStore,
} from "./stores/file-stores.js";
import {
  createInMemoryRunStore,
  type RunStore,
} from "./stores/run-store.js";
import {
  createInMemorySessionStore,
  type SessionStore,
} from "./stores/session-store.js";

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
  authSubjectResolver?: AuthSubjectResolverLike;
  skillRouter?: SkillRouter;
  workflowSummarizer?: WorkflowSummarizer;
}

interface OptionalLlmIntegration {
  router?: SkillRouter;
  summarizer?: WorkflowSummarizer;
}

function buildOptionalLlmIntegration(
  env: Record<string, string | undefined>
): OptionalLlmIntegration {
  const flag = (env.RAINBOND_SKILL_ROUTER || "").trim().toLowerCase();
  if (flag !== "llm") {
    return {};
  }

  let llmConfig;
  try {
    llmConfig = getLLMConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[skill-router] disabled: cannot load LLM config (${message})`);
    return {};
  }

  const llmClient: SkillRouterClient =
    llmConfig.provider === "anthropic"
      ? new CustomAnthropicClient(llmConfig)
      : new OpenAIClient(llmConfig);

  console.log(
    `[skill-router] enabled with provider=${llmConfig.provider} model=${llmConfig.model}`
  );
  console.log(
    `[skill-summarizer] enabled (shares LLM client with skill-router)`
  );

  return {
    router: createSkillRouter({ llmClient }),
    summarizer: createSkillSummarizer({ llmClient }),
  };
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

function isTerminalCopilotEvent(event: any): boolean {
  return (
    event &&
    event.type === "run.status" &&
    event.data &&
    ["done", "error", "waiting_approval", "cancelled"].includes(event.data.status)
  );
}

function readSessionRegionName(
  session: { context?: Record<string, unknown> } | null | undefined
): string | undefined {
  if (!session || !session.context) {
    return undefined;
  }
  if (typeof session.context.regionName === "string") {
    return session.context.regionName;
  }
  if (typeof session.context.region_name === "string") {
    return session.context.region_name;
  }
  return undefined;
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
  const llmIntegration = buildOptionalLlmIntegration(
    options.env || process.env
  );
  const skillRouter = options.skillRouter || llmIntegration.router;
  const workflowSummarizer =
    options.workflowSummarizer || llmIntegration.summarizer;
  const authSubjectResolver =
    options.authSubjectResolver ||
    new AuthSubjectResolver(
      new RainbondMcpClient({
        baseUrl: config.consoleBaseUrl,
      })
    );
  const createInitializedMcpClient = async ({
    actor,
    sessionId,
  }: {
    actor: any;
    sessionId: string;
  }) => {
    const session = await stores.sessionStore.getById(
      sessionId,
      actor.tenantId
    );

    if (!session || session.userId !== actor.userId) {
      throw new Error("Session not found");
    }

    if (!actor.authorization) {
      throw new Error("Authorization is required for Rainbond MCP actions");
    }
    if (!actor.cookie) {
      throw new Error("Cookie is required for Rainbond MCP actions");
    }

    const client = new RainbondMcpClient({
      baseUrl: config.consoleBaseUrl,
    });
    await client.initialize({
      authorization: actor.authorization,
      cookie: actor.cookie,
      teamName: session.teamName || actor.tenantName || actor.tenantId,
      regionName: readSessionRegionName(session) || actor.regionName,
    });

    return { client, session };
  };
  const controller = createCopilotController({
    sessionStore: stores.sessionStore,
    runStore: stores.runStore,
    approvalStore: stores.approvalStore,
    broker,
    runResumer: createInMemoryRunResumer(),
    enableRainbondAppAssistantWorkflow: true,
    skillRouter,
    workflowSummarizer,
    actionAdapterFactory: async ({ actor, sessionId }) => {
      const { client, session } = await createInitializedMcpClient({
        actor,
        sessionId,
      });

      return new SessionScopedRainbondActionAdapter(client, {
        actor,
        sessionContext: session.context,
        lastVerifiedScopeSignature: session.lastVerifiedScopeSignature,
        verifiedScope: session.verifiedScope,
      });
    },
    workflowToolClientFactory: async ({ actor, sessionId }) => {
      const { client } = await createInitializedMcpClient({
        actor,
        sessionId,
      });
      return client;
    },
    queryToolClientFactory: async ({ actor, sessionId }) => {
      const { client } = await createInitializedMcpClient({
        actor,
        sessionId,
      });
      return client;
    },
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
      actor = (
        await resolveRequestActor(
          {
            headers: request.headers,
          },
          authSubjectResolver
        )
      ).actor;
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
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.flushHeaders?.();
        response.write(": connected\n\n");

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

        if (replay.events.some(isTerminalCopilotEvent)) {
          response.end();
          return;
        }

        const unsubscribe = broker.subscribe(eventsMatch[2], actor.tenantId, (event) => {
          response.write(formatSseEvent(event.payload));
        });
        const heartbeat = setInterval(() => {
          response.write(": heartbeat\n\n");
        }, 15000);

        request.on("close", () => {
          clearInterval(heartbeat);
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
