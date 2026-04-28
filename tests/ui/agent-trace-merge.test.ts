// @vitest-environment node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

function createMessage(role, kind, content, contextSnapshot = {}, extra = {}) {
  return {
    id: `${role}-${Date.now()}`,
    role,
    kind,
    content,
    contextSnapshot,
    ...extra,
  };
}

function resolveTraceHelperPath() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(currentDir, "../../../rainbond-ui/src/models/agentTraceHelpers.js"),
    resolve(currentDir, "../../../../../rainbond-ui/src/models/agentTraceHelpers.js"),
  ];

  const matched = candidates.find(candidate => existsSync(candidate));
  if (!matched) {
    throw new Error("Unable to locate rainbond-ui agentTraceHelpers.js");
  }

  return matched;
}

describe("agent trace merge", () => {
  it("merges tool input/output trace events for the same mcp call into one message", async () => {
    const { applyTraceEvent } = await import(
      pathToFileURL(resolveTraceHelperPath()).href
    );
    const messages = [];
    applyTraceEvent(
      messages,
      {
        type: "chat.trace",
        data: {
          trace_id: "trace_1",
          tool_call_id: "call_1",
          tool_name: "rainbond_get_current_user",
          input: {},
        },
      },
      {},
      2,
      createMessage,
    );
    applyTraceEvent(
      messages,
      {
        type: "chat.trace",
        data: {
          trace_id: "trace_1",
          tool_call_id: "call_1",
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
      {},
      3,
      createMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe("trace");
    expect(messages[0].trace).toMatchObject({
      traceId: "trace_1",
      toolCallId: "call_1",
      toolName: "rainbond_get_current_user",
      hasOutput: true,
    });
    expect(messages[0].trace.detail).toContain("输入：{}");
    expect(messages[0].trace.detail).toContain("\"user_id\": 1");
  });
});
