import { MUTABLE_TOOL_POLICY_LIST } from "../integrations/rainbond-mcp/mutable-tool-policy.js";
import { createWorkflowRegistry } from "../workflows/registry.js";
import { rainbondWorkflowMetadata } from "../../shared/workflow-metadata/rainbond.js";

interface EmbeddedWorkflowKnowledgeEntry {
  useWhen: string;
  avoidWhen: string;
  preferredTools: string[];
  scopeHint: string;
  vocabulary?: string[];
}

const EMBEDDED_WORKFLOW_KNOWLEDGE: Record<string, EmbeddedWorkflowKnowledgeEntry> = {
  "rainbond-app-assistant": {
    useWhen:
      "用户希望由系统先判断下一步该部署、排障、验收、模板安装还是进入版本中心，或者当前诉求还不够明确。",
    avoidWhen:
      "用户已经明确指定只执行某个子流程，或者任务属于 workspace 初始化 / 本地 env 同步。",
    preferredTools: [
      "作为总控入口优先做上下文解析和子流程选择，不直接承诺 workspace 型文件操作",
    ],
    scopeHint: "至少需要 team_name 和 app_id 才能稳定进入主链路。",
  },
  "rainbond-fullstack-bootstrap": {
    useWhen: "应用尚未拉起，需要创建或复用拓扑并完成最小可运行部署。",
    avoidWhen: "拓扑已存在且主要问题是运行态异常，或者任务是版本中心操作。",
    preferredTools: [
      "rainbond_create_app",
      "rainbond_create_component*",
      "rainbond_build_component",
      "rainbond_install_app_model",
    ],
    scopeHint: "适合已经知道 team_name、region_name，并逐步补全 app_id 的部署场景。",
    vocabulary: ["building", "waiting", "running", "abnormal", "capacity-blocked"],
  },
  "rainbond-fullstack-troubleshooter": {
    useWhen:
      "拓扑已经存在，但运行态未收敛，需要低风险检查、归类阻塞点并尝试平台侧修复。",
    avoidWhen: "还没有完成拓扑创建，或者问题明显需要源码/构建层修复。",
    preferredTools: [
      "rainbond_get_app_detail",
      "rainbond_get_component_summary",
      "rainbond_get_component_logs",
      "rainbond_get_component_pods",
    ],
    scopeHint: "最好具备 app_id；若已有 component_id，可优先围绕该组件做聚焦诊断。",
    vocabulary: [
      "topology_building",
      "runtime_unhealthy",
      "runtime_healthy",
      "code_or_build_handoff_needed",
    ],
  },
  "rainbond-delivery-verifier": {
    useWhen: "部署或修复后需要确认是否真的交付完成，并给出最终访问路径。",
    avoidWhen: "运行态还明显异常，或者当前任务是在创建 / 修复资源而不是验收。",
    preferredTools: [
      "rainbond_get_app_detail",
      "rainbond_query_components",
      "rainbond_get_component_summary",
      "rainbond_get_component_logs",
    ],
    scopeHint: "通常要求 app_id 已知，必要时可结合 component_id 判断关键入口组件状态。",
    vocabulary: ["delivered", "delivered-but-needs-manual-validation", "partially-delivered", "blocked"],
  },
  "rainbond-template-installer": {
    useWhen: "用户想从本地模板库或云市场安装应用模板到当前或新建应用。",
    avoidWhen: "任务本质上是从镜像 / 源码直接创建组件，或仅需要排障。",
    preferredTools: [
      "rainbond_query_local_app_models",
      "rainbond_query_cloud_app_models",
      "rainbond_query_app_model_versions",
      "rainbond_install_app_model",
    ],
    scopeHint: "通常要求 team_name、region_name 已知，并能确定目标 app_id 或允许创建目标应用。",
  },
  "rainbond-app-version-assistant": {
    useWhen: "用户在版本中心执行快照、发布、发布记录追踪或运行态回滚。",
    avoidWhen: "任务是市场应用升级、首次部署，或纯运行态排障。",
    preferredTools: [
      "rainbond_get_app_version_overview",
      "rainbond_list_app_version_snapshots",
      "rainbond_create_app_version_snapshot",
      "rainbond_create_app_share_record",
      "rainbond_rollback_app_version_snapshot",
    ],
    scopeHint: "优先用于 `/version` 路由或已知 app_id 的版本中心场景。",
    vocabulary: ["snapshot", "publish draft", "publish event", "rollback record"],
  },
};

const READ_ONLY_PREFIXES = ["rainbond_get_", "rainbond_query_", "rainbond_list_"];

export function buildEmbeddedWorkflowKnowledgeSection(): string {
  const workflowRegistry = createWorkflowRegistry();
  const metadataById = new Map(
    rainbondWorkflowMetadata.map((item) => [item.id, item])
  );

  const lines = [
    "## Rainbond 嵌入式流程能力",
    "",
    "当前生产主链路只承诺 server/workflows 中已经接入的嵌入式 Rainbond 流程，不再把浏览器侧 prompt skills 当成独立执行脑。",
    "",
  ];

  for (const workflow of workflowRegistry.list()) {
    const metadata = metadataById.get(workflow.id);
    const entry = EMBEDDED_WORKFLOW_KNOWLEDGE[workflow.id];

    lines.push(`### ${workflow.id}`);
    lines.push(`- 概要：${metadata?.summary || workflow.description}`);
    lines.push(`- 适用场景：${entry?.useWhen || "参考当前 server workflow 路由。"}`);
    lines.push(`- 不适用场景：${entry?.avoidWhen || "超出当前嵌入式能力边界的任务。"}`);
    lines.push(`- 范围提示：${entry?.scopeHint || "优先复用当前已知上下文。"}`);
    if (entry?.preferredTools?.length) {
      lines.push(`- 优先工具：${entry.preferredTools.join("、")}`);
    }
    if (entry?.vocabulary?.length) {
      lines.push(`- 共享词汇：${entry.vocabulary.join("、")}`);
    }
    if (metadata?.stages?.length) {
      lines.push(
        `- 流程阶段：${metadata.stages.map((stage) => `${stage.id}(${stage.label})`).join(" -> ")}`
      );
    }
    lines.push("");
  }

  lines.push(
    "workspace 型流程 rainbond-project-init、rainbond-env-sync 不在当前嵌入式主链路内；如任务依赖本地项目文件初始化或本地 env 落盘，应明确提示这是外部/后续流程。"
  );

  return lines.join("\n");
}

export function buildMcpToolUsageKnowledgeSection(): string {
  const directExecutionTools = MUTABLE_TOOL_POLICY_LIST.filter(
    (item) => item.allowDirectExecution
  ).map((item) => item.name);
  const approvalRequiredTools = MUTABLE_TOOL_POLICY_LIST.filter(
    (item) => !item.allowDirectExecution
  ).map((item) => item.name);

  const directExamples = directExecutionTools
    .filter((name) =>
      [
        "rainbond_check_yaml_app",
        "rainbond_check_helm_app",
        "rainbond_create_app_version_snapshot",
        "rainbond_init_package_upload",
      ].includes(name)
    )
    .join("、");
  const approvalExamples = approvalRequiredTools
    .filter((name) =>
      [
        "rainbond_manage_component_envs",
        "rainbond_install_app_model",
        "rainbond_upgrade_app",
        "rainbond_delete_component",
      ].includes(name)
    )
    .join("、");

  return [
    "## Rainbond MCP 工具使用约束",
    "",
    `- 事实查询优先使用只读工具，当前只读工具前缀为：${READ_ONLY_PREFIXES.join("、")}。`,
    "- 当上下文已经提供 team_name、region_name、app_id、component_id 时，优先直接带上这些参数，不要为了确认当前范围重复调用列表接口。",
    `- 当前 ${MUTABLE_TOOL_POLICY_LIST.length} 个可变更 MCP 工具受统一审批策略约束。`,
    `- allowDirectExecution=true 的低风险写操作可以直接执行，典型示例：${directExamples}。`,
    `- 其余会修改资源状态、配置、部署、安装、升级、删除或分享流程的工具，必须进入审批流，典型示例：${approvalExamples}。`,
    "- 当工具属于组件级变更时，要优先确认当前 component_id 是否可信；如果 component_source=route，则先避免把它直接当成 service_id 使用。",
  ].join("\n");
}
