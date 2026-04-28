// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCopilotApiServer } from "../../src/server";

async function withServer(
  server: ReturnType<typeof createCopilotApiServer>,
  run: (baseUrl: string) => Promise<void>
) {
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
  } catch (error: any) {
    if (error && error.code === "EPERM") {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return;
    }
    throw error;
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("copilot api auth transport", () => {
  it("rejects browser JWT requests that send authorization without cookie", async () => {
    const server = createCopilotApiServer({
      env: {
        COPILOT_STORE_MODE: "memory",
      },
    });

    await withServer(server, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/copilot/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "GRJWT token",
          "x-team-name": "team-a",
          "x-region-name": "region-a",
        },
        body: JSON.stringify({}),
      });

      const payload = await response.json();

      expect(response.status).toBe(401);
      expect(payload).toMatchObject({
        error: {
          code: "unauthorized",
          message:
            "Authorization and Cookie headers are required together for Rainbond MCP user requests",
        },
      });
    });
  });
});
