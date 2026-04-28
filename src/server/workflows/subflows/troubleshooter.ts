export function selectTroubleshooterSubflow() {
  return {
    selectedWorkflow: "rainbond-fullstack-troubleshooter" as const,
    nextAction: "inspect_runtime" as const,
    summary: "已识别为修复/恢复诉求，下一步进入运行态诊断与低风险修复流程。",
  };
}
