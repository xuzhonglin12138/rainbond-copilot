import type { RiskLevel } from "../../../shared/types.js";

export interface MutableToolPolicyEntry {
  name: string;
  riskLevel: RiskLevel;
  approvalMessage: string;
  allowDirectExecution: boolean;
}

export const MUTABLE_TOOL_POLICY_LIST: MutableToolPolicyEntry[] = [
  { name: "rainbond_build_component", riskLevel: "high", approvalMessage: "构建并部署组件 {component}", allowDirectExecution: false },
  { name: "rainbond_build_helm_app", riskLevel: "high", approvalMessage: "为应用 {app} 生成 Helm 模板并写入当前应用", allowDirectExecution: false },
  { name: "rainbond_change_component_image", riskLevel: "high", approvalMessage: "修改组件 {component} 的镜像", allowDirectExecution: false },
  { name: "rainbond_check_helm_app", riskLevel: "low", approvalMessage: "校验 Helm 应用参数", allowDirectExecution: true },
  { name: "rainbond_check_yaml_app", riskLevel: "low", approvalMessage: "校验 YAML/Compose 应用", allowDirectExecution: true },
  { name: "rainbond_close_apps", riskLevel: "high", approvalMessage: "批量停止当前应用下组件", allowDirectExecution: false },
  { name: "rainbond_complete_app_share", riskLevel: "high", approvalMessage: "完成应用分享流程", allowDirectExecution: false },
  { name: "rainbond_copy_app", riskLevel: "high", approvalMessage: "复制应用 {app}", allowDirectExecution: false },
  { name: "rainbond_create_app", riskLevel: "medium", approvalMessage: "创建应用 {app}", allowDirectExecution: false },
  { name: "rainbond_create_app_from_snapshot_version", riskLevel: "high", approvalMessage: "从快照版本创建应用", allowDirectExecution: false },
  { name: "rainbond_create_app_from_yaml", riskLevel: "medium", approvalMessage: "基于 YAML/Compose 创建应用", allowDirectExecution: false },
  { name: "rainbond_create_app_share_record", riskLevel: "medium", approvalMessage: "创建应用分享记录", allowDirectExecution: false },
  { name: "rainbond_create_app_upgrade_record", riskLevel: "low", approvalMessage: "创建应用升级记录", allowDirectExecution: true },
  { name: "rainbond_create_app_version_snapshot", riskLevel: "low", approvalMessage: "为应用创建快照", allowDirectExecution: true },
  { name: "rainbond_create_component", riskLevel: "high", approvalMessage: "创建组件 {component}", allowDirectExecution: false },
  { name: "rainbond_create_component_from_image", riskLevel: "high", approvalMessage: "基于镜像创建组件 {component}", allowDirectExecution: false },
  { name: "rainbond_create_component_from_local_package", riskLevel: "high", approvalMessage: "基于本地软件包创建组件 {component}", allowDirectExecution: false },
  { name: "rainbond_create_component_from_package", riskLevel: "high", approvalMessage: "基于上传软件包创建组件 {component}", allowDirectExecution: false },
  { name: "rainbond_create_component_from_source", riskLevel: "high", approvalMessage: "基于源码创建组件 {component}", allowDirectExecution: false },
  { name: "rainbond_create_gateway_rules", riskLevel: "medium", approvalMessage: "为组件 {component} 创建网关规则", allowDirectExecution: false },
  { name: "rainbond_create_region", riskLevel: "medium", approvalMessage: "创建集群 {region}", allowDirectExecution: false },
  { name: "rainbond_delete_app", riskLevel: "high", approvalMessage: "删除应用 {app}，该操作可能不可逆", allowDirectExecution: false },
  { name: "rainbond_delete_app_share_record", riskLevel: "high", approvalMessage: "删除应用分享记录，该操作可能不可逆", allowDirectExecution: false },
  { name: "rainbond_delete_app_version_rollback_record", riskLevel: "high", approvalMessage: "删除应用回滚记录，该操作可能不可逆", allowDirectExecution: false },
  { name: "rainbond_delete_app_version_snapshot", riskLevel: "high", approvalMessage: "删除应用快照，该操作可能不可逆", allowDirectExecution: false },
  { name: "rainbond_delete_component", riskLevel: "high", approvalMessage: "删除组件 {component}，该操作可能不可逆", allowDirectExecution: false },
  { name: "rainbond_delete_package_upload", riskLevel: "low", approvalMessage: "删除软件包上传会话", allowDirectExecution: true },
  { name: "rainbond_delete_region", riskLevel: "high", approvalMessage: "删除集群 {region}，该操作可能不可逆", allowDirectExecution: false },
  { name: "rainbond_deploy_app_upgrade_record", riskLevel: "high", approvalMessage: "部署升级记录并变更应用运行版本", allowDirectExecution: false },
  { name: "rainbond_execute_app_upgrade_record", riskLevel: "high", approvalMessage: "执行应用升级记录", allowDirectExecution: false },
  { name: "rainbond_giveup_app_share", riskLevel: "high", approvalMessage: "放弃应用分享流程", allowDirectExecution: false },
  { name: "rainbond_horizontal_scale_component", riskLevel: "medium", approvalMessage: "调整组件 {component} 的实例数", allowDirectExecution: false },
  { name: "rainbond_init_package_upload", riskLevel: "low", approvalMessage: "初始化软件包上传会话", allowDirectExecution: true },
  { name: "rainbond_install_app_by_market", riskLevel: "high", approvalMessage: "从市场安装应用 {market}", allowDirectExecution: false },
  { name: "rainbond_install_app_model", riskLevel: "high", approvalMessage: "安装模板 {market}", allowDirectExecution: false },
  { name: "rainbond_manage_component_autoscaler", riskLevel: "medium", approvalMessage: "修改组件 {component} 的伸缩策略", allowDirectExecution: false },
  { name: "rainbond_manage_component_connection_envs", riskLevel: "medium", approvalMessage: "修改组件 {component} 的连接信息", allowDirectExecution: false },
  { name: "rainbond_manage_component_dependency", riskLevel: "medium", approvalMessage: "修改组件 {component} 的依赖关系", allowDirectExecution: false },
  { name: "rainbond_manage_component_envs", riskLevel: "medium", approvalMessage: "修改组件 {component} 的环境变量", allowDirectExecution: false },
  { name: "rainbond_manage_component_ports", riskLevel: "medium", approvalMessage: "修改组件 {component} 的端口配置", allowDirectExecution: false },
  { name: "rainbond_manage_component_probe", riskLevel: "medium", approvalMessage: "修改组件 {component} 的探针配置", allowDirectExecution: false },
  { name: "rainbond_manage_component_storage", riskLevel: "medium", approvalMessage: "修改组件 {component} 的存储配置", allowDirectExecution: false },
  { name: "rainbond_operate_app", riskLevel: "high", approvalMessage: "对应用执行 {action} 操作", allowDirectExecution: false },
  { name: "rainbond_rollback_app_upgrade_record", riskLevel: "high", approvalMessage: "回滚应用升级记录", allowDirectExecution: false },
  { name: "rainbond_rollback_app_version_snapshot", riskLevel: "high", approvalMessage: "回滚到应用快照版本", allowDirectExecution: false },
  { name: "rainbond_start_app_share_event", riskLevel: "high", approvalMessage: "启动应用分享流程", allowDirectExecution: false },
  { name: "rainbond_submit_app_share_info", riskLevel: "high", approvalMessage: "提交应用分享信息", allowDirectExecution: false },
  { name: "rainbond_update_region", riskLevel: "medium", approvalMessage: "更新集群 {region}", allowDirectExecution: false },
  { name: "rainbond_upgrade_app", riskLevel: "high", approvalMessage: "执行应用 {app} 的升级流程", allowDirectExecution: false },
  { name: "rainbond_upload_package_file", riskLevel: "low", approvalMessage: "上传软件包文件", allowDirectExecution: true },
  { name: "rainbond_vertical_scale_component", riskLevel: "medium", approvalMessage: "调整组件 {component} 的资源配置", allowDirectExecution: false },
];

export const MUTABLE_TOOL_POLICY_MAP = new Map(
  MUTABLE_TOOL_POLICY_LIST.map((item) => [item.name, item])
);

export function getMutableToolPolicy(
  name: string
): MutableToolPolicyEntry | null {
  return MUTABLE_TOOL_POLICY_MAP.get(name) || null;
}

function readString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function buildTemplateValues(toolName: string, input: Record<string, unknown>) {
  return {
    tool: toolName,
    app: readString(input.app_name, input.group_name, input.app_id) || "目标应用",
    component:
      readString(
        input.service_cname,
        input.component_name,
        input.service_alias,
        input.service_id
      ) || "目标组件",
    region: readString(input.region_name, input.region_id) || "目标集群",
    market: readString(input.market_name, input.app_model_id) || "目标模板",
    action: readString(input.action, input.operation) || "目标操作",
  };
}

function interpolateApprovalMessage(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/\{([a-z_]+)\}/g, (_matched, key: string) => {
    return values[key] || "";
  });
}

export function renderMutableToolApprovalMessage(
  toolName: string,
  input: Record<string, unknown>
): string {
  const policy = getMutableToolPolicy(toolName);
  if (!policy) {
    return `执行 ${toolName}`;
  }

  return interpolateApprovalMessage(
    policy.approvalMessage,
    buildTemplateValues(toolName, input)
  );
}

export function evaluateMutableToolApproval(
  toolName: string,
  input: Record<string, unknown>
): {
  requiresApproval: boolean;
  risk: RiskLevel;
  reason: string;
} {
  const policy = getMutableToolPolicy(toolName);
  if (!policy) {
    return {
      requiresApproval: true,
      risk: "high",
      reason: `执行 ${toolName}`,
    };
  }

  const operation =
    typeof input.operation === "string" ? input.operation.trim() : "";

  const lowRiskSummaryOperationMap: Record<string, string[]> = {
    rainbond_manage_component_envs: ["summary"],
    rainbond_manage_component_connection_envs: ["summary"],
    rainbond_manage_component_dependency: ["summary"],
    rainbond_manage_component_ports: ["summary"],
    rainbond_manage_component_storage: ["summary", "list_unmounted"],
    rainbond_manage_component_autoscaler: ["summary", "get_rule", "records"],
    rainbond_manage_component_probe: ["summary", "get"],
  };

  if (
    operation &&
    lowRiskSummaryOperationMap[toolName] &&
    lowRiskSummaryOperationMap[toolName].includes(operation)
  ) {
    return {
      requiresApproval: false,
      risk: "low",
      reason: renderMutableToolApprovalMessage(toolName, input),
    };
  }

  return {
    requiresApproval: !policy.allowDirectExecution,
    risk: policy.riskLevel,
    reason: renderMutableToolApprovalMessage(toolName, input),
  };
}
