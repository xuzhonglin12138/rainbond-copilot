// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyAgentEvents } from "../../../rainbond-ui/src/models/agent.js";

describe("agent trace merge", () => {
  it("merges tool input/output trace events for the same mcp call into one message", () => {
    const merged = applyAgentEvents({
      messages: [],
      events: [
        {
          type: "chat.trace",
          sequence: 2,
          data: {
            tool_name: "rainbond_get_current_user",
            input: {},
          },
        },
        {
          type: "chat.trace",
          sequence: 3,
          data: {
            tool_name: "rainbond_get_current_user",
            input: {},
            output: {
              isError: false,
              structuredContent: {
                user_id: 1,
                nick_name: "admin",
              },
            },
          },
        },
      ],
      contextSnapshot: {},
      currentPendingApproval: null,
    });

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0].kind).toBe("trace");
    expect(merged.messages[0].trace).toMatchObject({
      toolName: "rainbond_get_current_user",
      hasOutput: true,
    });
    expect(merged.messages[0].trace.detail).toContain("输入：{}");
    expect(merged.messages[0].trace.detail).toContain("\"user_id\": 1");
  });
});
