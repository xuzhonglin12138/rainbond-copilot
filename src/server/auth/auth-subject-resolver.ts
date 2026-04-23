import {
  MCP_REQUIRED_AUTH_TOOL,
} from "../integrations/rainbond-mcp/tool-catalog.js";
import type { RainbondMcpClientHeaders } from "../integrations/rainbond-mcp/client.js";
import type { AuthContext, AuthSubject } from "./auth-context.js";

interface McpLike {
  initialize(headers?: RainbondMcpClientHeaders): Promise<unknown>;
  callTool<T = unknown>(
    name: string,
    arguments_: Record<string, unknown>
  ): Promise<{
    isError: boolean;
    structuredContent: T;
    content: Array<{ type: string; text: string }>;
  }>;
}

interface CurrentUserPayload {
  user_id: string;
  nick_name?: string;
  real_name?: string;
  enterprise_id?: string;
}

export class AuthSubjectResolver {
  constructor(private readonly mcpClient: McpLike) {}

  async resolveUserJwtSubject(context: AuthContext): Promise<AuthSubject> {
    await this.mcpClient.initialize({
      authorization: context.authorization,
      cookie: context.cookie,
      teamName: context.teamName,
      regionName: context.regionName,
    });

    const result = await this.mcpClient.callTool<CurrentUserPayload>(
      MCP_REQUIRED_AUTH_TOOL,
      {}
    );

    if (result.isError || !result.structuredContent?.user_id) {
      throw new Error("Unable to resolve canonical auth subject from Rainbond MCP");
    }

    return {
      authMode: "user_jwt",
      userId: result.structuredContent.user_id,
      username:
        result.structuredContent.nick_name ||
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
