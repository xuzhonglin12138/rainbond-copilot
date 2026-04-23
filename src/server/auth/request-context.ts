import type { RequestActor } from "../../shared/types.js";

type HeaderValue = string | string[] | undefined;
type HeaderMap = Record<string, HeaderValue>;

const DEFAULT_REQUEST_ACTOR: RequestActor = {
  tenantId: "local-default",
  userId: "",
  username: "",
  sourceSystem: "local-client",
  roles: [],
};

function readHeader(headers: HeaderMap, name: string): string {
  const value = headers[name];

  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }

  return typeof value === "string" ? value.trim() : "";
}

function parseRoles(rawRoles: string): string[] {
  if (!rawRoles) {
    return [];
  }

  return rawRoles
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
}

export function parseRequestActor(headers: HeaderMap): RequestActor {
  const authorization = readHeader(headers, "authorization");
  const cookie = readHeader(headers, "cookie");
  const tenantId =
    readHeader(headers, "x-copilot-tenant-id") ||
    readHeader(headers, "x-team-name") ||
    DEFAULT_REQUEST_ACTOR.tenantId;
  const isBrowserAuthTransport = !!(authorization || cookie);
  const userId = isBrowserAuthTransport
    ? DEFAULT_REQUEST_ACTOR.userId
    : readHeader(headers, "x-copilot-user-id") || DEFAULT_REQUEST_ACTOR.userId;
  const username = isBrowserAuthTransport
    ? DEFAULT_REQUEST_ACTOR.username
    : readHeader(headers, "x-copilot-username") || DEFAULT_REQUEST_ACTOR.username;
  const sourceSystem =
    readHeader(headers, "x-copilot-source-system") ||
    DEFAULT_REQUEST_ACTOR.sourceSystem;

  return {
    tenantId,
    userId,
    username,
    sourceSystem,
    authMode: isBrowserAuthTransport
      ? undefined
      : userId && username
        ? "trusted_headers"
        : undefined,
    authorization: authorization || undefined,
    cookie: cookie || undefined,
    regionName: readHeader(headers, "x-region-name") || undefined,
    roles: parseRoles(readHeader(headers, "x-copilot-roles")),
    displayName:
      readHeader(headers, "x-copilot-display-name") ||
      DEFAULT_REQUEST_ACTOR.displayName,
    tenantName:
      readHeader(headers, "x-copilot-tenant-name") ||
      readHeader(headers, "x-team-name") ||
      DEFAULT_REQUEST_ACTOR.tenantName,
  };
}
