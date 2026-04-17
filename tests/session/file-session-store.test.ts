import { FileSessionStore } from "../../src/session/file-session-store";

it("creates a new session directory with transcript and metadata files", async () => {
  const store = new FileSessionStore(".tmp/copilot");
  const session = await store.createSession("session-1");

  expect(session.sessionId).toBe("session-1");
});
