function cloneFollowUpActions(action) {
    return action?.followUpActions?.map((item) => ({
        kind: item.kind,
        toolName: item.toolName,
        toolCallId: item.toolCallId,
        risk: item.risk,
        scope: item.scope,
        description: item.description,
        arguments: item.arguments ? { ...item.arguments } : undefined,
        followUpActions: cloneFollowUpActions(item),
    }));
}
function cloneEntry(entry) {
    return {
        approvalId: entry.approvalId,
        kind: entry.kind,
        toolName: entry.toolName,
        toolCallId: entry.toolCallId,
        risk: entry.risk,
        scope: entry.scope,
        description: entry.description,
        arguments: { ...entry.arguments },
        followUpActions: cloneFollowUpActions(entry),
        decision: entry.decision,
        rejectionMessage: entry.rejectionMessage,
    };
}
function normalizeEntry(input) {
    return {
        approvalId: input.approvalId,
        kind: input.kind,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        risk: input.risk,
        scope: input.scope,
        description: input.description,
        arguments: input.arguments ? { ...input.arguments } : {},
        followUpActions: cloneFollowUpActions(input),
        decision: "pending",
    };
}
export function createApprovalLedger(initialEntries = []) {
    const entries = initialEntries.map((entry) => cloneEntry(entry));
    const findEntry = (toolName, toolCallId) => entries.find((entry) => entry.toolName === toolName && entry.toolCallId === toolCallId);
    return {
        request(input) {
            const normalized = normalizeEntry(input);
            const existing = findEntry(normalized.toolName, normalized.toolCallId);
            if (existing) {
                existing.approvalId = normalized.approvalId;
                existing.kind = normalized.kind;
                existing.risk = normalized.risk;
                existing.scope = normalized.scope;
                existing.description = normalized.description;
                existing.arguments = { ...normalized.arguments };
                existing.followUpActions = cloneFollowUpActions(normalized);
                existing.decision = "pending";
                existing.rejectionMessage = undefined;
                return cloneEntry(existing);
            }
            entries.push(normalized);
            return cloneEntry(normalized);
        },
        approve(toolName, toolCallId) {
            const entry = findEntry(toolName, toolCallId);
            if (!entry) {
                return undefined;
            }
            entry.decision = "approved";
            entry.rejectionMessage = undefined;
            return cloneEntry(entry);
        },
        reject(toolName, toolCallId, rejectionMessage) {
            const entry = findEntry(toolName, toolCallId);
            if (!entry) {
                return undefined;
            }
            entry.decision = "rejected";
            entry.rejectionMessage = rejectionMessage;
            return cloneEntry(entry);
        },
        getDecision(toolName, toolCallId) {
            return findEntry(toolName, toolCallId)?.decision;
        },
        getPending() {
            return entries
                .filter((entry) => entry.decision === "pending")
                .map((entry) => cloneEntry(entry));
        },
        getByApprovalId(approvalId) {
            const entry = entries.find((item) => item.approvalId === approvalId);
            return entry ? cloneEntry(entry) : undefined;
        },
        toJSON() {
            return entries.map((entry) => cloneEntry(entry));
        },
    };
}
