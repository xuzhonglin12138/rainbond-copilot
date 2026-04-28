function readContextString(sessionContext, ...keys) {
    for (const key of keys) {
        const value = sessionContext[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            return String(value);
        }
    }
    return "";
}
function buildWorkflowHints(input) {
    const page = input.page.toLowerCase();
    const componentSource = input.componentSource.toLowerCase();
    if (page.includes("/version")) {
        return [
            "当前最可能相关的内嵌 Rainbond 流程：rainbond-app-version-assistant。",
            "当前页面位于版本中心，优先处理快照、发布、回滚，并优先考虑快照、发布记录、发布事件相关 MCP 工具。",
            "在这个页面语境下，优先按“快照、发布、回滚”的版本中心语义回答问题。",
        ];
    }
    if (input.componentId) {
        const hints = [
            "当前最可能相关的内嵌 Rainbond 流程：rainbond-fullstack-troubleshooter、rainbond-delivery-verifier。",
            "当前上下文已经聚焦到组件级，优先围绕该组件做运行态诊断、交付确认或针对性配置检查。",
        ];
        if (componentSource === "route") {
            hints.push("当前 component_id 来自 route 语境，可能不是可直接写入 MCP 的 service_id；在把它当成组件 service_id 前先验证。");
        }
        return hints;
    }
    if (input.appId) {
        return [
            "当前最可能相关的内嵌 Rainbond 流程：rainbond-app-assistant、rainbond-fullstack-bootstrap、rainbond-delivery-verifier。",
            "当前上下文已经聚焦到应用级；如果用户谈部署/拉起，优先考虑 bootstrap；如果谈验收/访问地址，优先考虑 delivery verifier。",
        ];
    }
    if (input.hasTeam && input.hasRegion) {
        return [
            "当前最可能相关的内嵌 Rainbond 流程：rainbond-app-assistant。",
            "当前只有团队/集群范围，适合先查询应用列表、确定目标应用或进入模板安装 / 创建应用场景。",
        ];
    }
    return [
        "当前最可能相关的内嵌 Rainbond 流程：rainbond-app-assistant。",
        "当前范围仍偏宽，优先补足团队、集群、应用或组件上下文，再进入具体 Rainbond 流程。",
    ];
}
export function buildSessionContextPromptMessages(sessionContext) {
    if (!sessionContext || Object.keys(sessionContext).length === 0) {
        return [];
    }
    const enterpriseId = readContextString(sessionContext, "enterpriseId", "enterprise_id");
    const teamName = readContextString(sessionContext, "teamName", "team_name");
    const regionName = readContextString(sessionContext, "regionName", "region_name");
    const appId = readContextString(sessionContext, "appId", "app_id");
    const componentId = readContextString(sessionContext, "componentId", "component_id");
    const componentSource = readContextString(sessionContext, "componentSource", "component_source");
    const page = readContextString(sessionContext, "pathname", "page");
    const lines = [
        "## Current Session Context",
        enterpriseId ? `- enterprise_id: ${enterpriseId}` : "",
        teamName ? `- team_name: ${teamName}` : "",
        regionName ? `- region_name: ${regionName}` : "",
        appId ? `- app_id: ${appId}` : "",
        componentId ? `- component_id: ${componentId}` : "",
        componentSource ? `- component_source: ${componentSource}` : "",
        page ? `- page: ${page}` : "",
        "",
        ...buildWorkflowHints({
            page,
            appId,
            componentId,
            componentSource,
            hasTeam: !!teamName,
            hasRegion: !!regionName,
        }),
        "",
        "当 team_name、region_name、app_id、component_id 已经在当前上下文中存在时，优先直接使用这些上下文值。",
        "除非用户明确要求查看团队列表、切换团队或跨团队比较，否则不要为了确认当前团队再次调用 rainbond_query_teams。",
        "除非用户明确要求查看集群列表、切换集群或跨集群比较，否则不要为了确认当前集群再次调用 rainbond_query_regions。",
        "如果上下文已经能唯一定位当前团队、集群、应用或组件，就直接进入对应查询，不要重复向用户索要这些参数。",
    ].filter(Boolean);
    return [
        {
            role: "system",
            content: lines.join("\n"),
        },
    ];
}
