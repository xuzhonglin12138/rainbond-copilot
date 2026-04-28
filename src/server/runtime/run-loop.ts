import type {
  ChatCompletionResponse,
  ChatMessage,
  ToolDefinition,
} from "../../llm/types.js";
import type {
  PendingRunApproval,
  RunExecutionState,
} from "./run-execution-state.js";

export interface RunLoopToolOutput {
  type: "tool_output";
  content: string;
  toolName?: string;
}

export interface RunLoopInterruption {
  type: "interruption";
  pendingApproval: PendingRunApproval;
}

export interface RunLoopContinue {
  type: "continue";
}

export type RunLoopToolCallResult =
  | RunLoopToolOutput
  | RunLoopInterruption
  | RunLoopContinue;

export interface AdvanceRunLoopParams {
  state: RunExecutionState;
  tools?: ToolDefinition[];
  chat?: (
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ) => Promise<ChatCompletionResponse>;
  llmResponses?: ChatCompletionResponse[];
  maxIterations?: number;
  maxIterationsFinalOutput?: string;
  handleToolCall?: (params: {
    state: RunExecutionState;
    iteration: number;
    response: ChatCompletionResponse;
    toolCalls: NonNullable<ChatCompletionResponse["tool_calls"]>;
    toolIndex: number;
    toolCall: NonNullable<ChatCompletionResponse["tool_calls"]>[number];
  }) => Promise<RunLoopToolCallResult>;
}

function cloneToolCalls(
  toolCalls?: NonNullable<ChatCompletionResponse["tool_calls"]>
): NonNullable<ChatCompletionResponse["tool_calls"]> | undefined {
  return toolCalls?.map((toolCall) => ({
    ...toolCall,
    function: {
      ...toolCall.function,
    },
  }));
}

function createQueuedChat(
  responses: ChatCompletionResponse[]
): (
  messages: ChatMessage[],
  tools?: ToolDefinition[]
) => Promise<ChatCompletionResponse> {
  let index = 0;

  return async () => {
    const response = responses[index];

    if (!response) {
      throw new Error("No queued LLM response available for run loop");
    }

    index += 1;
    return {
      ...response,
      tool_calls: cloneToolCalls(response.tool_calls),
    };
  };
}

function appendAssistantMessage(
  state: RunExecutionState,
  response: ChatCompletionResponse
): void {
  state.messages.push({
    role: "assistant",
    content: response.content ?? null,
    reasoning_content: response.reasoning_content ?? null,
    ...(response.tool_calls ? { tool_calls: response.tool_calls } : {}),
  });
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    ...(message.tool_calls
      ? {
          tool_calls: message.tool_calls.map((toolCall) => ({
            ...toolCall,
            function: {
              ...toolCall.function,
            },
          })),
        }
      : {}),
  }));
}

function markFailed(
  state: RunExecutionState,
  error: unknown
): RunExecutionState {
  state.nextStep = { type: "failed" };
  state.status = "failed";
  state.finalOutput =
    error instanceof Error ? error.message : "Run loop failed unexpectedly";
  return state;
}

async function defaultHandleToolCall(params: {
  toolCall: NonNullable<ChatCompletionResponse["tool_calls"]>[number];
}): Promise<RunLoopToolCallResult> {
  return {
    type: "interruption",
    pendingApproval: {
      toolName: params.toolCall.function.name,
      toolCallId: params.toolCall.id,
      risk: "high",
      arguments: JSON.parse(params.toolCall.function.arguments || "{}"),
    },
  };
}

export async function advanceRunLoop(
  params: AdvanceRunLoopParams
): Promise<RunExecutionState> {
  const chat = params.chat ?? createQueuedChat(params.llmResponses ?? []);
  const handleToolCall = params.handleToolCall ?? defaultHandleToolCall;
  const maxIterations = params.maxIterations ?? 8;
  const state = params.state;

  state.nextStep = { type: "run_again" };
  state.pendingApprovals = [];
  state.finalOutput = null;
  state.status = "running";

  while (state.iteration < maxIterations) {
    state.iteration += 1;

    let response: ChatCompletionResponse;
    try {
      response = await chat(cloneMessages(state.messages), params.tools);
    } catch (error) {
      return markFailed(state, error);
    }

    const toolCalls = response.tool_calls ?? [];
    if (toolCalls.length === 0) {
      appendAssistantMessage(state, response);
      state.nextStep = { type: "final_output" };
      state.finalOutput =
        typeof response.content === "string" ? response.content : null;
      state.status = "completed";
      return state;
    }

    appendAssistantMessage(state, response);

    for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex += 1) {
      const toolCall = toolCalls[toolIndex];

      let result: RunLoopToolCallResult;
      try {
        result = await handleToolCall({
          state,
          iteration: state.iteration,
          response,
          toolCalls,
          toolIndex,
          toolCall,
        });
      } catch (error) {
        return markFailed(state, error);
      }

      if (result.type === "continue") {
        continue;
      }

      if (result.type === "interruption") {
        state.pendingApprovals = [result.pendingApproval];
        state.nextStep = { type: "interruption" };
        state.status = "waiting_approval";
        return state;
      }

      state.messages.push({
        role: "tool",
        content: result.content,
        name: result.toolName ?? toolCall.function.name,
        tool_call_id: toolCall.id,
      });

      if (!state.completedToolCallIds.includes(toolCall.id)) {
        state.completedToolCallIds.push(toolCall.id);
      }
    }
  }

  state.nextStep = { type: "final_output" };
  state.finalOutput = params.maxIterationsFinalOutput ?? state.finalOutput;
  state.status = "completed";
  return state;
}
