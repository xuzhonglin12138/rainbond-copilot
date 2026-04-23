export interface UiPresentationContext {
  view?: string;
  enterpriseId?: string;
  teamName?: string;
  regionName?: string;
  appId?: string;
  componentId?: string;
  componentSource?: string;
  pathname?: string;
}

export interface ExecutionScopeCandidate {
  enterpriseId?: string;
  teamName?: string;
  regionName?: string;
  appId?: string;
  componentId?: string;
}

export interface ResolvedExecutionScope extends ExecutionScopeCandidate {
  verified: boolean;
}
