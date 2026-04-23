function readUiField(uiContext, camelKey, snakeKey) {
    const camelValue = uiContext[camelKey];
    if (camelValue !== undefined) {
        return camelValue;
    }
    const snakeValue = uiContext[snakeKey];
    return snakeValue !== undefined ? snakeValue : undefined;
}
function pickField(explicit, ui, prior) {
    return explicit || ui || prior;
}
export function buildExecutionScopeCandidate(input) {
    const explicit = input.explicit || {};
    const uiContext = (input.uiContext || {});
    const priorScope = input.priorScope || {};
    return {
        enterpriseId: pickField(explicit.enterpriseId, readUiField(uiContext, "enterpriseId", "enterprise_id"), priorScope.enterpriseId),
        teamName: pickField(explicit.teamName, readUiField(uiContext, "teamName", "team_name"), priorScope.teamName),
        regionName: pickField(explicit.regionName, readUiField(uiContext, "regionName", "region_name"), priorScope.regionName),
        appId: pickField(explicit.appId, readUiField(uiContext, "appId", "app_id"), priorScope.appId),
        componentId: pickField(explicit.componentId, readUiField(uiContext, "componentId", "component_id"), priorScope.componentId),
    };
}
export function applyVerifiedScope(candidate, verifiedScope) {
    return {
        enterpriseId: verifiedScope.enterpriseId || candidate.enterpriseId,
        teamName: verifiedScope.teamName || candidate.teamName,
        regionName: verifiedScope.regionName || candidate.regionName,
        appId: verifiedScope.appId || candidate.appId,
        componentId: verifiedScope.componentId || candidate.componentId,
        verified: verifiedScope.verified,
    };
}
export function buildScopeSignature(scope) {
    const verified = "verified" in scope && scope.verified ? "verified" : "candidate";
    return [
        scope.teamName || "",
        scope.regionName || "",
        scope.appId || "",
        scope.componentId || "",
        verified,
    ].join("|");
}
