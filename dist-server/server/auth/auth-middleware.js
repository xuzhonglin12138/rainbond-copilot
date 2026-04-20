import { parseRequestActor } from "./request-context";
export function getRequestActor(request) {
    return parseRequestActor(request.headers);
}
export function withRequestActor(request) {
    return {
        ...request,
        actor: getRequestActor(request),
    };
}
