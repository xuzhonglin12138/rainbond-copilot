function cloneToolCalls(toolCalls) {
    return toolCalls?.map((toolCall) => ({
        ...toolCall,
        function: {
            ...toolCall.function,
        },
    }));
}
function createQueuedChat(responses) {
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
function appendAssistantMessage(state, response) {
    state.messages.push({
        role: "assistant",
        content: response.content ?? null,
        reasoning_content: response.reasoning_content ?? null,
        ...(response.tool_calls ? { tool_calls: response.tool_calls } : {}),
    });
}
function cloneMessages(messages) {
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
function markFailed(state, error) {
    state.nextStep = { type: "failed" };
    state.status = "failed";
    state.finalOutput =
        error instanceof Error ? error.message : "Run loop failed unexpectedly";
    return state;
}
async function defaultHandleToolCall(params) {
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
export async function advanceRunLoop(params) {
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
        let response;
        try {
            response = await chat(cloneMessages(state.messages), params.tools);
        }
        catch (error) {
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
            let result;
            try {
                result = await handleToolCall({
                    state,
                    iteration: state.iteration,
                    response,
                    toolCalls,
                    toolIndex,
                    toolCall,
                });
            }
            catch (error) {
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
