import { useState } from "react";
import {
  Layout,
  Activity,
  Database,
  Settings,
  ChevronRight,
  Search,
  Bell,
  User,
} from "lucide-react";
import { CopilotDrawer, type Message } from "./ui/CopilotDrawer";
import { TopologyCanvas, type TopologyNode } from "./ui/TopologyCanvas";
import { InProcessGateway } from "./gateway/in-process-gateway";
import type { DrawerEvent } from "./shared/contracts";

const initialNodes: TopologyNode[] = [
  { id: "gateway", name: "API Gateway", type: "gateway", status: "running", x: 50, y: 150 },
  {
    id: "frontend",
    name: "前端 UI (frontend-ui)",
    type: "service",
    status: "running",
    x: 250,
    y: 80,
  },
  { id: "backend", name: "核心业务 API", type: "service", status: "running", x: 250, y: 220 },
  { id: "db", name: "MySQL 数据库", type: "db", status: "running", x: 450, y: 220 },
];

export default function App() {
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "ai",
      type: "text",
      content:
        "您好！我是 Rainbond Copilot。我可以帮您排查故障、分析日志或管理应用架构。今天有什么可以帮您？",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [nodes] = useState(initialNodes);
  const [highlightedNode] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [gateway] = useState(() => new InProcessGateway());
  const [sessionId] = useState(() => `session-${Date.now()}`);

  const convertDrawerEventToMessage = (event: DrawerEvent): Message | null => {
    switch (event.type) {
      case "chat.message":
        return {
          role: event.role === "assistant" ? "ai" : "user",
          type: "text",
          content: event.content,
        };
      case "chat.trace":
        return {
          role: "system",
          type: "tool_call",
          content: `调用工具: ${event.toolName}(${JSON.stringify(event.input)})`,
        };
      case "approval.requested":
        return {
          role: "ai",
          type: "approval",
          actionId: event.approvalId,
          summary: event.description,
          api: `Skill: ${event.skillId}`,
          status: "pending",
        };
      case "goal.created":
        return {
          role: "system",
          type: "goal",
          content: event.description,
          status: "pending",
        };
      case "goal.completed":
        return {
          role: "system",
          type: "goal",
          content: "",
          status: "completed",
        };
      case "memory.stored":
        return {
          role: "system",
          type: "memory",
          content: event.content,
          importance: event.importance,
        };
      case "memory.recalled":
        return {
          role: "system",
          type: "memory_recall",
          content: event.query,
          relatedEntries: event.entries.map((entry) => entry.content),
        };
      case "reflection.insight":
        return {
          role: "system",
          type: "reflection",
          content: event.insight,
        };
      case "run.status":
        return null;
      default:
        return null;
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isTyping) return;

    const userMsg = inputValue;
    setInputValue("");
    setMessages((prev) => [...prev, { role: "user", type: "text", content: userMsg }]);
    setIsTyping(true);

    try {
      const events = await gateway.handleMessage(sessionId, userMsg);
      for (const event of events) {
        const message = convertDrawerEventToMessage(event);
        if (message) {
          setMessages((prev) => [...prev, message]);
        }
      }
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

  const handleApprove = async (actionId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.actionId === actionId ? { ...m, status: "approved" as const } : m))
    );
    setIsTyping(true);

    try {
      const events = await gateway.handleApproval(sessionId, actionId, true);
      for (const event of events) {
        const message = convertDrawerEventToMessage(event);
        if (message) {
          setMessages((prev) => [...prev, message]);
        }
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          type: "text",
          content: `处理审批时出现错误：${error.message}`,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleReject = async (actionId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.actionId === actionId ? { ...m, status: "rejected" as const } : m))
    );

    try {
      const events = await gateway.handleApproval(sessionId, actionId, false);
      for (const event of events) {
        const message = convertDrawerEventToMessage(event);
        if (message) {
          setMessages((prev) => [...prev, message]);
        }
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          type: "text",
          content: `处理审批时出现错误：${error.message}`,
        },
      ]);
    }
  };

  return (
    <div className="flex h-screen w-full bg-gray-50 font-sans text-sm overflow-hidden">
      {/* 左侧导航栏 */}
      <div className="w-16 bg-gray-900 flex flex-col items-center py-4 space-y-6 text-gray-400">
        <div className="w-8 h-8 bg-blue-600 rounded-md flex items-center justify-center text-white font-bold">
          R
        </div>
        <Layout className="w-5 h-5 text-white" />
        <Activity className="w-5 h-5" />
        <Database className="w-5 h-5" />
        <Settings className="w-5 h-5" />
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col relative">
        {/* 顶部 Header */}
        <div className="h-14 bg-white border-b flex items-center justify-between px-6">
          <div className="flex items-center space-x-2 text-gray-600">
            <span>电商测试团队</span> <ChevronRight className="w-4 h-4" />{" "}
            <span className="font-semibold text-gray-900">核心交易系统</span>
          </div>
          <div className="flex items-center space-x-4 text-gray-500">
            <Search className="w-4 h-4" />
            <Bell className="w-4 h-4" />
            <div className="w-7 h-7 bg-gray-200 rounded-full flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* 拓扑图 */}
        <TopologyCanvas nodes={nodes} highlightedNode={highlightedNode} />
      </div>

      {/* 右侧 Copilot 抽屉 */}
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
