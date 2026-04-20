// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  buildCopilotActorHeaders,
  createCopilotApiClient,
  readCopilotSseStream,
} from "../../src/shared/copilot-api-client";

describe("copilot api client", () => {
  it("sends trusted actor headers when creating a session", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            session_id: "cs_123",
            tenant_id: "t_123",
            status: "active",
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
        }
      );
    });

    const client = createCopilotApiClient({
      baseUrl: "http://127.0.0.1:8787",
      actor: {
        tenantId: "t_123",
        userId: "u_456",
        username: "alice",
        sourceSystem: "ops-console",
        roles: ["app_admin", "app_operator"],
      },
      fetchImpl,
    });

    await client.createSession({
      context: {
        app_id: "app-001",
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/v1/copilot/sessions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-copilot-tenant-id": "t_123",
          "x-copilot-user-id": "u_456",
          "x-copilot-username": "alice",
          "x-copilot-source-system": "ops-console",
          "x-copilot-roles": "app_admin,app_operator",
        }),
      })
    );
  });

  it("parses SSE messages into typed public events", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: run.status\ndata: {"type":"run.status","tenantId":"t_123","sessionId":"cs_123","runId":"run_123","sequence":1,"timestamp":"2026-04-20T10:00:00Z","data":{"status":"thinking"}}\n\n'
            )
          );
          controller.enqueue(
            encoder.encode(
              'event: chat.message\ndata: {"type":"chat.message","tenantId":"t_123","sessionId":"cs_123","runId":"run_123","sequence":2,"timestamp":"2026-04-20T10:00:01Z","data":{"role":"assistant","content":"done"}}\n\n'
            )
          );
          controller.close();
        },
      }),
      {
        headers: {
          "content-type": "text/event-stream",
        },
      }
    );

    const events = await readCopilotSseStream(response);

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("run.status");
    expect(events[1].data).toMatchObject({
      role: "assistant",
      content: "done",
    });
  });

  it("builds trusted actor headers without optional fields", () => {
    expect(
      buildCopilotActorHeaders({
        tenantId: "t_123",
        userId: "u_456",
        username: "alice",
        sourceSystem: "ops-console",
        roles: [],
      })
    ).toEqual({
      "x-copilot-tenant-id": "t_123",
      "x-copilot-user-id": "u_456",
      "x-copilot-username": "alice",
      "x-copilot-source-system": "ops-console",
    });
  });
});
