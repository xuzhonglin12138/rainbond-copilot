// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CopilotSessionService } from "../../../src/server/services/copilot-session-service";
import { createInMemorySessionStore } from "../../../src/server/stores/session-store";

describe("CopilotSessionService", () => {
  it("stores auth binding and UI context signature when creating a session", async () => {
    const sessionStore = createInMemorySessionStore();
    const service = new CopilotSessionService(sessionStore);

    const session = await service.createSession({
      actor: {
        tenantId: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
        authMode: "user_jwt",
        tenantName: "team-a",
      },
      context: {
        teamName: "team-a",
        regionName: "region-a",
        appId: "app-a",
        componentId: "component-a",
      },
    });

    expect(session.userId).toBe("u_1");
    expect(session.username).toBe("alice");
    expect(session.authMode).toBe("user_jwt");
    expect(session.teamName).toBe("team-a");
    expect(session.contextSignature).toBe(
      "team-a|region-a|app-a|component-a|candidate"
    );
    expect(session.context).toMatchObject({
      teamName: "team-a",
      regionName: "region-a",
      appId: "app-a",
      componentId: "component-a",
    });
  });

  it("updates session context from snake_case payloads and refreshes the scope signature", async () => {
    const sessionStore = createInMemorySessionStore();
    const service = new CopilotSessionService(sessionStore);

    const session = await service.createSession({
      actor: {
        tenantId: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
        authMode: "user_jwt",
        tenantName: "team-a",
      },
      context: {
        team_name: "team-a",
        region_name: "region-a",
      },
    });

    const updated = await service.updateSessionContext(
      session.sessionId,
      {
        tenantId: "team-a",
        userId: "u_1",
        tenantName: "team-a",
      },
      {
        enterprise_id: "eid-1",
        team_name: "team-a",
        region_name: "region-a",
        app_id: "134",
        component_id: "gr71871f",
      }
    );

    expect(updated.contextSignature).toBe("team-a|region-a|134|gr71871f|candidate");
    expect(updated.context).toMatchObject({
      enterprise_id: "eid-1",
      app_id: "134",
      component_id: "gr71871f",
    });
  });

  it("clears persisted chat history when the session context signature changes", async () => {
    const sessionStore = createInMemorySessionStore();
    const service = new CopilotSessionService(sessionStore);

    const session = await service.createSession({
      actor: {
        tenantId: "team-a",
        userId: "u_1",
        username: "alice",
        sourceSystem: "rainbond-ui",
        roles: [],
        authMode: "user_jwt",
        tenantName: "team-a",
      },
      context: {
        team_name: "team-a",
        region_name: "region-a",
        app_id: "134",
      },
    });

    await sessionStore.update({
      ...session,
      chatHistory: [
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好，我记住了。" },
      ],
    });

    const updated = await service.updateSessionContext(
      session.sessionId,
      {
        tenantId: "team-a",
        userId: "u_1",
        tenantName: "team-a",
      },
      {
        enterprise_id: "eid-1",
        team_name: "team-a",
        region_name: "region-a",
        app_id: "135",
      }
    );

    expect(updated.chatHistory).toBeUndefined();
  });
});
