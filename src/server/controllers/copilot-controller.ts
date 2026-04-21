import type { RequestActor } from "../../shared/types.js";
import { PersistedEventPublisher } from "../events/persisted-event-publisher.js";
import { createSseBroker, type SseBroker } from "../events/sse-broker.js";
import { copilotRoutes } from "../routes/copilot-routes.js";
import {
  createInMemoryRunResumer,
  type RunResumer,
} from "../runtime/run-resumer.js";
import { ServerLlmExecutor, type ServerChatClient } from "../runtime/server-llm-executor.js";
import { ServerRunExecutor } from "../runtime/server-run-executor.js";
import { CopilotApprovalService } from "../services/copilot-approval-service.js";
import {
  createInMemoryApprovalStore,
  type ApprovalStore,
} from "../stores/approval-store.js";
import { createInMemoryEventStore } from "../stores/event-store.js";
import {
  createInMemoryRunStore,
  type RunStore,
} from "../stores/run-store.js";
import {
  createInMemorySessionStore,
  type SessionStore,
} from "../stores/session-store.js";
import {
  CopilotSessionService,
  type CreateSessionInput,
} from "../services/copilot-session-service.js";
import { CopilotRunService } from "../services/copilot-run-service.js";

interface ControllerDeps {
  sessionStore?: SessionStore;
  runStore?: RunStore;
  approvalStore?: ApprovalStore;
  broker?: SseBroker;
  runResumer?: RunResumer;
  llmClient?: ServerChatClient | null;
}

interface CreateSessionRequest {
  actor: RequestActor;
  body?: {
    context?: Record<string, unknown>;
  };
}

interface CreateMessageRunRequest {
  actor: RequestActor;
  params: {
    sessionId: string;
  };
  body: {
    message: string;
    stream?: boolean;
  };
}

interface StreamRunEventsRequest {
  actor: RequestActor;
  params: {
    sessionId: string;
    runId: string;
  };
  query?: {
    after_sequence?: string;
  };
}

interface DecideApprovalRequest {
  actor: RequestActor;
  params: {
    approvalId: string;
  };
  body: {
    decision: "approved" | "rejected";
    comment?: string;
  };
}

export function createCopilotController(deps: ControllerDeps = {}) {
  const sessionStore = deps.sessionStore ?? createInMemorySessionStore();
  const runStore = deps.runStore ?? createInMemoryRunStore();
  const approvalStore = deps.approvalStore ?? createInMemoryApprovalStore();
  const broker = deps.broker ?? createSseBroker(createInMemoryEventStore());
  const runResumer = deps.runResumer ?? createInMemoryRunResumer();
  const eventPublisher = new PersistedEventPublisher(broker);
  const sessionService = new CopilotSessionService(sessionStore);
  const runService = new CopilotRunService(runStore, sessionStore);
  const runExecutor = new ServerRunExecutor({
    broker,
    eventPublisher,
  });
  const llmExecutor = new ServerLlmExecutor({
    broker,
    eventPublisher,
    llmClient: deps.llmClient,
  });
  const approvalService = new CopilotApprovalService({
    approvalStore,
    runStore,
    eventPublisher,
    broker,
    runResumer,
  });

  return {
    async createSession(request: CreateSessionRequest) {
      const session = await sessionService.createSession({
        actor: request.actor,
        context: request.body?.context,
      } satisfies CreateSessionInput);

      return {
        data: {
          session_id: session.sessionId,
          tenant_id: session.tenantId,
          created_at: session.createdAt,
          status: session.status,
        },
      };
    },

    async getSession(request: {
      actor: RequestActor;
      params: { sessionId: string };
    }) {
      const session = await sessionService.getSession(request.params.sessionId, {
        tenantId: request.actor.tenantId,
      });
      const pendingApprovals = await approvalStore.listPendingBySession(
        request.params.sessionId,
        request.actor.tenantId
      );

      return {
        data: {
          session_id: session.sessionId,
          tenant_id: session.tenantId,
          status: session.status,
          latest_run_id: session.latestRunId,
          pending_approvals: pendingApprovals.map((approval) => ({
            approval_id: approval.approvalId,
            description: approval.description,
            risk: approval.risk,
          })),
        },
      };
    },

    async createMessageRun(request: CreateMessageRunRequest) {
      const run = await runService.createRun({
        actor: request.actor,
        sessionId: request.params.sessionId,
        message: request.body.message,
      });

      await eventPublisher.publish({
        type: "run.status",
        tenantId: request.actor.tenantId,
        sessionId: request.params.sessionId,
        runId: run.runId,
        sequence: 1,
        data: {
          status: "thinking",
        },
      });

      const plan = runExecutor.plan(request.body.message);

      if (plan.requiresApproval) {
        runResumer.register(
          request.actor.tenantId,
          run.runId,
          async ({ runId, approval }) => {
            const currentRun = await runStore.getById(
              runId,
              request.actor.tenantId
            );

            if (!currentRun) {
              throw new Error("Run not found");
            }

            await runStore.update({
              ...currentRun,
              status: "completed",
              finishedAt: new Date().toISOString(),
            });

            const completedEvents = await broker.replay(
              runId,
              request.actor.tenantId,
              { afterSequence: 0 }
            );
            const nextSequence = completedEvents.length + 1;

            await eventPublisher.publish({
              type: "chat.message",
              tenantId: request.actor.tenantId,
              sessionId: request.params.sessionId,
              runId,
              sequence: nextSequence,
              data: {
                role: "assistant",
                content: `已根据审批结果继续执行 ${approval.skillId}。`,
              },
            });

            await eventPublisher.publish({
              type: "run.status",
              tenantId: request.actor.tenantId,
              sessionId: request.params.sessionId,
              runId,
              sequence: nextSequence + 1,
              data: {
                status: "done",
              },
            });
          }
        );

        await approvalService.createPendingApproval({
          actor: request.actor,
          sessionId: request.params.sessionId,
          runId: run.runId,
          skillId: plan.skillId,
          description: plan.description,
          risk: plan.risk,
        });
      } else {
        const handledByLlm = await llmExecutor.execute({
          actor: request.actor,
          sessionId: request.params.sessionId,
          runId: run.runId,
          message: request.body.message,
        });

        if (!handledByLlm) {
          await runExecutor.executeLowRisk({
            actor: request.actor,
            sessionId: request.params.sessionId,
            runId: run.runId,
            message: request.body.message,
          });
        }
      }

      return {
        data: {
          run_id: run.runId,
          session_id: run.sessionId,
          stream_url: copilotRoutes.streamRunEvents(
            request.params.sessionId,
            run.runId
          ),
        },
      };
    },

    async streamRunEvents(request: StreamRunEventsRequest) {
      const events = await broker.replay(
        request.params.runId,
        request.actor.tenantId,
        {
          afterSequence: Number(request.query?.after_sequence ?? 0),
        }
      );

      return {
        contentType: "text/event-stream",
        events: events.map((event) => event.payload),
      };
    },

    async decideApproval(request: DecideApprovalRequest) {
      const approval = await approvalService.decide(
        request.params.approvalId,
        {
          actor: request.actor,
          decision: request.body.decision,
          comment: request.body.comment,
        }
      );

      return {
        data: {
          approval_id: approval.approvalId,
          status: approval.status,
          resolved_at: approval.resolvedAt,
          resolved_by: {
            user_id: approval.resolvedBy,
          },
        },
      };
    },
  };
}
