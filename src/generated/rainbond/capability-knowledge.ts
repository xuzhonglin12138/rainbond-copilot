export const generatedEmbeddedWorkflowKnowledge = {
  "rainbond-app-version-assistant": {
    "useWhen": "快照 / 发布 / 回滚 / version center",
    "avoidWhen": "Not provided in the machine-readable contract yet.",
    "preferredTools": [
      "rainbond_get_app_version_overview",
      "rainbond_list_app_version_snapshots",
      "rainbond_get_app_version_snapshot_detail",
      "rainbond_create_app_version_snapshot",
      "rainbond_create_app_share_record",
      "rainbond_get_app_publish_candidates",
      "rainbond_rollback_app_version_snapshot"
    ],
    "scopeHint": "Requires context: team_name, region_name, app_id",
    "vocabulary": []
  },
  "rainbond-delivery-verifier": {
    "useWhen": "交付 / 验收 / verify delivery / 访问地址",
    "avoidWhen": "Not provided in the machine-readable contract yet.",
    "preferredTools": [
      "rainbond_get_app_detail",
      "rainbond_query_components",
      "rainbond_get_component_summary"
    ],
    "scopeHint": "Requires context: team_name, region_name, app_id",
    "vocabulary": []
  },
  "rainbond-fullstack-troubleshooter": {
    "useWhen": "排障 / 排查 / 修复 / 恢复服务 / 构建失败 / 启动异常 / troubleshoot / debug",
    "avoidWhen": "Not provided in the machine-readable contract yet.",
    "preferredTools": [
      "rainbond_get_app_detail",
      "rainbond_query_components",
      "rainbond_get_component_summary",
      "rainbond_get_component_pods",
      "rainbond_get_pod_detail",
      "rainbond_get_component_events",
      "rainbond_get_component_logs",
      "rainbond_get_component_build_logs",
      "rainbond_manage_component_envs",
      "rainbond_manage_component_connection_envs",
      "rainbond_manage_component_dependency",
      "rainbond_manage_component_probe"
    ],
    "scopeHint": "Requires context: team_name, region_name, app_id",
    "vocabulary": []
  },
  "rainbond-template-installer": {
    "useWhen": "模板安装 / 云市场安装 / 本地模板安装 / install template",
    "avoidWhen": "Not provided in the machine-readable contract yet.",
    "preferredTools": [
      "rainbond_query_cloud_markets",
      "rainbond_query_local_app_models",
      "rainbond_query_cloud_app_models",
      "rainbond_query_app_model_versions",
      "rainbond_install_app_model"
    ],
    "scopeHint": "Requires context: team_name, region_name, app_id",
    "vocabulary": []
  }
} as const;
