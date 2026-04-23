const component = "component";
const app = "app";
const team = "team";
const enterprise = "enterprise";
export const MUTABLE_TOOL_POLICY_LIST = [
    { name: "rainbond_build_component", scope: component, riskLevel: "high", approvalMessage: "构建并部署组件 {component}", allowDirectExecution: false },
    { name: "rainbond_build_helm_app", scope: app, riskLevel: "high", approvalMessage: "为应用 {app} 生成 Helm 模板并写入当前应用", allowDirectExecution: false },
    { name: "rainbond_change_component_image", scope: component, riskLevel: "high", approvalMessage: "修改组件 {component} 的镜像", allowDirectExecution: false },
    { name: "rainbond_check_helm_app", scope: app, riskLevel: "low", approvalMessage: "校验 Helm 应用参数", allowDirectExecution: true },
    { name: "rainbond_check_yaml_app", scope: app, riskLevel: "low", approvalMessage: "校验 YAML/Compose 应用", allowDirectExecution: true },
    { name: "rainbond_close_apps", scope: app, riskLevel: "high", approvalMessage: "批量停止当前应用下组件", allowDirectExecution: false },
    { name: "rainbond_complete_app_share", scope: app, riskLevel: "high", approvalMessage: "完成应用分享流程", allowDirectExecution: false },
    { name: "rainbond_copy_app", scope: app, riskLevel: "high", approvalMessage: "复制应用 {app}", allowDirectExecution: false },
    { name: "rainbond_create_app", scope: team, riskLevel: "medium", approvalMessage: "创建应用 {app}", allowDirectExecution: false },
    { name: "rainbond_create_app_from_snapshot_version", scope: app, riskLevel: "high", approvalMessage: "从快照版本创建应用", allowDirectExecution: false },
    { name: "rainbond_create_app_from_yaml", scope: app, riskLevel: "medium", approvalMessage: "基于 YAML/Compose 创建应用", allowDirectExecution: false },
    { name: "rainbond_create_app_share_record", scope: app, riskLevel: "medium", approvalMessage: "创建应用分享记录", allowDirectExecution: false },
    { name: "rainbond_create_app_upgrade_record", scope: app, riskLevel: "low", approvalMessage: "创建应用升级记录", allowDirectExecution: true },
    { name: "rainbond_create_app_version_snapshot", scope: app, riskLevel: "low", approvalMessage: "为应用创建快照", allowDirectExecution: true },
    { name: "rainbond_create_component", scope: component, riskLevel: "high", approvalMessage: "创建组件 {component}", allowDirectExecution: false },
    { name: "rainbond_create_component_from_image", scope: component, riskLevel: "high", approvalMessage: "基于镜像创建组件 {component}", allowDirectExecution: false },
    { name: "rainbond_create_component_from_local_package", scope: component, riskLevel: "high", approvalMessage: "基于本地软件包创建组件 {component}", allowDirectExecution: false },
    { name: "rainbond_create_component_from_package", scope: component, riskLevel: "high", approvalMessage: "基于上传软件包创建组件 {component}", allowDirectExecution: false },
    { name: "rainbond_create_component_from_source", scope: component, riskLevel: "high", approvalMessage: "基于源码创建组件 {component}", allowDirectExecution: false },
    { name: "rainbond_create_gateway_rules", scope: app, riskLevel: "medium", approvalMessage: "为组件 {component} 创建网关规则", allowDirectExecution: false },
    { name: "rainbond_create_region", scope: enterprise, riskLevel: "medium", approvalMessage: "创建集群 {region}", allowDirectExecution: false },
    { name: "rainbond_delete_app", scope: app, riskLevel: "high", approvalMessage: "删除应用 {app}，该操作可能不可逆", allowDirectExecution: false },
    { name: "rainbond_delete_app_share_record", scope: app, riskLevel: "high", approvalMessage: "删除应用分享记录，该操作可能不可逆", allowDirectExecution: false },
    { name: "rainbond_delete_app_version_rollback_record", scope: app, riskLevel: "high", approvalMessage: "删除应用回滚记录，该操作可能不可逆", allowDirectExecution: false },
    { name: "rainbond_delete_app_version_snapshot", scope: app, riskLevel: "high", approvalMessage: "删除应用快照，该操作可能不可逆", allowDirectExecution: false },
    { name: "rainbond_delete_component", scope: component, riskLevel: "high", approvalMessage: "删除组件 {component}，该操作可能不可逆", allowDirectExecution: false },
    { name: "rainbond_delete_package_upload", scope: component, riskLevel: "low", approvalMessage: "删除软件包上传会话", allowDirectExecution: true },
    { name: "rainbond_delete_region", scope: enterprise, riskLevel: "high", approvalMessage: "删除集群 {region}，该操作可能不可逆", allowDirectExecution: false },
    { name: "rainbond_deploy_app_upgrade_record", scope: app, riskLevel: "high", approvalMessage: "部署升级记录并变更应用运行版本", allowDirectExecution: false },
    { name: "rainbond_execute_app_upgrade_record", scope: app, riskLevel: "high", approvalMessage: "执行应用升级记录", allowDirectExecution: false },
    { name: "rainbond_giveup_app_share", scope: app, riskLevel: "high", approvalMessage: "放弃应用分享流程", allowDirectExecution: false },
    { name: "rainbond_horizontal_scale_component", scope: component, riskLevel: "medium", approvalMessage: "调整组件 {component} 的实例数", allowDirectExecution: false },
    { name: "rainbond_init_package_upload", scope: component, riskLevel: "low", approvalMessage: "初始化软件包上传会话", allowDirectExecution: true },
    { name: "rainbond_install_app_by_market", scope: app, riskLevel: "high", approvalMessage: "从市场安装应用 {market}", allowDirectExecution: false },
    { name: "rainbond_install_app_model", scope: app, riskLevel: "high", approvalMessage: "安装模板 {market}", allowDirectExecution: false },
    { name: "rainbond_manage_component_autoscaler", scope: component, riskLevel: "medium", approvalMessage: "修改组件 {component} 的伸缩策略", allowDirectExecution: false },
    { name: "rainbond_manage_component_connection_envs", scope: component, riskLevel: "medium", approvalMessage: "修改组件 {component} 的连接信息", allowDirectExecution: false },
    { name: "rainbond_manage_component_dependency", scope: component, riskLevel: "medium", approvalMessage: "修改组件 {component} 的依赖关系", allowDirectExecution: false },
    { name: "rainbond_manage_component_envs", scope: component, riskLevel: "medium", approvalMessage: "修改组件 {component} 的环境变量", allowDirectExecution: false },
    { name: "rainbond_manage_component_ports", scope: component, riskLevel: "medium", approvalMessage: "修改组件 {component} 的端口配置", allowDirectExecution: false },
    { name: "rainbond_manage_component_probe", scope: component, riskLevel: "medium", approvalMessage: "修改组件 {component} 的探针配置", allowDirectExecution: false },
    { name: "rainbond_manage_component_storage", scope: component, riskLevel: "medium", approvalMessage: "修改组件 {component} 的存储配置", allowDirectExecution: false },
    { name: "rainbond_operate_app", scope: app, riskLevel: "high", approvalMessage: "对应用执行 {action} 操作", allowDirectExecution: false },
    { name: "rainbond_rollback_app_upgrade_record", scope: app, riskLevel: "high", approvalMessage: "回滚应用升级记录", allowDirectExecution: false },
    { name: "rainbond_rollback_app_version_snapshot", scope: app, riskLevel: "high", approvalMessage: "回滚到应用快照版本", allowDirectExecution: false },
    { name: "rainbond_start_app_share_event", scope: app, riskLevel: "high", approvalMessage: "启动应用分享流程", allowDirectExecution: false },
    { name: "rainbond_submit_app_share_info", scope: app, riskLevel: "high", approvalMessage: "提交应用分享信息", allowDirectExecution: false },
    { name: "rainbond_update_region", scope: enterprise, riskLevel: "medium", approvalMessage: "更新集群 {region}", allowDirectExecution: false },
    { name: "rainbond_upgrade_app", scope: app, riskLevel: "high", approvalMessage: "执行应用 {app} 的升级流程", allowDirectExecution: false },
    { name: "rainbond_upload_package_file", scope: component, riskLevel: "low", approvalMessage: "上传软件包文件", allowDirectExecution: true },
    { name: "rainbond_vertical_scale_component", scope: component, riskLevel: "medium", approvalMessage: "调整组件 {component} 的资源配置", allowDirectExecution: false },
];
export const MUTABLE_TOOL_POLICY_MAP = new Map(MUTABLE_TOOL_POLICY_LIST.map((item) => [item.name, item]));
export function getMutableToolPolicy(name) {
    return MUTABLE_TOOL_POLICY_MAP.get(name) || null;
}
const SCOPE_LABELS = {
    enterprise: "企业级",
    team: "团队级",
    app: "应用级",
    component: "组件级",
    workflow: "流程级",
};
const RISK_LABELS = {
    low: "提示",
    medium: "警告",
    high: "危险",
};
export function getApprovalScopeLabel(scope) {
    if (!scope) {
        return "";
    }
    return SCOPE_LABELS[scope] || "";
}
export function getApprovalRiskLabel(risk) {
    if (!risk) {
        return "";
    }
    return RISK_LABELS[risk] || "";
}
function readString(...values) {
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
function buildTemplateValues(toolName, input) {
    return {
        tool: toolName,
        app: readString(input.app_name, input.group_name, input.app_id) || "目标应用",
        component: readString(input.service_cname, input.component_name, input.service_alias, input.service_id) || "目标组件",
        region: readString(input.region_name, input.region_id) || "目标集群",
        market: readString(input.market_name, input.app_model_id) || "目标模板",
        action: readString(input.action, input.operation) || "目标操作",
    };
}
function buildSpecialApprovalMessage(toolName, input) {
    const regionName = readString(input.region_alias, input.region_name, input.name);
    const regionIdentifier = readString(input.region_id);
    const regionDisplay = regionName || "";
    const description = readString(input.desc, input.description);
    if (toolName === "rainbond_update_region" && description) {
        return regionDisplay
            ? `将集群 ${regionDisplay} 的简介修改为 ${description}`
            : `将集群简介修改为 ${description}`;
    }
    if (toolName === "rainbond_delete_region") {
        return regionDisplay
            ? `删除集群 ${regionDisplay}，该操作可能不可逆`
            : regionIdentifier
                ? `删除集群 ${regionIdentifier}，该操作可能不可逆`
                : "";
    }
    if (toolName === "rainbond_create_region" && regionDisplay) {
        return `创建集群 ${regionDisplay}`;
    }
    return "";
}
function interpolateApprovalMessage(template, values) {
    return template.replace(/\{([a-z_]+)\}/g, (_matched, key) => {
        return values[key] || "";
    });
}
export function renderMutableToolApprovalMessage(toolName, input) {
    const policy = getMutableToolPolicy(toolName);
    if (!policy) {
        return `执行 ${toolName}`;
    }
    const specialMessage = buildSpecialApprovalMessage(toolName, input);
    if (specialMessage) {
        return specialMessage;
    }
    return interpolateApprovalMessage(policy.approvalMessage, buildTemplateValues(toolName, input));
}
export function evaluateMutableToolApproval(toolName, input) {
    const policy = getMutableToolPolicy(toolName);
    if (!policy) {
        return {
            requiresApproval: true,
            risk: "high",
            reason: `执行 ${toolName}`,
            riskLabel: getApprovalRiskLabel("high"),
        };
    }
    const operation = typeof input.operation === "string" ? input.operation.trim() : "";
    const lowRiskSummaryOperationMap = {
        rainbond_manage_component_envs: ["summary"],
        rainbond_manage_component_connection_envs: ["summary"],
        rainbond_manage_component_dependency: ["summary"],
        rainbond_manage_component_ports: ["summary"],
        rainbond_manage_component_storage: ["summary", "list_unmounted"],
        rainbond_manage_component_autoscaler: ["summary", "get_rule", "records"],
        rainbond_manage_component_probe: ["summary", "get"],
    };
    if (operation &&
        lowRiskSummaryOperationMap[toolName] &&
        lowRiskSummaryOperationMap[toolName].includes(operation)) {
        return {
            requiresApproval: false,
            risk: "low",
            reason: renderMutableToolApprovalMessage(toolName, input),
            scope: policy.scope,
            scopeLabel: getApprovalScopeLabel(policy.scope),
            riskLabel: getApprovalRiskLabel("low"),
        };
    }
    return {
        requiresApproval: !policy.allowDirectExecution,
        risk: policy.riskLevel,
        reason: renderMutableToolApprovalMessage(toolName, input),
        scope: policy.scope,
        scopeLabel: getApprovalScopeLabel(policy.scope),
        riskLabel: getApprovalRiskLabel(policy.riskLevel),
    };
}
