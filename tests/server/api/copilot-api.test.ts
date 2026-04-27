// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createCopilotController } from "../../../src/server/controllers/copilot-controller";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function wait(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("copilot api controller", () => {
  const noopLlmClient = {
    chat: vi.fn(async () => ({
      content: "checked",
      finish_reason: "stop",
    })),
  };

  it("creates a session for the current tenant and user", async () => {
    const controller = createCopilotController({ llmClient: null });
    const response = await controller.createSession({
      actor: {
        tenantId: "t_123",
        userId: "u_456",
        username: "alice",
        sourceSystem: "ops-console",
        roles: ["app_admin"],
      },
      body: {
        context: {
          app_id: "app-001",
        },
      },
    });

    expect(response.data.session_id).toMatch(/^cs_/);
    expect(response.data.tenant_id).toBe("t_123");
    expect(response.data.status).toBe("active");
  });

  it("creates a run and returns a stream URL", async () => {
    const controller = createCopilotController({ llmClient: noopLlmClient as any });
    const session = await controller.createSession({
      actor: {
        tenantId: "t_123",
        userId: "u_456",
        username: "alice",
        sourceSystem: "ops-console",
        roles: ["app_admin"],
      },
      body: {},
    });

    const response = await controller.createMessageRun({
      actor: {
        tenantId: "t_123",
        userId: "u_456",
        username: "alice",
        sourceSystem: "ops-console",
        roles: ["app_admin"],
      },
      params: { sessionId: session.data.session_id },
      body: { message: "check frontend-ui", stream: true },
    });

    expect(response.data.run_id).toMatch(/^run_/);
    expect(response.data.session_id).toBe(session.data.session_id);
    expect(response.data.stream_url).toContain(
      `/api/v1/copilot/sessions/${session.data.session_id}/runs/`
    );
  });

  it("returns the run handle before llm execution finishes", async () => {
    const deferred = createDeferred<{
      content: string;
      finish_reason: string;
    }>();
    const llmClient = {
      chat: vi.fn(async () => deferred.promise),
    };
    const controller = createCopilotController({ llmClient: llmClient as any });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor,
      body: {},
    });

    const responsePromise = controller.createMessageRun({
      actor,
      params: { sessionId: session.data.session_id },
      body: { message: "你好", stream: true },
    });

    const resolvedWithinDeadline = await Promise.race([
      responsePromise.then(() => true),
      wait(25).then(() => false),
    ]);

    expect(resolvedWithinDeadline).toBe(true);

    deferred.resolve({
      content: "你好！",
      finish_reason: "stop",
    });
    await responsePromise;
  });

  it("rejects reading a session from another user in the same tenant", async () => {
    const controller = createCopilotController({ llmClient: null });
    const owner = {
      tenantId: "t_123",
      userId: "u_owner",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };
    const otherUser = {
      tenantId: "t_123",
      userId: "u_other",
      username: "bob",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor: owner,
      body: {},
    });

    await expect(
      controller.getSession({
        actor: otherUser,
        params: { sessionId: session.data.session_id },
      })
    ).rejects.toThrow("Session not found");
  });

  it("rejects creating a run against a session owned by another user in the same tenant", async () => {
    const controller = createCopilotController({ llmClient: null });
    const owner = {
      tenantId: "t_123",
      userId: "u_owner",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };
    const otherUser = {
      tenantId: "t_123",
      userId: "u_other",
      username: "bob",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };

    const session = await controller.createSession({
      actor: owner,
      body: {},
    });

    await expect(
      controller.createMessageRun({
        actor: otherUser,
        params: { sessionId: session.data.session_id },
        body: { message: "check frontend-ui", stream: true },
      })
    ).rejects.toThrow("Session not found");
  });

  it("generates unique session and run IDs even when Date.now() is constant", async () => {
    const controller = createCopilotController({ llmClient: noopLlmClient as any });
    const actor = {
      tenantId: "t_123",
      userId: "u_456",
      username: "alice",
      sourceSystem: "ops-console",
      roles: ["app_admin"],
    };
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234567890);

    try {
      const sessionA = await controller.createSession({ actor, body: {} });
      const sessionB = await controller.createSession({ actor, body: {} });

      expect(sessionA.data.session_id).not.toBe(sessionB.data.session_id);

      const runA = await controller.createMessageRun({
        actor,
        params: { sessionId: sessionA.data.session_id },
        body: { message: "check frontend-ui", stream: true },
      });
      const runB = await controller.createMessageRun({
        actor,
        params: { sessionId: sessionA.data.session_id },
        body: { message: "check frontend-ui again", stream: true },
      });

      expect(runA.data.run_id).not.toBe(runB.data.run_id);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
