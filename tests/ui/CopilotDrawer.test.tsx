import { render, screen } from "@testing-library/react";
import { CopilotDrawer } from "../../src/ui/CopilotDrawer";

it("renders a pending approval card when the stream emits chat.approval", () => {
  const mockMessages = [
    {
      role: "ai" as const,
      type: "approval" as const,
      actionId: "test-123",
      summary: "测试操作",
      api: "PUT /api/test",
      status: "pending" as const,
    },
  ];

  render(
    <CopilotDrawer
      isOpen={true}
      onClose={() => {}}
      messages={mockMessages}
      isTyping={false}
      inputValue=""
      onInputChange={() => {}}
      onSend={() => {}}
      onApprove={() => {}}
      onReject={() => {}}
    />
  );

  expect(screen.queryByText("需要您的授权执行")).not.toBeNull();
});

it("renders recalled memory entries", () => {
  const mockMessages = [
    {
      role: "system" as const,
      type: "memory_recall" as const,
      relatedEntries: ["之前排查过 frontend-ui，发现 OOM 日志"],
    },
  ];

  render(
    <CopilotDrawer
      isOpen={true}
      onClose={() => {}}
      messages={mockMessages}
      isTyping={false}
      inputValue=""
      onInputChange={() => {}}
      onSend={() => {}}
      onApprove={() => {}}
      onReject={() => {}}
    />
  );

  expect(screen.queryByText("主动记忆召回")).not.toBeNull();
  expect(screen.queryByText("之前排查过 frontend-ui，发现 OOM 日志")).not.toBeNull();
});
