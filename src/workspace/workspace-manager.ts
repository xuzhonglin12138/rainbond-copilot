export const WS_STORAGE_KEY_PREFIX = "rainagent:ws:";

const DEFAULT_TEMPLATES: Record<string, string> = {
  "AGENTS.md": `# AGENTS

本工作区由 RainAgent 管理。

## 可用 Agent

- **规划代理 (planner-agent)**: 分析用户需求，制定执行计划
- **执行代理 (executor-agent)**: 执行具体的操作任务
- **分析代理 (analyzer-agent)**: 诊断问题，分析日志和状态
- **顾问代理 (advisor-agent)**: 提供最佳实践建议

## 协作规则

1. 复杂任务由规划代理分解后分发
2. 执行类操作需经过审批才能执行
3. 分析结果会写入记忆以备后续参考
`,
  "RAINBOND.md": `# Rainbond 环境信息

在此记录 Rainbond 平台的相关信息。

## 常用组件

当前尚未记录组件信息，请在使用过程中逐步补充。

## 注意事项

- 执行重启等高风险操作前请确认
- 内存扩容后无需重启即可生效
`,
  "USER.md": `# 用户偏好

在此记录用户的偏好和历史信息，随时间自动更新。
`,
};

export interface Workspace {
  sessionId: string;
  dir: string;
  files: string[];
}

/**
 * 浏览器环境下的工作区管理器。
 * baseDir 即完整的工作区目录路径，如 `.workspace/session123`。
 * 文件以 localStorage key 形式存储：`rainagent:ws:{baseDir}/{filename}`
 */
export class WorkspaceManager {
  constructor(private readonly baseDir: string) {}

  async init(sessionId: string): Promise<Workspace> {
    // baseDir 已经包含 sessionId，直接用作 key 前缀
    for (const [filename, defaultContent] of Object.entries(DEFAULT_TEMPLATES)) {
      const key = this.fileKey(filename);
      if (!localStorage.getItem(key)) {
        try {
          localStorage.setItem(key, defaultContent);
        } catch (e) {
          console.warn(`Failed to init workspace file ${filename}:`, e);
        }
      }
    }

    return { sessionId, dir: this.baseDir, files: Object.keys(DEFAULT_TEMPLATES) };
  }

  readFile(filename: string): string | undefined {
    return localStorage.getItem(this.fileKey(filename)) ?? undefined;
  }

  writeFile(filename: string, content: string): void {
    try {
      localStorage.setItem(this.fileKey(filename), content);
    } catch (e) {
      console.warn(`Failed to write workspace file ${filename}:`, e);
    }
  }

  private fileKey(filename: string): string {
    return `${WS_STORAGE_KEY_PREFIX}${this.baseDir}/${filename}`;
  }
}
