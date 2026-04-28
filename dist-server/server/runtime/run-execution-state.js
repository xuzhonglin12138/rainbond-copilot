export function createRunExecutionState(input) {
    return {
        runId: input.runId,
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        messages: [
            {
                role: "user",
                content: input.initialMessage,
            },
        ],
        iteration: 0,
        nextStep: { type: "run_again" },
        pendingApprovals: [],
        deferredAction: null,
        completedToolCallIds: [],
        finalOutput: null,
        status: "running",
    };
}
