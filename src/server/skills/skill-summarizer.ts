import type { ChatMessage } from "../../llm/types.js";
import type { SkillRouterClient } from "./skill-router.js";

export interface SkillSummarizerInput {
  skillId: string;
  skillName: string;
  skillNarrative: string;
  userMessage?: string;
  skillInput: Record<string, unknown>;
  toolOutputs: Array<{
    name: string;
    output: unknown;
  }>;
}

export interface WorkflowSummarizer {
  summarize(
    input: SkillSummarizerInput,
    onChunk?: (chunk: string) => void | Promise<void>
  ): Promise<string>;
}

export interface CreateSkillSummarizerOptions {
  llmClient: SkillRouterClient;
  systemPromptFooter?: string;
  maxNarrativeChars?: number;
  maxToolOutputCharsPerCall?: number;
}

const DEFAULT_NARRATIVE_BUDGET = 32_000;
const DEFAULT_TOOL_OUTPUT_BUDGET = 6_000;

/**
 * Build a summarizer that asks the LLM to interpret a skill's tool-call
 * results through the lens of that skill's SKILL.md narrative. This is what
 * turns the placeholder "已通过编译型流程执行 X" string into an actual
 * skill-formatted reply (e.g. the troubleshooter's `### Problem Judgment /
 * ### Actions Taken / ### Verification Result / ### Follow-up Advice`
 * sections from its evals fixtures).
 */
export function createSkillSummarizer(
  opts: CreateSkillSummarizerOptions
): WorkflowSummarizer {
  const narrativeBudget = opts.maxNarrativeChars ?? DEFAULT_NARRATIVE_BUDGET;
  const toolOutputBudget =
    opts.maxToolOutputCharsPerCall ?? DEFAULT_TOOL_OUTPUT_BUDGET;

  return {
    async summarize(input, onChunk) {
      const trimmedNarrative = truncate(input.skillNarrative, narrativeBudget);
      const trimmedOutputs = input.toolOutputs.map((entry) => ({
        name: entry.name,
        output: serializeToolOutput(entry.output, toolOutputBudget),
      }));

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: buildSystemPrompt({
            skillName: input.skillName,
            skillId: input.skillId,
            narrative: trimmedNarrative,
            footer: opts.systemPromptFooter,
          }),
        },
        {
          role: "user",
          content: buildUserPrompt({
            originalMessage: input.userMessage,
            skillInput: input.skillInput,
            toolOutputs: trimmedOutputs,
          }),
        },
      ];

      const response =
        onChunk && typeof opts.llmClient.streamChat === "function"
          ? await opts.llmClient.streamChat(messages, undefined, onChunk)
          : await opts.llmClient.chat(messages);
      const text = (response.content || "").trim();
      return text || "(LLM 未返回任何总结。请检查模型与 prompt 配置。)";
    },
  };
}

function buildSystemPrompt(opts: {
  skillName: string;
  skillId: string;
  narrative: string;
  footer?: string;
}): string {
  const parts = [
    `你是 ${opts.skillName} (\`${opts.skillId}\`) 这个 Rainbond skill 的执行体。`,
    "刚才框架已经按照 skill 的 yaml workflow 调用了一组 MCP 工具。你现在的任务是结合下面这份 SKILL.md 指令和工具结果，给用户一个完整的诊断/总结回复。",
    "",
    "硬性要求：",
    "1. 严格遵循 skill 指令里规定的输出格式（章节标题、术语、structured output）。",
    "2. 不要凭空补 skill 没说过的诊断；只用工具结果支持的事实。",
    "3. 如果工具调用失败或者工具结果明显不足以判断，必须明确说出当前已知信息、缺失信息以及下一步建议。",
    "4. 不要重复列出原始 JSON；要解读它。",
    "",
    "## SKILL.md 指令",
    "",
    opts.narrative,
  ];
  if (opts.footer) {
    parts.push("", opts.footer);
  }
  return parts.join("\n");
}

function buildUserPrompt(opts: {
  originalMessage?: string;
  skillInput: Record<string, unknown>;
  toolOutputs: Array<{ name: string; output: string }>;
}): string {
  const parts: string[] = [];
  if (opts.originalMessage) {
    parts.push("## 用户原始消息");
    parts.push(opts.originalMessage);
    parts.push("");
  }
  parts.push("## 当前 input 参数");
  parts.push("```json");
  parts.push(JSON.stringify(opts.skillInput || {}, null, 2));
  parts.push("```");
  parts.push("");
  parts.push("## 工具调用结果");
  if (opts.toolOutputs.length === 0) {
    parts.push("（本轮没有任何工具被调用——可能是 branch when 都不匹配，或上下文不全跳过了。请据此提示用户补充什么信息。）");
  } else {
    for (const entry of opts.toolOutputs) {
      parts.push(`### ${entry.name}`);
      parts.push("```json");
      parts.push(entry.output);
      parts.push("```");
      parts.push("");
    }
  }
  parts.push("请按 SKILL.md 指令的输出格式给出回复。");
  return parts.join("\n");
}

function serializeToolOutput(value: unknown, budget: number): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value, null, 2);
  } catch {
    serialized = String(value);
  }
  return truncate(serialized, budget);
}

function truncate(value: string, budget: number): string {
  if (!value) return value;
  if (value.length <= budget) return value;
  return `${value.slice(0, budget)}\n... [truncated ${value.length - budget} chars]`;
}
