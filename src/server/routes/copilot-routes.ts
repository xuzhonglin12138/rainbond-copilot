export const copilotRoutes = {
  createSession: "/api/v1/copilot/sessions",
  getSession(sessionId: string): string {
    return `/api/v1/copilot/sessions/${sessionId}`;
  },
  createMessageRun(sessionId: string): string {
    return `/api/v1/copilot/sessions/${sessionId}/messages`;
  },
  streamRunEvents(sessionId: string, runId: string): string {
    return `/api/v1/copilot/sessions/${sessionId}/runs/${runId}/events`;
  },
  decideApproval(approvalId: string): string {
    return `/api/v1/copilot/approvals/${approvalId}/decisions`;
  },
};
