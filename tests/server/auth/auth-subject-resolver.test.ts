// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AuthSubjectResolver } from "../../../src/server/auth/auth-subject-resolver";

describe("AuthSubjectResolver", () => {
  it("resolves canonical user subject from a JWT-backed console identity call", async () => {
    const mockMcpClient = {
      initialize: vi.fn(async () => ({
        sessionId: "session_123",
        protocolVersion: "2025-03-26",
      })),
      callTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          user_id: "u_1",
          nick_name: "alice",
          real_name: "Alice",
          email: "alice@example.com",
          enterprise_id: "eid_1",
          is_enterprise_admin: false,
        },
        content: [],
      })),
    };

    const resolver = new AuthSubjectResolver(mockMcpClient as any);

    const subject = await resolver.resolveUserJwtSubject({
      authorization: "GRJWT token",
      cookie: "token=jwt-token; sessionid=abc",
      teamName: "team-a",
      regionName: "region-a",
      sourceSystem: "rainbond-ui",
    });

    expect(subject.userId).toBe("u_1");
    expect(subject.username).toBe("alice");
    expect(subject.tenantId).toBe("team-a");
    expect(subject.teamName).toBe("team-a");
    expect(mockMcpClient.initialize).toHaveBeenCalledWith({
      authorization: "GRJWT token",
      cookie: "token=jwt-token; sessionid=abc",
      teamName: "team-a",
      regionName: "region-a",
    });
    expect(mockMcpClient.callTool).toHaveBeenCalledWith(
      "rainbond_get_current_user",
      {}
    );
  });
});
