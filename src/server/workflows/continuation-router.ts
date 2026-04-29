import type { ChatMessage, ToolDefinition } from "../../llm/types.js";
import type { PendingWorkflowContinuation } from "../stores/session-store.js";

export interface ContinuationRouterClient {
  chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<{
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
    finish_reason?: string;
  }>;
}

export interface ContinuationRouterDecision {
  action:
    | "reuse_continuation_context"
    | "apply_suggested_action"
    | "start_new_request"
    | "ask_clarification";
  option_key?: string;
  rationale?: string;
}

export interface ContinuationRouter {
  route(input: {
    message: string;
    continuation: PendingWorkflowContinuation;
    sessionContext?: Record<string, unknown>;
  }): Promise<ContinuationRouterDecision | null>;
}

const TOOL_NAME = "select_continuation_action";

const ROUTER_PROMPT = [
  "你是 Rainbond Copilot 的 continuation 路由器。",
  "",
  "任务：判断当前用户消息，是不是应该沿用上一轮 workflow 的上下文继续处理。",
  "",
  "你只能选择以下动作之一：",
  "1. reuse_continuation_context：沿用上一轮 workflow 上下文，把当前消息视作上一轮问题的继续处理。",
  "2. apply_suggested_action：用户想采纳上一轮建议动作；如存在 optionKey，请填入。",
  "3. start_new_request：这是新的独立请求，不应沿用上一轮 workflow。",
  "4. ask_clarification：当前消息太模糊，且仅凭上一轮上下文无法安全判断。",
  "",
  "规则：",
  "- 不要返回纯文本，必须且只调用一次工具。",
  "- 如果当前消息明显引用上一轮问题、建议动作、处理方向或修复手段，优先考虑 reuse_continuation_context 或 apply_suggested_action。",
  "- 如果 suggestedActions 为空，不要凭空编造 optionKey。",
  "- 如果用户消息看起来是在对当前组件、当前应用、上一轮诊断结论做后续处理，优先 reuse_continuation_context，而不是 start_new_request。",
].join("\n");

export function createContinuationRouter(opts: {
  llmClient: ContinuationRouterClient;
}): ContinuationRouter {
  const tool: ToolDefinition = {
    type: "function",
    function: {
      name: TOOL_NAME,
      description:
        "Choose how the current user message should relate to the previous workflow continuation.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "reuse_continuation_context",
              "apply_suggested_action",
              "start_new_request",
              "ask_clarification",
            ],
          },
          option_key: {
            type: "string",
          },
          rationale: {
            type: "string",
          },
        },
        required: ["action"],
      },
    },
  };

  return {
    async route(input) {
      const response = await opts.llmClient.chat(
        [
          { role: "system", content: ROUTER_PROMPT },
          {
            role: "user",
            content: buildContinuationRouterMessage(
              input.message,
              input.continuation,
              input.sessionContext
            ),
          },
        ],
        [tool]
      );

      const toolCall = response.tool_calls?.[0];
      if (!toolCall || toolCall.function.name !== TOOL_NAME) {
        return null;
      }

      const parsed = parseArguments(toolCall.function.arguments);
      const action =
        typeof parsed.action === "string" ? parsed.action : "";
      if (
        action !== "reuse_continuation_context" &&
        action !== "apply_suggested_action" &&
        action !== "start_new_request" &&
        action !== "ask_clarification"
      ) {
        return null;
      }

      return {
        action,
        option_key:
          typeof parsed.option_key === "string" && parsed.option_key
            ? parsed.option_key
            : undefined,
        rationale:
          typeof parsed.rationale === "string" && parsed.rationale
            ? parsed.rationale
            : undefined,
      };
    },
  };
}

function buildContinuationRouterMessage(
  message: string,
  continuation: PendingWorkflowContinuation,
  sessionContext?: Record<string, unknown>
): string {
  const lines = [
    `当前用户消息：${message || "(空)"}`,
    "",
    "上一轮 workflow 上下文：",
    `- workflow_id: ${continuation.workflowId || ""}`,
    continuation.selectedWorkflow
      ? `- selected_workflow: ${continuation.selectedWorkflow}`
      : "",
    continuation.nextAction ? `- next_action: ${continuation.nextAction}` : "",
    continuation.summary ? `- summary: ${continuation.summary}` : "",
    continuation.subflowData
      ? `- subflow_data: ${JSON.stringify(continuation.subflowData)}`
      : "",
    continuation.toolCalls && continuation.toolCalls.length > 0
      ? `- tool_calls: ${JSON.stringify(continuation.toolCalls)}`
      : "",
    continuation.suggestedActions && continuation.suggestedActions.length > 0
      ? `- suggested_actions: ${JSON.stringify(
          continuation.suggestedActions.map((item) => ({
            optionKey: item.optionKey,
            label: item.label,
            description: item.description,
            recommended: item.recommended,
          }))
        )}`
      : "- suggested_actions: []",
    sessionContext && Object.keys(sessionContext).length > 0
      ? `- session_context: ${JSON.stringify(pickRelevantContext(sessionContext))}`
      : "",
  ].filter(Boolean);

  return lines.join("\n");
}

function pickRelevantContext(
  sessionContext: Record<string, unknown>
): Record<string, unknown> {
  const keys = [
    "teamName",
    "team_name",
    "regionName",
    "region_name",
    "appId",
    "app_id",
    "componentId",
    "component_id",
    "componentSource",
    "component_source",
  ];
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const value = sessionContext[key];
    if (value !== undefined && value !== null && value !== "") {
      output[key] = value;
    }
  }
  return output;
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
