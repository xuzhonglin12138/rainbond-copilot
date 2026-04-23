import { extractConsoleForwardHeaders } from "./console-request-headers.js";
import { parseRequestActor } from "./request-context.js";
export function getRequestActor(request) {
    return parseRequestActor(request.headers);
}
export async function resolveRequestActor(request, resolver) {
    const actor = getRequestActor(request);
    if (actor.userId && actor.username) {
        return {
            ...request,
            actor,
        };
    }
    const forwarded = extractConsoleForwardHeaders(request.headers);
    const hasUserJwtTransport = !!(forwarded.authorization || forwarded.cookie);
    const hasFullUserJwtTransport = !!(forwarded.authorization && forwarded.cookie);
    if (hasUserJwtTransport && !hasFullUserJwtTransport) {
        throw new Error("Authorization and Cookie headers are required together for Rainbond MCP user requests");
    }
    if (hasFullUserJwtTransport && resolver) {
        const subject = await resolver.resolveUserJwtSubject({
            mode: "user_jwt",
            authorization: forwarded.authorization,
            cookie: forwarded.cookie,
            teamName: forwarded.teamName,
            regionName: forwarded.regionName,
            sourceSystem: actor.sourceSystem,
        });
        return {
            ...request,
            actor: {
                tenantId: subject.tenantId || actor.tenantId,
                userId: subject.userId,
                username: subject.username,
                sourceSystem: subject.sourceSystem || actor.sourceSystem,
                authMode: subject.authMode,
                authorization: actor.authorization,
                cookie: actor.cookie,
                regionName: actor.regionName,
                roles: subject.roles,
                tenantName: subject.teamName || actor.tenantName,
                enterpriseId: subject.enterpriseId,
            },
        };
    }
    return {
        ...request,
        actor,
    };
}
export function withRequestActor(request) {
    return {
        ...request,
        actor: getRequestActor(request),
    };
}
