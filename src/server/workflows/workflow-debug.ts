function isDebugEnabled(): boolean {
  const raw =
    process.env.COPILOT_DEBUG_WORKFLOW ||
    process.env.RAINBOND_DEBUG_WORKFLOW ||
    "";

  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function summarizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
    };
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const summary: Record<string, unknown> = {
      type: "object",
      keys: Object.keys(record).slice(0, 12),
    };

    if (Array.isArray(record.items)) {
      summary.items_length = record.items.length;
    }
    if (Array.isArray(record.logs)) {
      summary.logs_length = record.logs.length;
    }
    if (record.status && typeof record.status === "object") {
      const statusRecord = record.status as Record<string, unknown>;
      summary.status = Object.fromEntries(
        Object.entries(statusRecord).filter(([key, entryValue]) => {
          return (
            typeof entryValue === "string" ||
            typeof entryValue === "number" ||
            typeof entryValue === "boolean"
          ) && key !== "token" && key !== "password";
        })
      );
    }

    return summary;
  }

  return value;
}

export function logWorkflowDebug(
  event: string,
  payload?: Record<string, unknown>
): void {
  if (!isDebugEnabled()) {
    return;
  }

  const normalizedPayload = payload
    ? Object.fromEntries(
        Object.entries(payload).map(([key, value]) => [key, summarizeValue(value)])
      )
    : undefined;

  const suffix = normalizedPayload
    ? ` ${JSON.stringify(normalizedPayload, null, 2)}`
    : "";
  console.log(`[workflow-debug] ${event}${suffix}`);
}
