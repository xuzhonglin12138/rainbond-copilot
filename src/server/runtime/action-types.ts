export interface LegacyComponentStatusInput {
  name: string;
}

export interface LegacyComponentLogsInput extends LegacyComponentStatusInput {
  lines?: number;
}

export interface LegacyScaleMemoryInput extends LegacyComponentStatusInput {
  memory: number;
}

export interface RealComponentScopeInput {
  teamName: string;
  regionName: string;
  appId: number;
  serviceId: string;
}

export interface RealComponentLogsInput extends RealComponentScopeInput {
  lines?: number;
}

export interface RealRestartInput {
  teamName: string;
  regionName: string;
  appId: number;
  action: string;
  serviceId?: string;
}

export interface RealScaleMemoryInput extends RealComponentScopeInput {
  memory: number;
}
