function extractComponentName(actionResult) {
    return (actionResult?.service?.component_name ||
        actionResult?.service?.service_cname ||
        actionResult?.service?.service_alias ||
        actionResult?.service_cname ||
        actionResult?.component_name ||
        actionResult?.service_alias);
}
function extractAppName(actionResult) {
    return (actionResult?.app?.app_name ||
        actionResult?.app?.group_name ||
        actionResult?.app?.app_id ||
        actionResult?.group_name ||
        actionResult?.app_name ||
        actionResult?.app_alias ||
        actionResult?.app_id);
}
function extractPrimaryName(actionResult) {
    return (extractComponentName(actionResult) ||
        extractAppName(actionResult) ||
        actionResult?.region_name ||
        actionResult?.name);
}
function extractLogLines(actionResult) {
    if (Array.isArray(actionResult?.logs)) {
        return actionResult.logs.filter((item) => typeof item === "string");
    }
    if (typeof actionResult?.logs === "string") {
        return actionResult.logs
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
    }
    if (Array.isArray(actionResult?.content)) {
        return actionResult.content
            .map((item) => (typeof item?.text === "string" ? item.text : ""))
            .filter(Boolean);
    }
    return [];
}
export function buildPendingWorkflowActionCompletion(pendingAction, output) {
    const actionResult = (output.structuredContent || {});
    const toolStatus = output.isError ? "error" : "success";
    const subflowData = {};
    let summary = `已执行动作 ${pendingAction.toolName}。`;
    switch (pendingAction.toolName) {
        case "restart-component": {
            const componentName = extractPrimaryName(actionResult);
            const status = actionResult?.status || "running";
            summary = componentName
                ? `${componentName} 已完成重启，当前状态为 ${status}。`
                : `组件已完成重启，当前状态为 ${status}。`;
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        case "scale-component-memory": {
            const componentName = extractPrimaryName(actionResult);
            const memory = typeof actionResult?.memory === "number"
                ? `${actionResult.memory}MB`
                : typeof pendingAction.arguments.memory === "number"
                    ? `${pendingAction.arguments.memory}MB`
                    : "目标值";
            summary = componentName
                ? `${componentName} 的内存已调整为 ${memory}。`
                : `组件内存已调整为 ${memory}。`;
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        case "rainbond_create_app_version_snapshot": {
            const snapshotVersion = actionResult?.snapshot?.version;
            if (snapshotVersion) {
                summary = `已创建应用快照 ${snapshotVersion}，可以继续执行发布或回滚。`;
                subflowData.snapshotVersion = snapshotVersion;
            }
            break;
        }
        case "rainbond_install_app_model": {
            const installedAppName = actionResult?.installed_app_name || actionResult?.app_name;
            const installedServiceCount = Array.isArray(actionResult?.service_list)
                ? actionResult.service_list.length
                : undefined;
            if (installedAppName) {
                summary = `已完成模板安装，目标应用 ${installedAppName} 已进入后续部署流程。`;
                subflowData.installedAppName = installedAppName;
            }
            if (installedServiceCount !== undefined) {
                subflowData.installedServiceCount = installedServiceCount;
            }
            break;
        }
        case "rainbond_get_component_logs": {
            const componentName = extractComponentName(actionResult);
            const logLines = extractLogLines(actionResult);
            const requestedLines = typeof pendingAction.arguments.lines === "number"
                ? pendingAction.arguments.lines
                : undefined;
            summary = componentName
                ? `已获取组件 ${componentName} 的最近日志，可以继续分析异常原因。`
                : "已获取组件最近日志，可以继续分析异常原因。";
            if (componentName) {
                subflowData.componentName = componentName;
            }
            subflowData.logLineCount = logLines.length || requestedLines || 0;
            break;
        }
        case "rainbond_get_component_detail": {
            const componentName = extractComponentName(actionResult);
            summary = componentName
                ? `已获取组件 ${componentName} 的详情，可以继续确认交付结果和访问配置。`
                : "已获取组件详情，可以继续确认交付结果和访问配置。";
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        case "rainbond_delete_component": {
            const componentName = extractPrimaryName(actionResult);
            summary = componentName
                ? `已删除组件 ${componentName}。`
                : "已删除目标组件。";
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        case "rainbond_delete_app": {
            const appName = extractAppName(actionResult);
            summary = appName ? `已删除应用 ${appName}。` : "已删除目标应用。";
            if (appName) {
                subflowData.appName = appName;
            }
            break;
        }
        case "rainbond_create_app": {
            const appName = extractAppName(actionResult);
            summary = appName ? `已创建应用 ${appName}。` : "已创建新应用。";
            if (appName) {
                subflowData.appName = appName;
            }
            break;
        }
        case "rainbond_operate_app": {
            const action = actionResult?.action ||
                pendingAction.arguments.action ||
                pendingAction.arguments.operation ||
                "目标";
            const serviceIds = Array.isArray(pendingAction.arguments.service_ids)
                ? pendingAction.arguments.service_ids.filter((item) => typeof item === "string" && !!item)
                : [];
            const appId = typeof pendingAction.arguments.app_id === "number"
                ? pendingAction.arguments.app_id
                : typeof pendingAction.arguments.app_id === "string"
                    ? pendingAction.arguments.app_id
                    : undefined;
            if (serviceIds.length === 1) {
                const targetServiceId = serviceIds[0];
                if (action === "stop") {
                    summary = `已执行组件 ${targetServiceId} 的关闭操作。`;
                }
                else if (action === "start") {
                    summary = `已执行组件 ${targetServiceId} 的启动操作。`;
                }
                else if (action === "restart") {
                    summary = `已执行组件 ${targetServiceId} 的重启操作。`;
                }
                else {
                    summary = `已执行组件 ${targetServiceId} 的 ${String(action)} 操作。`;
                }
                subflowData.componentName = targetServiceId;
            }
            else if (appId) {
                if (action === "stop") {
                    summary = `已执行应用 ${String(appId)} 的关闭操作。`;
                }
                else if (action === "start") {
                    summary = `已执行应用 ${String(appId)} 的启动操作。`;
                }
                else if (action === "restart") {
                    summary = `已执行应用 ${String(appId)} 的重启操作。`;
                }
                else {
                    summary = `已执行应用 ${String(appId)} 的 ${String(action)} 操作。`;
                }
                subflowData.appId = appId;
            }
            else {
                summary = `已提交应用操作 ${String(action)}。`;
            }
            break;
        }
        case "rainbond_change_component_image": {
            const componentName = extractPrimaryName(actionResult);
            const image = actionResult?.image || pendingAction.arguments.image || "目标镜像";
            summary = componentName
                ? `已将组件 ${componentName} 的镜像更新为 ${String(image)}。`
                : `已更新组件镜像为 ${String(image)}。`;
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        case "rainbond_manage_component_envs": {
            const componentName = extractPrimaryName(actionResult) ||
                (typeof pendingAction.arguments.service_id === "string"
                    ? pendingAction.arguments.service_id
                    : undefined);
            const operation = typeof pendingAction.arguments.operation === "string"
                ? pendingAction.arguments.operation
                : "";
            if (operation === "summary") {
                summary = componentName
                    ? `已获取组件 ${componentName} 的环境变量概况。`
                    : "已获取组件环境变量概况。";
            }
            else if (operation === "upsert" &&
                Array.isArray(pendingAction.arguments.envs) &&
                pendingAction.arguments.envs.length > 0) {
                const envNames = pendingAction.arguments.envs
                    .map((item) => item && typeof item === "object" && typeof item.name === "string"
                    ? item.name
                    : "")
                    .filter(Boolean);
                const envLabel = envNames.join("、");
                summary = componentName
                    ? `已为组件 ${componentName} 更新环境变量 ${envLabel}。`
                    : `已更新环境变量 ${envLabel}。`;
            }
            else {
                summary = componentName
                    ? `已更新组件 ${componentName} 的环境变量配置。`
                    : "已更新组件环境变量配置。";
            }
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        case "rainbond_manage_component_connection_envs": {
            const componentName = extractPrimaryName(actionResult) ||
                (typeof pendingAction.arguments.service_id === "string"
                    ? pendingAction.arguments.service_id
                    : undefined);
            const attrName = typeof pendingAction.arguments.attr_name === "string"
                ? pendingAction.arguments.attr_name
                : "";
            const operation = typeof pendingAction.arguments.operation === "string"
                ? pendingAction.arguments.operation
                : "";
            if (operation === "summary") {
                summary = componentName
                    ? `已获取组件 ${componentName} 的连接信息概况。`
                    : "已获取组件连接信息概况。";
            }
            else if (operation === "create" && attrName) {
                summary = componentName
                    ? `已为组件 ${componentName} 添加连接信息 ${attrName}。`
                    : `已添加连接信息 ${attrName}。`;
            }
            else {
                summary = componentName
                    ? `已更新组件 ${componentName} 的连接信息配置。`
                    : "已更新组件连接信息配置。";
            }
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        case "rainbond_manage_component_ports": {
            const componentName = extractPrimaryName(actionResult) ||
                (typeof pendingAction.arguments.service_id === "string"
                    ? pendingAction.arguments.service_id
                    : undefined);
            const operation = typeof pendingAction.arguments.operation === "string"
                ? pendingAction.arguments.operation
                : "";
            const port = typeof pendingAction.arguments.port === "number"
                ? pendingAction.arguments.port
                : "";
            if (operation === "summary") {
                summary = componentName
                    ? `已获取组件 ${componentName} 的端口概况。`
                    : "已获取组件端口概况。";
            }
            else if (operation && port) {
                summary = componentName
                    ? `已对组件 ${componentName} 的端口 ${port} 执行 ${operation} 操作。`
                    : `已对端口 ${port} 执行 ${operation} 操作。`;
            }
            else {
                summary = componentName
                    ? `已更新组件 ${componentName} 的端口配置。`
                    : "已更新组件端口配置。";
            }
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        case "rainbond_manage_component_storage": {
            const componentName = extractPrimaryName(actionResult) ||
                (typeof pendingAction.arguments.service_id === "string"
                    ? pendingAction.arguments.service_id
                    : undefined);
            const operation = typeof pendingAction.arguments.operation === "string"
                ? pendingAction.arguments.operation
                : "";
            if (operation === "summary" || operation === "list_unmounted") {
                summary = componentName
                    ? `已获取组件 ${componentName} 的存储概况。`
                    : "已获取组件存储概况。";
            }
            else {
                summary = componentName
                    ? `已更新组件 ${componentName} 的存储配置。`
                    : "已更新组件存储配置。";
            }
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        case "rainbond_manage_component_probe": {
            const componentName = extractPrimaryName(actionResult) ||
                (typeof pendingAction.arguments.service_id === "string"
                    ? pendingAction.arguments.service_id
                    : undefined);
            const operation = typeof pendingAction.arguments.operation === "string"
                ? pendingAction.arguments.operation
                : "";
            if (operation === "summary" || operation === "get") {
                summary = componentName
                    ? `已获取组件 ${componentName} 的探针概况。`
                    : "已获取组件探针概况。";
            }
            else {
                summary = componentName
                    ? `已更新组件 ${componentName} 的探针配置。`
                    : "已更新组件探针配置。";
            }
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        case "rainbond_manage_component_autoscaler": {
            const componentName = extractPrimaryName(actionResult) ||
                (typeof pendingAction.arguments.service_id === "string"
                    ? pendingAction.arguments.service_id
                    : undefined);
            const operation = typeof pendingAction.arguments.operation === "string"
                ? pendingAction.arguments.operation
                : "";
            if (operation === "summary" || operation === "get_rule" || operation === "records") {
                summary = componentName
                    ? `已获取组件 ${componentName} 的自动伸缩概况。`
                    : "已获取组件自动伸缩概况。";
            }
            else {
                summary = componentName
                    ? `已更新组件 ${componentName} 的自动伸缩配置。`
                    : "已更新组件自动伸缩配置。";
            }
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        case "rainbond_check_helm_app": {
            const name = (typeof actionResult?.name === "string" && actionResult.name) ||
                (typeof pendingAction.arguments.name === "string"
                    ? pendingAction.arguments.name
                    : "目标 Helm Chart");
            summary = `已完成 Helm Chart ${name} 的参数校验，可以继续生成模板。`;
            subflowData.componentName = name;
            break;
        }
        case "rainbond_vertical_scale_component":
        case "rainbond_horizontal_scale_component": {
            const componentName = extractPrimaryName(actionResult);
            const newMemory = typeof actionResult?.new_memory === "number"
                ? `${actionResult.new_memory}MB`
                : typeof pendingAction.arguments.new_memory === "number"
                    ? `${pendingAction.arguments.new_memory}MB`
                    : "";
            if (pendingAction.toolName === "rainbond_vertical_scale_component" && newMemory) {
                summary = componentName
                    ? `已将组件 ${componentName} 的资源配置调整为内存 ${newMemory}。`
                    : `已将组件资源配置调整为内存 ${newMemory}。`;
            }
            else {
                summary = componentName
                    ? `已更新组件 ${componentName} 的伸缩配置。`
                    : "已更新组件伸缩配置。";
            }
            if (componentName) {
                subflowData.componentName = componentName;
            }
            break;
        }
        default:
            if (typeof actionResult?.msg_show === "string" && actionResult.msg_show) {
                summary = actionResult.msg_show;
                break;
            }
            if (typeof actionResult?.message === "string" && actionResult.message) {
                summary = actionResult.message;
                break;
            }
            if (actionResult?.deleted === true) {
                const deletedName = extractPrimaryName(actionResult);
                summary = deletedName ? `已删除 ${deletedName}。` : `已完成 ${pendingAction.toolName} 删除操作。`;
                break;
            }
            if (actionResult?.created === true) {
                const createdName = extractPrimaryName(actionResult);
                summary = createdName ? `已创建 ${createdName}。` : `已完成 ${pendingAction.toolName} 创建操作。`;
                break;
            }
            if (actionResult?.updated === true) {
                const updatedName = extractPrimaryName(actionResult);
                summary = updatedName ? `已更新 ${updatedName}。` : `已完成 ${pendingAction.toolName} 更新操作。`;
                break;
            }
            if (actionResult?.installed === true) {
                const installedName = extractPrimaryName(actionResult);
                summary = installedName ? `已完成 ${installedName} 的安装流程。` : `已完成 ${pendingAction.toolName} 安装操作。`;
                break;
            }
            if (actionResult?.event_id) {
                summary = `已提交 ${pendingAction.toolName}，事件 ID 为 ${String(actionResult.event_id)}。`;
            }
            break;
    }
    if (output.isError) {
        summary = `执行 ${pendingAction.toolName} 失败，请根据返回结果检查后重试。`;
    }
    return {
        summary,
        workflowStage: output.isError ? "failed" : "executed",
        nextAction: output.isError ? "review_error" : "none",
        structuredResult: {
            summary,
            tool_calls: [{ name: pendingAction.toolName, status: toolStatus }],
            subflowData,
            executedAction: pendingAction,
            actionResult,
        },
    };
}
