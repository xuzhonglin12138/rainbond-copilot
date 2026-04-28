export interface WorkflowDisplayMetadata {
  id: string;
  title: string;
  summary: string;
  stages: Array<{
    id: string;
    label: string;
  }>;
}

export const handwrittenRainbondWorkflowMetadata: WorkflowDisplayMetadata[] = [
  {
    id: "rainbond-app-assistant",
    title: "Rainbond App Assistant",
    summary: "总控入口，负责上下文解析、状态判断和子流程选择。",
    stages: [
      { id: "resolve-context", label: "解析上下文" },
      { id: "assess-state", label: "判断状态" },
      { id: "select-subflow", label: "选择子流程" },
      { id: "report", label: "汇总结果" },
    ],
  },
  {
    id: "rainbond-fullstack-bootstrap",
    title: "Rainbond Fullstack Bootstrap",
    summary: "负责拓扑创建、组件复用和最小可运行部署。",
    stages: [
      { id: "resolve-scope", label: "解析范围" },
      { id: "check-topology", label: "检查拓扑" },
      { id: "create-or-reuse", label: "创建或复用" },
      { id: "deploy", label: "部署" },
    ],
  },
  {
    id: "rainbond-fullstack-troubleshooter",
    title: "Rainbond Fullstack Troubleshooter",
    summary: "负责低风险运行态排障与收敛。",
    stages: [
      { id: "resolve-scope", label: "解析范围" },
      { id: "inspect-runtime", label: "检查运行态" },
      { id: "classify-blocker", label: "归类阻塞点" },
      { id: "repair-or-stop", label: "修复或停止" },
    ],
  },
  {
    id: "rainbond-delivery-verifier",
    title: "Rainbond Delivery Verifier",
    summary: "负责最终交付校验和访问地址确认。",
    stages: [
      { id: "resolve-scope", label: "解析范围" },
      { id: "inspect-runtime", label: "检查运行态" },
      { id: "determine-access", label: "确定访问路径" },
      { id: "report", label: "交付报告" },
    ],
  },
  {
    id: "rainbond-template-installer",
    title: "Rainbond Template Installer",
    summary: "负责模板发现、版本选择与安装。",
    stages: [
      { id: "resolve-scope", label: "解析范围" },
      { id: "discover-template", label: "发现模板" },
      { id: "resolve-version", label: "选择版本" },
      { id: "install", label: "安装" },
    ],
  },
  {
    id: "rainbond-app-version-assistant",
    title: "Rainbond App Version Assistant",
    summary: "负责版本中心、快照、发布和回滚流程。",
    stages: [
      { id: "resolve-scope", label: "解析范围" },
      { id: "inspect-version-center", label: "检查版本中心" },
      { id: "execute-version-action", label: "执行版本动作" },
      { id: "report", label: "汇总结果" },
    ],
  },
];

export function mergeRainbondWorkflowMetadata(
  derived: WorkflowDisplayMetadata[]
): WorkflowDisplayMetadata[] {
  const derivedById = new Map(derived.map((item) => [item.id, item]));
  const merged: WorkflowDisplayMetadata[] = [];
  const seen = new Set<string>();

  for (const handwritten of handwrittenRainbondWorkflowMetadata) {
    const overlay = derivedById.get(handwritten.id);
    if (overlay) {
      merged.push({
        id: overlay.id,
        title: overlay.title,
        summary: overlay.summary,
        stages: overlay.stages.map((stage) => ({
          id: stage.id,
          label: stage.label,
        })),
      });
    } else {
      merged.push(handwritten);
    }
    seen.add(handwritten.id);
  }

  for (const item of derived) {
    if (!seen.has(item.id)) {
      merged.push(item);
    }
  }

  return merged;
}

/**
 * @deprecated Server runtime should call mergeRainbondWorkflowMetadata with registry data.
 * Retained for legacy callers that don't have access to the runtime registry.
 */
export const rainbondWorkflowMetadata: WorkflowDisplayMetadata[] =
  handwrittenRainbondWorkflowMetadata;
