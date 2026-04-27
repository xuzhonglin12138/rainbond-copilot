import { useRef, useEffect } from "react";
import {
  MessageSquare,
  Terminal,
  X,
  Wrench,
  Play,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Target,
  Brain,
  Lightbulb,
} from "lucide-react";

export interface Message {
  role: "user" | "ai" | "system";
  type:
    | "text"
    | "tool_call"
    | "action"
    | "approval"
    | "goal"
    | "memory"
    | "memory_recall"
    | "reflection";
  content?: string;
  actionId?: string;
  summary?: string;
  api?: string;
  status?: "pending" | "approved" | "rejected" | "completed";
  importance?: number;
  relatedEntries?: string[];
  streamMessageId?: string;
  streaming?: boolean;
}

interface CopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: Message[];
  isTyping: boolean;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onApprove: (actionId: string) => void;
  onReject: (actionId: string) => void;
}

export function CopilotDrawer({
  isOpen,
  onClose,
  messages,
  isTyping,
  inputValue,
  onInputChange,
  onSend,
  onApprove,
  onReject,
}: CopilotDrawerProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  return (
    <div
      className={`w-96 bg-white border-l border-gray-200 flex flex-col transition-all duration-300 ${
        isOpen ? "translate-x-0" : "translate-x-full absolute right-0 h-full"
      }`}
    >
      {/* Header */}
      <div className="h-14 bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-between px-4 text-white shadow-md z-10">
        <div className="flex items-center space-x-2">
          <MessageSquare className="w-5 h-5" />
          <span className="font-semibold">Rainbond Copilot</span>
          <span className="px-1.5 py-0.5 bg-blue-500/50 rounded text-[10px] border border-blue-400">
            Beta
          </span>
        </div>
        <button onClick={onClose} className="hover:bg-white/20 p-1 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            {/* 文本消息 */}
            {msg.type === "text" && (
              <div
                className={`max-w-[85%] p-3 rounded-lg shadow-sm text-[13px] leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-none"
                    : "bg-white text-gray-800 border border-gray-100 rounded-tl-none"
                }`}
              >
                {msg.content?.split("\n").map((line, i) => (
                  <span key={i}>
                    {line.includes("**") ? (
                      <span
                        dangerouslySetInnerHTML={{
                          __html: line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
                        }}
                      />
                    ) : line.includes("`") ? (
                      <span
                        dangerouslySetInnerHTML={{
                          __html: line.replace(
                            /`(.*?)`/g,
                            '<code class="bg-gray-100 text-red-500 px-1 py-0.5 rounded text-xs">$1</code>'
                          ),
                        }}
                      />
                    ) : (
                      line
                    )}
                    <br />
                  </span>
                ))}
              </div>
            )}

            {/* 工具调用 */}
            {msg.type === "tool_call" && (
              <div className="flex items-center space-x-2 text-gray-400 text-[11px] my-1 ml-2">
                <Wrench className="w-3 h-3" />
                <span className="font-mono">{msg.content}</span>
              </div>
            )}

            {/* UI 指令 */}
            {msg.type === "action" && (
              <div className="flex items-center space-x-2 text-blue-400 text-[11px] my-1 ml-2">
                <Play className="w-3 h-3" />
                <span className="font-mono">{msg.content}</span>
              </div>
            )}

            {/* 目标追踪 */}
            {msg.type === "goal" && (
              <div className="flex items-center space-x-1.5 text-[11px] my-1 mx-auto
                              bg-indigo-50 border border-indigo-200 text-indigo-700
                              rounded-full px-3 py-1 max-w-[90%]">
                <Target className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {msg.status === "completed" ? "✓ 目标完成" : `目标：${msg.content}`}
                </span>
              </div>
            )}

            {/* 记忆存储 */}
            {msg.type === "memory" && (
              <div className="flex items-center space-x-1.5 text-[11px] my-0.5 mx-auto
                              bg-slate-50 border border-slate-200 text-slate-500
                              rounded-full px-3 py-0.5 max-w-[90%]">
                <Brain className="w-3 h-3 shrink-0" />
                <span className="truncate">已记忆：{msg.content}</span>
              </div>
            )}

            {/* 主动记忆召回 */}
            {msg.type === "memory_recall" && (
              <div className="w-full max-w-[90%] mx-auto bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <div className="flex items-center space-x-1.5 text-[11px] text-amber-800 font-medium">
                  <Brain className="w-3 h-3 shrink-0" />
                  <span>主动记忆召回</span>
                </div>
                <div className="mt-1 text-[11px] text-amber-700 leading-relaxed">
                  {msg.relatedEntries?.map((entry, idx) => (
                    <div key={idx}>{entry}</div>
                  ))}
                </div>
              </div>
            )}

            {/* 反思洞察 */}
            {msg.type === "reflection" && (
              <div className="flex items-center space-x-1.5 text-[11px] my-1 mx-auto
                              bg-purple-50 border border-purple-200 text-purple-700
                              rounded-full px-3 py-1 max-w-[90%]">
                <Lightbulb className="w-3 h-3 shrink-0" />
                <span className="truncate">规律：{msg.content}</span>
              </div>
            )}

            {/* 审批卡片 */}
            {msg.type === "approval" && (
              <div className="w-full mt-2 bg-white border border-orange-200 rounded-lg shadow-sm overflow-hidden">
                <div className="bg-orange-50 px-3 py-2 border-b border-orange-100 flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-orange-500" />
                  <span className="text-sm font-semibold text-orange-800">需要您的授权执行</span>
                </div>
                <div className="p-3">
                  <p className="text-xs text-gray-600 mb-2">
                    <strong>操作内容：</strong>
                    {msg.summary}
                  </p>
                  <p className="text-[10px] text-gray-400 font-mono bg-gray-50 p-1 rounded mb-3">
                    {msg.api}
                  </p>

                  {msg.status === "approved" ? (
                    <div className="flex items-center justify-center space-x-2 text-green-600 bg-green-50 py-1.5 rounded text-xs font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>已授权执行</span>
                    </div>
                  ) : msg.status === "rejected" ? (
                    <div className="flex items-center justify-center space-x-2 text-gray-600 bg-gray-50 py-1.5 rounded text-xs font-medium">
                      <X className="w-4 h-4" />
                      <span>已取消</span>
                    </div>
                  ) : (
                    <div className="flex space-x-2">
                      <button
                        onClick={() => msg.actionId && onApprove(msg.actionId)}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1.5 rounded transition-colors"
                      >
                        授权并执行
                      </button>
                      <button
                        onClick={() => msg.actionId && onReject(msg.actionId)}
                        className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs py-1.5 rounded transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Loading */}
        {isTyping && (
          <div className="flex items-center space-x-2 text-gray-400 text-xs ml-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>AI 正在思考...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <div className="p-4 bg-white border-t border-gray-200">
        <div className="flex items-end space-x-2 bg-gray-50 border border-gray-300 rounded-lg p-1 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
          <textarea
            className="flex-1 bg-transparent border-none focus:ring-0 resize-none text-sm p-2 max-h-32 min-h-[40px] outline-none"
            placeholder="输入请求，例如：帮我检查当前应用状态"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <button
            onClick={onSend}
            disabled={!inputValue.trim() || isTyping}
            className="p-2 bg-blue-600 text-white rounded-md mb-1 mr-1 disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
          >
            <Terminal className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-2 flex space-x-2 overflow-x-auto pb-1">
          <span
            className="shrink-0 text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded-full cursor-pointer hover:bg-gray-200"
            onClick={() => onInputChange("帮我检查当前应用状态")}
          >
            检查当前应用
          </span>
          <span
            className="shrink-0 text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded-full cursor-pointer hover:bg-gray-200"
            onClick={() => onInputChange("你能做什么，有哪些流程？")}
          >
            查看可执行流程
          </span>
        </div>
      </div>
    </div>
  );
}
