import type { ChatMessage } from "../../llm/types.js";
import type { ApprovalScope, RiskLevel } from "../../shared/types.js";
import type { NextStep } from "./next-step.js";

export type RunExecutionStatus =
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed";

export type PendingRunApprovalKind = "mcp_tool" | "action_skill";

export interface PendingRunApproval {
  kind?: PendingRunApprovalKind;
  toolName: string;
  toolCallId: string;
  requiresApproval?: boolean;
  risk: RiskLevel;
  scope?: ApprovalScope;
  description?: string;
  arguments: Record<string, unknown>;
  followUpActions?: PendingRunApproval[];
}

export interface DeferredRunActionResolution {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface DeferredRunAction {
  toolName: string;
  requiresApproval: boolean;
  arguments: Record<string, unknown>;
  missingArgument: string;
  suggestedValue?: string;
  resolutionTool?: DeferredRunActionResolution;
}

export interface RunExecutionState {
  runId: string;
  sessionId: string;
  tenantId: string;
  messages: ChatMessage[];
  iteration: number;
  nextStep: NextStep;
  pendingApprovals: PendingRunApproval[];
  deferredAction?: DeferredRunAction | null;
  completedToolCallIds: string[];
  finalOutput: string | null;
  status: RunExecutionStatus;
}

export type SerializedRunExecutionState = RunExecutionState;

export interface CreateRunExecutionStateInput {
  runId: string;
  sessionId: string;
  tenantId: string;
  initialMessage: string;
}

export function createRunExecutionState(
  input: CreateRunExecutionStateInput
): RunExecutionState {
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
