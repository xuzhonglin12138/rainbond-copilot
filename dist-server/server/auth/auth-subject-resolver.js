import { MCP_REQUIRED_AUTH_TOOL, } from "../integrations/rainbond-mcp/tool-catalog.js";
export class AuthSubjectResolver {
    constructor(mcpClient) {
        this.mcpClient = mcpClient;
    }
    async resolveUserJwtSubject(context) {
        await this.mcpClient.initialize({
            authorization: context.authorization,
            cookie: context.cookie,
            teamName: context.teamName,
            regionName: context.regionName,
        });
        const result = await this.mcpClient.callTool(MCP_REQUIRED_AUTH_TOOL, {});
        if (result.isError || !result.structuredContent?.user_id) {
            throw new Error("Unable to resolve canonical auth subject from Rainbond MCP");
        }
        return {
            authMode: "user_jwt",
            userId: result.structuredContent.user_id,
            username: result.structuredContent.nick_name ||
                result.structuredContent.real_name ||
                "",
            enterpriseId: result.structuredContent.enterprise_id,
            tenantId: context.teamName || "",
            teamName: context.teamName,
            sourceSystem: context.sourceSystem,
            roles: [],
        };
    }
}
