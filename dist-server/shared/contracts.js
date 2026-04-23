import { z } from "zod";
export const publicCopilotEventSchema = z.object({
    type: z.string(),
    tenantId: z.string(),
    sessionId: z.string(),
    runId: z.string(),
    sequence: z.number().int().nonnegative(),
    timestamp: z.string(),
    data: z.record(z.unknown()),
});
