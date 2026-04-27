import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  PanelRightOpen,
} from "lucide-react";
import { CopilotDrawer, type Message } from "./ui/CopilotDrawer";
import {
  consumeCopilotSseStream,
  createCopilotApiClient,
  type CopilotApiActor,
} from "./shared/copilot-api-client";
import type { PublicCopilotEvent } from "./shared/contracts";

type ViteEnvRecord = Record<string, string | undefined>;

interface ApprovalState {
  approvalId: string;
  sessionId: string;
  runId: string;
  lastSequence: number;
}

function getBrowserEnv(): ViteEnvRecord {
  const viteMeta = import.meta as ImportMeta & {
    env?: ViteEnvRecord;
  };

  return viteMeta.env || {};
}

function readCookie(name: string): string {
  if (typeof document === "undefined") {
    return "";
  }

  const cookiePrefix = `${name}=`;
  const matched = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(cookiePrefix));

  if (!matched) {
    return "";
  }

  return decodeURIComponent(matched.slice(cookiePrefix.length));
}

function buildTrustedActor(env: ViteEnvRecord): CopilotApiActor | undefined {
  const tenantId = env.VITE_COPILOT_TENANT_ID || "";
  const userId = env.VITE_COPILOT_USER_ID || "";
  const username = env.VITE_COPILOT_USERNAME || "";

  if (!tenantId || !userId || !username) {
    return undefined;
  }

  return {
    tenantId,
    userId,
    username,
    sourceSystem: env.VITE_COPILOT_SOURCE_SYSTEM || "agent-web",
    roles: (env.VITE_COPILOT_ROLES || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    tenantName: env.VITE_COPILOT_TENANT_NAME || tenantId,
    displayName: env.VITE_COPILOT_DISPLAY_NAME || undefined,
  };
}

function buildSessionContext(env: ViteEnvRecord): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  if (env.VITE_COPILOT_ENTERPRISE_ID) {
    context.enterprise_id = env.VITE_COPILOT_ENTERPRISE_ID;
  }
  if (env.VITE_COPILOT_TEAM_NAME) {
    context.team_name = env.VITE_COPILOT_TEAM_NAME;
  }
  if (env.VITE_COPILOT_REGION_NAME) {
    context.region_name = env.VITE_COPILOT_REGION_NAME;
  }
  if (env.VITE_COPILOT_APP_ID) {
    context.app_id = env.VITE_COPILOT_APP_ID;
  }
  if (env.VITE_COPILOT_APP_NAME) {
    context.app_name = env.VITE_COPILOT_APP_NAME;
  }
  if (env.VITE_COPILOT_COMPONENT_ID) {
    context.component_id = env.VITE_COPILOT_COMPONENT_ID;
  }
  if (env.VITE_COPILOT_COMPONENT_SOURCE) {
    context.component_source = env.VITE_COPILOT_COMPONENT_SOURCE;
  }
  if (env.VITE_COPILOT_PAGE) {
    context.page = env.VITE_COPILOT_PAGE;
  }

  if (Object.keys(context).length > 0) {
    context.resource = {
      type: context.component_id ? "component" : context.app_id ? "app" : "page",
      id: context.component_id || context.app_id || context.page || "",
      name: context.app_name || context.component_id || context.app_id || context.page || "",
    };
  }

  return context;
}

function createBrowserFetch(env: ViteEnvRecord): typeof fetch {
  return (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    const token = readCookie("token");
    const teamName = env.VITE_COPILOT_TEAM_NAME || "";
    const regionName = env.VITE_COPILOT_REGION_NAME || "";

    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `GRJWT ${token}`);
    }
    if (teamName && !headers.has("X-Team-Name")) {
      headers.set("X-Team-Name", teamName);
    }
    if (regionName && !headers.has("X-Region-Name")) {
      headers.set("X-Region-Name", regionName);
    }

    return fetch(input, {
      ...init,
      headers,
      credentials: init.credentials || "include",
    });
  };
}

function buildWorkflowEventMessage(event: PublicCopilotEvent): Message | null {
  const data = event.data || {};

  if (event.type === "workflow.selected") {
    return {
      role: "system",
      type: "action",
      content: `进入工作流：${String(data.workflow_name || data.workflow_id || "workflow")}`,
    };
  }

  if (event.type === "workflow.stage") {
    return {
      role: "system",
      type: "action",
      content: `当前阶段：${String(data.workflow_stage || "unknown")}，下一步：${String(data.next_action || "none")}`,
    };
  }

  if (event.type === "workflow.completed") {
    return {
      role: "system",
      type: "action",
      content: `工作流完成：${String(data.workflow_id || "workflow")}`,
    };
  }

  return null;
}

function findStreamMessageIndex(messages: Message[], messageId: string): number {
  return messages.findIndex(
    (message) => message.streamMessageId === messageId
  );
}

function applyPublicEvent(
  previousMessages: Message[],
  previousApprovals: Record<string, ApprovalState>,
  event: PublicCopilotEvent
): {
  messages: Message[];
  approvals: Record<string, ApprovalState>;
} {
  const nextMessages = previousMessages.slice();
  const nextApprovals = { ...previousApprovals };
  const data = event.data || {};

  switch (event.type) {
    case "chat.message.started": {
      const messageId = String(data.message_id || "");
      if (!messageId) {
        break;
      }
      if (findStreamMessageIndex(nextMessages, messageId) === -1) {
        nextMessages.push({
          role: data.role === "user" ? "user" : "ai",
          type: "text",
          content: "",
          streamMessageId: messageId,
          streaming: true,
        });
      }
      break;
    }
    case "chat.message.delta": {
      const messageId = String(data.message_id || "");
      if (!messageId) {
        break;
      }
      const index = findStreamMessageIndex(nextMessages, messageId);
      if (index === -1) {
        nextMessages.push({
          role: "ai",
          type: "text",
          content: String(data.delta || ""),
          streamMessageId: messageId,
          streaming: true,
        });
      } else {
        nextMessages[index] = {
          ...nextMessages[index],
          content: `${nextMessages[index].content || ""}${String(data.delta || "")}`,
          streaming: true,
        };
      }
      break;
    }
    case "chat.message.completed": {
      const messageId = String(data.message_id || "");
      if (!messageId) {
        break;
      }
      const index = findStreamMessageIndex(nextMessages, messageId);
      if (index === -1) {
        nextMessages.push({
          role: "ai",
          type: "text",
          content: String(data.content || ""),
          streamMessageId: messageId,
          streaming: false,
        });
      } else {
        nextMessages[index] = {
          ...nextMessages[index],
          content: String(data.content || nextMessages[index].content || ""),
          streaming: false,
        };
      }
      break;
    }
    case "chat.message":
      if (typeof data.message_id === "string" && data.message_id) {
        const index = findStreamMessageIndex(nextMessages, data.message_id);
        if (index > -1) {
          nextMessages[index] = {
            ...nextMessages[index],
            content: String(data.content || nextMessages[index].content || ""),
            streaming: false,
          };
          break;
        }
      }
      nextMessages.push({
        role: data.role === "user" ? "user" : "ai",
        type: "text",
        content: String(data.content || ""),
      });
      break;
    case "chat.trace":
      nextMessages.push({
        role: "system",
        type: "tool_call",
        content: `调用工具: ${String(data.tool_name || "tool")}(${JSON.stringify(
          data.input || {}
        )})`,
      });
      break;
    case "approval.requested": {
      const approvalId = String(data.approval_id || "");
      if (!approvalId) {
        break;
      }
      nextApprovals[approvalId] = {
        approvalId,
        sessionId: event.sessionId,
        runId: event.runId,
        lastSequence: event.sequence,
      };
      nextMessages.push({
        role: "ai",
        type: "approval",
        actionId: approvalId,
        summary: String(data.description || "待审批操作"),
        api: `Skill: ${String(data.skill_id || "")}`,
        status: "pending",
      });
      break;
    }
    case "approval.resolved": {
      const approvalId = String(data.approval_id || "");
      const status = data.status === "approved" ? "approved" : "rejected";
      nextMessages.forEach((message) => {
        if (message.actionId === approvalId && message.type === "approval") {
          message.status = status;
        }
      });
      delete nextApprovals[approvalId];
      break;
    }
    case "workflow.selected":
    case "workflow.stage":
    case "workflow.completed": {
      const workflowMessage = buildWorkflowEventMessage(event);
      if (workflowMessage) {
        nextMessages.push(workflowMessage);
      }

      if (event.type === "workflow.completed") {
        const structuredResult = data.structured_result as
          | Record<string, unknown>
          | undefined;
        const summary =
          structuredResult && typeof structuredResult.summary === "string"
            ? structuredResult.summary
            : "";
        if (summary) {
          nextMessages.push({
            role: "ai",
            type: "text",
            content: summary,
          });
        }
      }
      break;
    }
    default:
      break;
  }

  return {
    messages: nextMessages,
    approvals: nextApprovals,
  };
}

export default function App() {
  const env = useMemo(() => getBrowserEnv(), []);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "ai",
      type: "text",
      content:
        "您好！我是 Rainbond Copilot。我现在通过 server workflow 主链路处理 Rainbond 部署、修复、模板安装、版本中心和交付验证相关流程。",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [approvalStates, setApprovalStates] = useState<Record<string, ApprovalState>>(
    {}
  );
  const [sessionId, setSessionId] = useState<string>("");
  const messagesRef = useRef(messages);
  const approvalsRef = useRef(approvalStates);
  const client = useMemo(() => {
    return createCopilotApiClient({
      baseUrl: env.VITE_COPILOT_API_BASE_URL || "",
      actor: buildTrustedActor(env),
      fetchImpl: createBrowserFetch(env),
    });
  }, [env]);
  const sessionContext = useMemo(() => buildSessionContext(env), [env]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    approvalsRef.current = approvalStates;
  }, [approvalStates]);

  const ensureSession = async (): Promise<string> => {
    if (sessionId) {
      return sessionId;
    }

    const session = await client.createSession({
      context: sessionContext,
    });
    setSessionId(session.data.session_id);
    return session.data.session_id;
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isTyping) return;

    const userMsg = inputValue;
    setInputValue("");
    setMessages((prev) => [...prev, { role: "user", type: "text", content: userMsg }]);
    setIsTyping(true);

    try {
      const resolvedSessionId = await ensureSession();
      const run = await client.createMessageRun(resolvedSessionId, {
        message: userMsg,
        stream: true,
      });
      const response = await client.openEventStream(
        resolvedSessionId,
        run.data.run_id
      );
      await consumeCopilotSseStream(response, {
        onEvent(event) {
          const applied = applyPublicEvent(
            messagesRef.current,
            approvalsRef.current,
            event
          );
          approvalsRef.current = applied.approvals;
          messagesRef.current = applied.messages;
          setApprovalStates(applied.approvals);
          setMessages(applied.messages);
        },
      });
    } catch (error: any) {
      console.error("Error handling message:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          type: "text",
          content: `抱歉，处理您的请求时出现错误：${error.message || error.toString()}`,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const resolveApproval = async (
    actionId: string,
    decision: "approved" | "rejected"
  ) => {
    const approval = approvalStates[actionId];

    setMessages((prev) =>
      prev.map((message) =>
        message.actionId === actionId
          ? {
              ...message,
              status: decision,
            }
          : message
      )
    );

    if (!approval) {
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          type: "text",
          content: "审批上下文不存在，请刷新后重试。",
        },
      ]);
      return;
    }

    setIsTyping(true);

    try {
      await client.decideApproval(actionId, {
        decision,
        comment: decision === "approved" ? "确认执行" : "取消执行",
      });

      const response = await client.openEventStream(approval.sessionId, approval.runId, {
        afterSequence: approval.lastSequence,
      });
      await consumeCopilotSseStream(response, {
        onEvent(event) {
          const applied = applyPublicEvent(
            messagesRef.current,
            approvalsRef.current,
            event
          );
          approvalsRef.current = applied.approvals;
          messagesRef.current = applied.messages;
          setApprovalStates(applied.approvals);
          setMessages(applied.messages);
        },
      });
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          type: "text",
          content: `处理审批时出现错误：${error.message || error.toString()}`,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleApprove = async (actionId: string) => {
    await resolveApproval(actionId, "approved");
  };

  const handleReject = async (actionId: string) => {
    await resolveApproval(actionId, "rejected");
  };

  return (
    <div className="flex h-screen w-full bg-slate-100 font-sans text-sm overflow-hidden">
      <div className="flex-1 flex flex-col relative">
        <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6">
          <div className="flex items-center space-x-3 text-slate-700">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-slate-900">Rainbond Copilot</div>
              <div className="text-xs text-slate-500">
                Server workflow mode
              </div>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex items-center space-x-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            onClick={() => setIsChatOpen((value) => !value)}
          >
            <PanelRightOpen className="w-3.5 h-3.5" />
            <span>{isChatOpen ? "隐藏面板" : "打开面板"}</span>
          </button>
        </div>

        <div className="flex-1 p-8">
          <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-lg font-semibold text-slate-900">
              已移除 UI Demo 与本地 Mock 拓扑
            </div>
            <div className="mt-3 text-sm leading-7 text-slate-600">
              当前独立前端只作为 Rainbond Copilot 的 API 客户端壳子，所有会话、
              工作流选择、审批、MCP 调用和结构化结果都通过 server 侧真实主链路返回。
            </div>
            <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              建议直接在右侧面板发起问题，例如：
              <div className="mt-3 space-y-2 font-mono text-xs text-slate-700">
                <div>帮我检查当前应用状态</div>
                <div>你能做什么，有哪些流程？</div>
                <div>帮我把当前模板安装到这个应用</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <CopilotDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={messages}
        isTyping={isTyping}
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSend={handleSendMessage}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
