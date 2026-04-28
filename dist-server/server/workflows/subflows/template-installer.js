export function selectTemplateInstallerSubflow() {
    return {
        selectedWorkflow: "rainbond-template-installer",
        nextAction: "install_template",
        summary: "已识别为模板安装诉求，下一步进入模板发现、版本选择和安装流程。",
    };
}
