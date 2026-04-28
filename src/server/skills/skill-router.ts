import type { ChatMessage, ToolDefinition } from "../../llm/types.js";
import type { CompiledSkill } from "../workflows/compiled-types.js";
import { getRegisteredSkills } from "./skill-registry.js";

export interface SkillRouterChoice {
  skillId: string;
  input: Record<string, unknown>;
  rationale?: string;
}

export interface SkillRouterClient {
  chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<{
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
    finish_reason?: string;
  }>;
}

export interface SkillRouter {
  route(input: {
    message: string;
    sessionContext?: Record<string, unknown>;
    skills?: CompiledSkill[];
  }): Promise<SkillRouterChoice | null>;
}

const SKILL_TOOL_NAME_PREFIX = "select_skill_";

// Anthropic tool names allow [a-zA-Z0-9_-]{1,64}, so the skill id (which is a
// kebab-case slug) can pass through verbatim. Keep this reversible.
export function buildSkillToolName(skillId: string): string {
  return `${SKILL_TOOL_NAME_PREFIX}${skillId}`;
}

export function parseSkillIdFromToolName(toolName: string): string | null {
  if (!toolName.startsWith(SKILL_TOOL_NAME_PREFIX)) {
    return null;
  }
  const candidate = toolName.slice(SKILL_TOOL_NAME_PREFIX.length);
  return candidate.length > 0 ? candidate : null;
}

export function buildSkillsAsTools(skills: CompiledSkill[]): ToolDefinition[] {
  return skills
    .filter((skill) => skill.mode === "embedded")
    .map((skill) => buildSkillTool(skill));
}

function buildSkillTool(skill: CompiledSkill): ToolDefinition {
  const properties: Record<string, unknown> = {
    ...(skill.workflow.input_schema?.properties || {}),
  };
  const required = skill.workflow.input_schema?.required;

  return {
    type: "function",
    function: {
      name: buildSkillToolName(skill.id),
      description: buildSkillToolDescription(skill),
      parameters: {
        type: "object",
        properties,
        ...(required && required.length > 0 ? { required } : {}),
      },
    },
  };
}

function buildSkillToolDescription(skill: CompiledSkill): string {
  const intents = skill.workflow.entry?.intents || [];
  const lines = [skill.description];
  if (intents.length > 0) {
    lines.push(`Trigger phrases: ${intents.join(" / ")}.`);
  }
  return lines.join(" ");
}

const ROUTER_SYSTEM_PROMPT = [
  "你是 Rainbond Copilot 的 skill 路由器。",
  "",
  "工作内容：阅读用户消息和会话上下文，选择最合适的 skill 工具调用，并填入 input_schema 指定的参数。",
  "",
  "规则：",
  "1. 必须调用且只调用一个 skill 工具，不要返回纯文本。",
  "2. 用户消息里能直接抽到的字段才填，不要瞎猜（例如 service_id、pod_name 这种 ID 找不到就别填）。",
  "3. inspection_mode、source、scope 这类受限枚举值要严格匹配 schema。",
  "4. 用户表达模糊时，选最贴近场景的 skill；不要为了调用而强行选。如果实在拿不准，选 rainbond-fullstack-troubleshooter 做兜底（它对运行态问题最通用）。",
  "5. 同一句包含构建相关词（构建/编译/build/compile）应优先解读为构建场景而不是运行时。",
].join("\n");

export interface CreateSkillRouterOptions {
  llmClient: SkillRouterClient;
  registry?: () => CompiledSkill[];
  systemPrompt?: string;
}

export function createSkillRouter(opts: CreateSkillRouterOptions): SkillRouter {
  const registry = opts.registry || (() => getRegisteredSkills());
  const systemPrompt = opts.systemPrompt || ROUTER_SYSTEM_PROMPT;

  return {
    async route(input) {
      const skills = (input.skills || registry()).filter(
        (skill) => skill.mode === "embedded"
      );
      if (skills.length === 0) {
        return null;
      }

      const tools = buildSkillsAsTools(skills);
      const userMessage = buildRouterUserMessage(
        input.message,
        input.sessionContext
      );

      const response = await opts.llmClient.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        tools
      );

      const toolCall = response.tool_calls?.[0];
      if (!toolCall) {
        return null;
      }

      const skillId = parseSkillIdFromToolName(toolCall.function.name);
      if (!skillId) {
        return null;
      }

      const targetSkill = skills.find((skill) => skill.id === skillId);
      if (!targetSkill) {
        return null;
      }

      const args = parseToolArguments(toolCall.function.arguments);
      const sanitizedInput = sanitizeAgainstSchema(
        args,
        targetSkill.workflow.input_schema
      );

      return {
        skillId,
        input: sanitizedInput,
      };
    },
  };
}

function buildRouterUserMessage(
  message: string,
  sessionContext?: Record<string, unknown>
): string {
  const lines = [`用户消息：${message || "(空)"}`];
  if (sessionContext && Object.keys(sessionContext).length > 0) {
    const safeContext = pickContextHints(sessionContext);
    if (Object.keys(safeContext).length > 0) {
      lines.push("");
      lines.push("当前会话上下文（仅参考，不一定完整）：");
      lines.push(JSON.stringify(safeContext, null, 2));
    }
  }
  return lines.join("\n");
}

function pickContextHints(
  sessionContext: Record<string, unknown>
): Record<string, unknown> {
  const allowedKeys = new Set([
    "teamName",
    "team_name",
    "regionName",
    "region_name",
    "appId",
    "app_id",
    "componentId",
    "component_id",
    "componentSource",
    "component_source",
    "enterpriseId",
    "enterprise_id",
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sessionContext)) {
    if (!allowedKeys.has(key)) {
      continue;
    }
    if (value === undefined || value === null || value === "") {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function sanitizeAgainstSchema(
  args: Record<string, unknown>,
  schema: CompiledSkill["workflow"]["input_schema"]
): Record<string, unknown> {
  if (!schema || !schema.properties) {
    return args;
  }
  const allowedKeys = new Set(Object.keys(schema.properties));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!allowedKeys.has(key)) {
      continue;
    }
    if (value === undefined || value === null || value === "") {
      continue;
    }
    result[key] = value;
  }
  return result;
}
