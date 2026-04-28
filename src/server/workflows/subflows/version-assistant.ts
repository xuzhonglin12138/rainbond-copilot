export function selectVersionAssistantSubflow() {
  return {
    selectedWorkflow: "rainbond-app-version-assistant" as const,
    nextAction: "run_version_flow" as const,
    summary: "已识别为快照/发布/回滚诉求，下一步进入版本中心流程。",
  };
}
