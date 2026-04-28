export function selectVersionAssistantSubflow() {
    return {
        selectedWorkflow: "rainbond-app-version-assistant",
        nextAction: "run_version_flow",
        summary: "已识别为快照/发布/回滚诉求，下一步进入版本中心流程。",
    };
}
