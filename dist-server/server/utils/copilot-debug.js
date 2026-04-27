const SERVER_DEBUG_PREFIX = "[copilot-debug]";
const SERVER_DEBUG_STAGES = {
    "controller:createMessageRun:background-error": true,
    "approval:decide:resume-error": true,
    "llm:execute:failed": true,
};
export function summarizeCopilotEvent(event) {
    const data = event.data || {};
    return {
        type: event.type || "",
        sequence: event.sequence || 0,
        runId: event.runId || "",
        sessionId: event.sessionId || "",
        status: typeof data.status === "string" ? data.status : "",
        approvalId: typeof data.approval_id === "string" ? data.approval_id : "",
        traceId: typeof data.trace_id === "string" ? data.trace_id : "",
        toolCallId: typeof data.tool_call_id === "string" ? data.tool_call_id : "",
        toolName: typeof data.tool_name === "string" ? data.tool_name : "",
        messageId: typeof data.message_id === "string" ? data.message_id : "",
        deltaLength: typeof data.delta === "string" ? data.delta.length : 0,
        contentLength: typeof data.content === "string" ? data.content.length : 0,
        hasOutput: typeof data.output !== "undefined",
    };
}
export function logCopilotDebug(stage, payload = {}) {
    if (!SERVER_DEBUG_STAGES[stage]) {
        return;
    }
    console.info(SERVER_DEBUG_PREFIX, stage, payload);
}
