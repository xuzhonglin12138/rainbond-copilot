import { loadAllKnowledge } from "../knowledge/loader";
import type { Skill } from "../skills/types";
import type { ContextComponents } from "../context";

export async function buildSystemPrompt(
  skills: Skill[],
  context?: ContextComponents
): Promise<string> {
  const knowledge = await loadAllKnowledge();
  const actionSkillDescriptions = buildActionSkillDescriptions(skills);
  const promptSkillDescriptions = buildPromptSkillDescriptions(skills);
  const contextSection = context ? buildContextSection(context) : "";

  return `你是 Rainbond Copilot，一个专业的 Rainbond 云原生应用管理平台助手。

## 你的角色和能力

你是 Rainbond 平台的专家助手，具备以下能力：
- 深入理解 Rainbond 的核心概念、架构和操作
- 帮助用户部署、配置、管理和诊断 Rainbond 应用
- 提供最佳实践建议和故障排查指导
- 使用工具执行实际操作（查询状态、查看日志、重启组件等）
- 记忆和学习用户偏好，提供个性化服务

## 核心知识

${knowledge}

${contextSection}

## 专业技能指南

你掌握以下专业技能指南，可以根据用户问题提供详细的指导：

${promptSkillDescriptions}

## 可用工具

你可以调用以下工具来帮助用户：

${actionSkillDescriptions}

## 交互原则

1. **理解意图**：仔细理解用户的问题和需求，提供精准的帮助
2. **主动诊断**：遇到故障问题时，主动使用工具查询状态和日志
3. **清晰解释**：解释问题原因和解决方案，让用户理解为什么这样做
4. **安全操作**：
   - 高风险操作（restart、scale）必须先说明影响，然后调用工具请求审批
   - 只有用户明确同意后才能执行
   - 低风险操作（查询状态、查看日志）可以直接执行
5. **结构化回复**：
   - 先诊断问题（使用工具）
   - 再分析原因
   - 最后提出解决方案
6. **专业友好**：使用专业术语但保持友好，避免过于技术化的表达

## 工具使用规则

### 低风险工具（直接执行）
- get-component-status: 查询组件状态
- get-component-logs: 查看组件日志（当日志范围较大或组件敏感时需审批）

### 高风险工具（需要审批）
- restart-component: 重启组件（会导致服务中断）
- scale-component-memory: 调整内存配置（需要重启）

### 工具调用流程
1. 分析用户需求，确定需要调用的工具
2. 如果是高风险操作，先说明影响和风险
3. 调用工具
4. 根据工具返回结果继续分析或给出建议

## 示例对话

用户："我的 frontend-ui 组件打不开了"

你的思路：
1. 先查询组件状态（get-component-status）
2. 如果状态异常，查看日志（get-component-logs）
3. 分析日志找出原因（如 OOM、配置错误等）
4. 提出解决方案（如扩容内存、修改配置）
5. 如果需要重启或扩容，说明影响并请求审批

记住：你是用户的可信赖助手，始终以解决问题为目标，提供专业、清晰、安全的帮助。`;
}

function buildContextSection(context: ContextComponents): string {
  const sections: string[] = [];

  if (context.agentsDoc) {
    sections.push(`### Agent 协作信息\n\n${context.agentsDoc}`);
  }

  if (context.rainbondDoc) {
    sections.push(`### Rainbond 环境信息\n\n${context.rainbondDoc}`);
  }

  if (context.userDoc) {
    sections.push(`### 用户偏好和历史\n\n${context.userDoc}`);
  }

  if (
    context.conversationSummaries &&
    context.conversationSummaries.length > 0
  ) {
    const summaries = context.conversationSummaries
      .slice(-2)
      .map(
        (s) =>
          `**对话摘要** (${new Date(s.timestamp).toLocaleString()}):\n${s.summary}\n关键点: ${s.keyPoints.join(", ")}`
      )
      .join("\n\n");
    sections.push(`### 历史对话摘要\n\n${summaries}`);
  }

  if (context.recentMemories && context.recentMemories.length > 0) {
    sections.push(
      `### 最近的交互\n\n${context.recentMemories.map((m) => `- ${m}`).join("\n")}`
    );
  }

  if (context.importantMemories && context.importantMemories.length > 0) {
    sections.push(
      `### 重要记忆\n\n${context.importantMemories.map((m) => `- ${m}`).join("\n")}`
    );
  }

  if (sections.length === 0) {
    return "";
  }

  return `## 上下文信息\n\n${sections.join("\n\n")}`;
}

function buildActionSkillDescriptions(skills: Skill[]): string {
  const actionSkills = skills.filter(
    (s): s is Extract<Skill, { kind: "action" }> => s.kind === "action"
  );

  return actionSkills
    .map((skill) => {
      const riskBadge =
        skill.risk === "high" ? "⚠️ 高风险" : skill.risk === "medium" ? "⚡ 中风险" : "✅ 低风险";
      const approvalNote = skill.requiresApproval
        ? "（需要用户审批）"
        : skill.approvalPolicy
          ? "（高敏感参数下会触发审批）"
          : "";

      return `### ${skill.name} ${riskBadge}
- **ID**: ${skill.id}
- **描述**: ${skill.description}
- **风险等级**: ${skill.risk || "low"}
${approvalNote ? `- **注意**: ${approvalNote}` : ""}`;
    })
    .join("\n\n");
}

function buildPromptSkillDescriptions(skills: Skill[]): string {
  const promptSkills = skills.filter((s) => s.kind === "prompt");

  return promptSkills
    .map((skill) => {
      return `### ${skill.name}
- **ID**: ${skill.id}
- **描述**: ${skill.description}

${skill.content}`;
    })
    .join("\n\n---\n\n");
}
