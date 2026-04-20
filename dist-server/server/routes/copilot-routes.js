export const copilotRoutes = {
    createSession: "/api/v1/copilot/sessions",
    getSession(sessionId) {
        return `/api/v1/copilot/sessions/${sessionId}`;
    },
    createMessageRun(sessionId) {
        return `/api/v1/copilot/sessions/${sessionId}/messages`;
    },
    streamRunEvents(sessionId, runId) {
        return `/api/v1/copilot/sessions/${sessionId}/runs/${runId}/events`;
    },
    decideApproval(approvalId) {
        return `/api/v1/copilot/approvals/${approvalId}/decisions`;
    },
};
