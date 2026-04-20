// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createCopilotApiServer } from "../../src/server";

type PublicEvent = {
  type: string;
  data: Record<string, unknown>;
};

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  label: string
): Promise<Response> {
  return Promise.race([
    fetch(input, init),
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timed out while waiting for HTTP response: ${label}`)),
        2000
      );
    }),
  ]);
}

async function readSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedCount: number,
  label: string
): Promise<PublicEvent[]> {
  const decoder = new TextDecoder();
  const events: PublicEvent[] = [];
  let buffer = "";

  while (events.length < expectedCount) {
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(`Timed out while waiting for SSE events during: ${label}`)
            ),
          2000
        );
      }),
    ]);
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
        events.push(JSON.parse(dataLine.slice(6)));
      }

      boundaryIndex = buffer.indexOf("\n\n");
    }
  }

  return events;
}

const openResponses: Response[] = [];

afterEach(async () => {
  await Promise.all(
    openResponses.splice(0).map(async (response) => {
      try {
        await response.body?.cancel();
      } catch {
        // Ignore response cleanup failures in tests.
      }
    })
  );
});

describe("copilot api server", () => {
  it("streams approval lifecycle over SSE and resumes after approval", async () => {
    const server = createCopilotApiServer({
      env: {
        COPILOT_STORE_MODE: "memory",
      },
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve test server address");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const headers = {
      "content-type": "application/json",
      "x-copilot-tenant-id": "t_123",
      "x-copilot-user-id": "u_456",
      "x-copilot-username": "alice",
      "x-copilot-source-system": "ops-console",
    };

    try {
      const sessionResponse = await fetchWithTimeout(`${baseUrl}/api/v1/copilot/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      }, "create session");
      const sessionPayload = await sessionResponse.json();
      const sessionId = sessionPayload.data.session_id as string;

      const runResponse = await fetchWithTimeout(
        `${baseUrl}/api/v1/copilot/sessions/${sessionId}/messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ message: "restart frontend-ui", stream: true }),
        },
        "create message run"
      );
      const runPayload = await runResponse.json();
      const runId = runPayload.data.run_id as string;
      const streamUrl = `${baseUrl}${runPayload.data.stream_url as string}`;

      const eventsResponse = await fetchWithTimeout(streamUrl, {
        headers: {
          ...headers,
          accept: "text/event-stream",
        },
      }, "open SSE stream");
      openResponses.push(eventsResponse);

      const reader = eventsResponse.body?.getReader();
      if (!reader) {
        throw new Error("SSE response body is not readable");
      }

      const initialEvents = await readSseEvents(reader, 3, "initial replay");
      expect(initialEvents.map((event) => event.type)).toEqual([
        "run.status",
        "approval.requested",
        "run.status",
      ]);

      const approvalId = initialEvents[1].data.approval_id as string;

      const approvalResponse = await fetchWithTimeout(
        `${baseUrl}/api/v1/copilot/approvals/${approvalId}/decisions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ decision: "approved", comment: "确认执行" }),
        },
        "approve pending action"
      );
      const approvalPayload = await approvalResponse.json();

      expect(approvalPayload.data.status).toBe("approved");

      const resumedEvents = await readSseEvents(reader, 3, "approval resume");
      expect(resumedEvents.map((event) => event.type)).toEqual([
        "approval.resolved",
        "chat.message",
        "run.status",
      ]);
      expect(resumedEvents.at(-1)).toMatchObject({
        type: "run.status",
        data: { status: "done" },
      });

      const sessionSummaryResponse = await fetchWithTimeout(
        `${baseUrl}/api/v1/copilot/sessions/${sessionId}`,
        {
          headers,
        },
        "fetch session summary"
      );
      const sessionSummary = await sessionSummaryResponse.json();

      expect(sessionSummary.data.latest_run_id).toBe(runId);
    } finally {
      await Promise.all(
        openResponses.splice(0).map(async (response) => {
          try {
            await response.body?.cancel();
          } catch {
            // Ignore response cleanup failures in test teardown.
          }
        })
      );

      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 15000);
});
