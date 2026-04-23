import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import App from "../../src/App";

const mockedApi = vi.hoisted(() => ({
  createSession: vi.fn(async () => ({
    data: {
      session_id: "cs_123",
      tenant_id: "local-default",
      status: "active",
    },
  })),
  createMessageRun: vi.fn(async () => ({
    data: {
      run_id: "run_123",
      session_id: "cs_123",
      stream_url: "/api/v1/copilot/sessions/cs_123/runs/run_123/events",
    },
  })),
  openEventStream: vi.fn(async () => new Response("ok")),
  decideApproval: vi.fn(async () => ({
    data: {
      approval_id: "ap_123",
      status: "approved",
    },
  })),
  readCopilotSseStream: vi.fn(async () => [
    {
      type: "workflow.selected",
      tenantId: "local-default",
      sessionId: "cs_123",
      runId: "run_123",
      sequence: 2,
      timestamp: "2026-04-22T00:00:00Z",
      data: {
        workflow_id: "rainbond-app-assistant",
        workflow_name: "Rainbond App Assistant",
      },
    },
    {
      type: "chat.message",
      tenantId: "local-default",
      sessionId: "cs_123",
      runId: "run_123",
      sequence: 3,
      timestamp: "2026-04-22T00:00:01Z",
      data: {
        role: "assistant",
        content: "当前独立前端已经切到 Rainbond server workflow 主链路。",
      },
    },
    {
      type: "run.status",
      tenantId: "local-default",
      sessionId: "cs_123",
      runId: "run_123",
      sequence: 4,
      timestamp: "2026-04-22T00:00:02Z",
      data: {
        status: "done",
      },
    },
  ]),
}));

vi.mock("../../src/shared/copilot-api-client", () => ({
  createCopilotApiClient: vi.fn(() => ({
    createSession: mockedApi.createSession,
    createMessageRun: mockedApi.createMessageRun,
    openEventStream: mockedApi.openEventStream,
    decideApproval: mockedApi.decideApproval,
  })),
  readCopilotSseStream: mockedApi.readCopilotSseStream,
}));

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("App", () => {
  it("renders the Rainbond Copilot drawer shell", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("Rainbond Copilot");

    await act(async () => {
      root.unmount();
    });
  });

  it("sends messages through the copilot api client instead of the legacy in-process gateway", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      const quickPrompt = Array.from(container.querySelectorAll("span")).find(
        (node) => node.textContent === "检查当前应用"
      );
      if (!(quickPrompt instanceof HTMLSpanElement)) {
        throw new Error("Copilot quick prompt not found");
      }
      quickPrompt.click();
    });

    const buttons = container.querySelectorAll("button");
    const sendButton = buttons[buttons.length - 1];
    if (!(sendButton instanceof HTMLButtonElement)) {
      throw new Error("Copilot send button not found");
    }

    await act(async () => {
      sendButton.click();
    });

    await flushPromises();

    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);
    expect(mockedApi.createMessageRun).toHaveBeenCalledWith("cs_123", {
      message: "帮我检查当前应用状态",
      stream: true,
    });
    expect(mockedApi.openEventStream).toHaveBeenCalledWith("cs_123", "run_123");
    expect(container.textContent).toContain(
      "当前独立前端已经切到 Rainbond server workflow 主链路。"
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
