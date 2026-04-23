type HeaderValue = string | string[] | undefined;
type HeaderMap = Record<string, HeaderValue>;

function readHeader(headers: HeaderMap, name: string): string {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }
  return typeof value === "string" ? value.trim() : "";
}

export interface ConsoleForwardHeaders {
  authorization?: string;
  cookie?: string;
  regionName?: string;
  teamName?: string;
}

export function extractConsoleForwardHeaders(
  headers: HeaderMap
): ConsoleForwardHeaders {
  return {
    authorization: readHeader(headers, "authorization") || undefined,
    cookie: readHeader(headers, "cookie") || undefined,
    regionName: readHeader(headers, "x-region-name") || undefined,
    teamName: readHeader(headers, "x-team-name") || undefined,
  };
}
