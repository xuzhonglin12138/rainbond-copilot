import type { RequestActor } from "../../shared/types";
import { parseRequestActor } from "./request-context";

export interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

export interface RequestWithActor extends RequestWithHeaders {
  actor: RequestActor;
}

export function getRequestActor(request: RequestWithHeaders): RequestActor {
  return parseRequestActor(request.headers);
}

export function withRequestActor<T extends RequestWithHeaders>(
  request: T
): T & { actor: RequestActor } {
  return {
    ...request,
    actor: getRequestActor(request),
  };
}
