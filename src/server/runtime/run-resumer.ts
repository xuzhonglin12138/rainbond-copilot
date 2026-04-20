import type { ApprovalRecord } from "../stores/approval-store.js";

export interface ResumeRunInput {
  tenantId: string;
  runId: string;
  approval: ApprovalRecord;
}

export type RunResumeHandler = (input: ResumeRunInput) => Promise<void>;

export interface RunResumer {
  register(tenantId: string, runId: string, handler: RunResumeHandler): void;
  resume(input: ResumeRunInput): Promise<boolean>;
}

function runKey(tenantId: string, runId: string): string {
  return `${tenantId}:${runId}`;
}

export class InMemoryRunResumer implements RunResumer {
  private handlers = new Map<string, RunResumeHandler>();

  register(tenantId: string, runId: string, handler: RunResumeHandler): void {
    this.handlers.set(runKey(tenantId, runId), handler);
  }

  async resume(input: ResumeRunInput): Promise<boolean> {
    const key = runKey(input.tenantId, input.runId);
    const handler = this.handlers.get(key);

    if (!handler) {
      return false;
    }

    this.handlers.delete(key);
    await handler(input);
    return true;
  }
}

export function createInMemoryRunResumer(): RunResumer {
  return new InMemoryRunResumer();
}
