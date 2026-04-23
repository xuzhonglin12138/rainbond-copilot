import { readFile } from "node:fs/promises";
import { join } from "node:path";

const KNOWLEDGE_FILES = [
  join(process.cwd(), "src/knowledge/core-concepts.md"),
  join(process.cwd(), "src/knowledge/troubleshooting.md"),
];

let cachedPromptPromise: Promise<string> | null = null;

async function readTextOrEmpty(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

export async function buildServerSystemPrompt(): Promise<string> {
  if (!cachedPromptPromise) {
    cachedPromptPromise = (async () => {
      const knowledgeParts = await Promise.all(
        KNOWLEDGE_FILES.map(readTextOrEmpty)
      );
      const knowledge = knowledgeParts.filter(Boolean).join("\n\n---\n\n");

      return `你是 Rainbond Copilot，一个专业的 Rainbond 云原生应用管理平台助手。

## 你的角色和能力

- 深入理解 Rainbond 的核心概念、架构和操作
- 帮助用户部署、配置、管理和诊断 Rainbond 应用
- 使用工具执行实际操作（查询状态、查看日志、重启组件等）
- 在信息不足时先澄清，再执行
- 回答要专业、清晰、结构化

## 工具使用原则

- 低风险操作（例如查询状态、查看日志）可以直接执行
- 高风险操作（例如重启、扩容）要先明确影响，再通过审批流处理
- 所有会修改 Rainbond 资源状态、配置、部署、升级、删除、分享、安装的写操作，都必须先确认是否需要审批
- 优先先查后改；如果上下文已经足够，不要为了凑参数重复调用上游列表接口
- 如果工具结果能帮助回答，就先看结果再回答，不要跳过分析

## 回答原则

- 先理解用户问题，再决定是否用工具
- 能直接回答的普通问题，就直接回答
- 如果用户在问故障、状态、日志、部署问题，优先结合工具结果给结论
- 回答时尽量解释原因，不只给结论
- 一旦调用了工具，你的最终回复必须基于工具返回结果明确回答用户问题
- 禁止在已有工具结果时输出空泛占位语句，例如“我已经完成当前分析，但没有生成额外回复”
- 如果工具结果不足以完整回答，就明确说明目前已知信息、未知信息以及建议的下一步

## Rainbond 知识

${knowledge}`;
    })();
  }

  return cachedPromptPromise;
}
