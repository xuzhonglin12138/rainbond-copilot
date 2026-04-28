import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { CopilotDrawer } from "../../src/ui/CopilotDrawer";

describe("CopilotDrawer", () => {
  it("renders a pending approval card when the stream emits chat.approval", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <CopilotDrawer
          isOpen={true}
          onClose={() => {}}
          messages={[
            {
              role: "ai",
              type: "approval",
              actionId: "test-123",
              summary: "测试操作",
              api: "PUT /api/test",
              status: "pending",
            },
          ]}
          isTyping={false}
          inputValue=""
          onInputChange={() => {}}
          onSend={() => {}}
          onApprove={() => {}}
          onReject={() => {}}
        />
      );
    });

    expect(container.textContent).toContain("需要您的授权执行");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders recalled memory entries", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <CopilotDrawer
          isOpen={true}
          onClose={() => {}}
          messages={[
            {
              role: "system",
              type: "memory_recall",
              relatedEntries: ["之前排查过某个组件，发现 OOM 日志"],
            },
          ]}
          isTyping={false}
          inputValue=""
          onInputChange={() => {}}
          onSend={() => {}}
          onApprove={() => {}}
          onReject={() => {}}
        />
      );
    });

    expect(container.textContent).toContain("主动记忆召回");
    expect(container.textContent).toContain(
      "之前排查过某个组件，发现 OOM 日志"
    );

    await act(async () => {
      root.unmount();
    });
  });
});
