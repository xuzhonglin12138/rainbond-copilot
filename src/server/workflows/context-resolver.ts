import type {
  ExecutionScopeCandidate,
  ResolvedExecutionScope,
  UiPresentationContext,
} from "./types.js";

interface BuildExecutionScopeCandidateInput {
  explicit?: Partial<ExecutionScopeCandidate>;
  uiContext?: Partial<UiPresentationContext>;
  priorScope?: Partial<ExecutionScopeCandidate>;
}

function readUiField<T>(
  uiContext: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): T | undefined {
  const camelValue = uiContext[camelKey];
  if (camelValue !== undefined) {
    return camelValue as T;
  }
  const snakeValue = uiContext[snakeKey];
  return snakeValue !== undefined ? (snakeValue as T) : undefined;
}

function pickField<T>(
  explicit: T | undefined,
  ui: T | undefined,
  prior: T | undefined
): T | undefined {
  return explicit || ui || prior;
}

export function buildExecutionScopeCandidate(
  input: BuildExecutionScopeCandidateInput
): ExecutionScopeCandidate {
  const explicit = input.explicit || {};
  const uiContext = (input.uiContext || {}) as Record<string, unknown>;
  const priorScope = input.priorScope || {};

  return {
    enterpriseId: pickField(
      explicit.enterpriseId,
      readUiField<string>(uiContext, "enterpriseId", "enterprise_id"),
      priorScope.enterpriseId
    ),
    teamName: pickField(
      explicit.teamName,
      readUiField<string>(uiContext, "teamName", "team_name"),
      priorScope.teamName
    ),
    regionName: pickField(
      explicit.regionName,
      readUiField<string>(uiContext, "regionName", "region_name"),
      priorScope.regionName
    ),
    appId: pickField(
      explicit.appId,
      readUiField<string>(uiContext, "appId", "app_id"),
      priorScope.appId
    ),
    componentId: pickField(
      explicit.componentId,
      readUiField<string>(uiContext, "componentId", "component_id"),
      priorScope.componentId
    ),
  };
}

export function applyVerifiedScope(
  candidate: ExecutionScopeCandidate,
  verifiedScope: ResolvedExecutionScope
): ResolvedExecutionScope {
  return {
    enterpriseId: verifiedScope.enterpriseId || candidate.enterpriseId,
    teamName: verifiedScope.teamName || candidate.teamName,
    regionName: verifiedScope.regionName || candidate.regionName,
    appId: verifiedScope.appId || candidate.appId,
    componentId: verifiedScope.componentId || candidate.componentId,
    verified: verifiedScope.verified,
  };
}

export function buildScopeSignature(
  scope: ExecutionScopeCandidate | ResolvedExecutionScope
): string {
  const verified =
    "verified" in scope && scope.verified ? "verified" : "candidate";

  return [
    scope.teamName || "",
    scope.regionName || "",
    scope.appId || "",
    scope.componentId || "",
    verified,
  ].join("|");
}
