import { WorkspaceManager } from "../../src/workspace/workspace-manager";

it("initializes a workspace with AGENTS.md, RAINBOND.md, USER.md", async () => {
  const manager = new WorkspaceManager(".tmp/workspace");
  const ws = await manager.init("session-1");

  expect(ws.sessionId).toBe("session-1");
  expect(ws.files).toContain("AGENTS.md");
});
