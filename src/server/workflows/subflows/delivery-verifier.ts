export function selectDeliveryVerifierSubflow() {
  return {
    selectedWorkflow: "rainbond-delivery-verifier" as const,
    nextAction: "verify_delivery" as const,
    summary: "已识别为交付验收诉求，下一步进入运行态与访问路径验证流程。",
  };
}
