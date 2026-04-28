export function extractComponentName(input: string): string {
  const normalized = input.toLowerCase();
  const dashedMatches = normalized.match(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g);

  if (dashedMatches?.length) {
    return dashedMatches[0];
  }

  if (normalized.includes("backend")) {
    return "service-api";
  }

  return "service-web";
}

export function shouldInspectLogs(input: string, status?: string): boolean {
  const normalized = input.toLowerCase();
  return (
    normalized.includes("log") ||
    normalized.includes("日志") ||
    normalized.includes("diagnose") ||
    normalized.includes("排查") ||
    status === "abnormal" ||
    status === "stopped"
  );
}

export function summarizeLogs(logs: string[]): string {
  if (logs.length === 0) {
    return "最近日志中没有明显异常。";
  }

  const joined = logs.join("\n").toLowerCase();

  if (
    joined.includes("out of memory") ||
    joined.includes("code 137") ||
    joined.includes("oom")
  ) {
    return "最近日志显示疑似内存不足，建议优先评估扩容内存或排查异常流量。";
  }

  return `最近一条关键日志：${logs[logs.length - 1]}`;
}

export function isRecoverableLlmError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`.toLowerCase()
      : String(error).toLowerCase();

  return (
    message.includes("connection error") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("enotfound") ||
    message.includes("econnrefused") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("aborterror")
  );
}
