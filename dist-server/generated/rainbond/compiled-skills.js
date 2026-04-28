export const compiledRainbondSkills = [
    {
        "id": "rainbond-app-version-assistant",
        "name": "rainbond-app-version-assistant",
        "description": "Use when working in the Rainbond app version center flow under `/team/.../apps/:appID/version`, especially to create snapshots, publish to the local library or cloud market, inspect publish drafts and events, or rollback app runtime to a snapshot.",
        "mode": "embedded",
        "sourcePath": "/Users/guox/Desktop/agent/agent/skills-src/rainbond/rainbond-app-version-assistant/SKILL.md",
        "workflow": {
            "id": "rainbond-app-version-assistant",
            "entry": {
                "intents": [
                    "快照",
                    "发布",
                    "回滚",
                    "version center"
                ]
            },
            "input_schema": {
                "properties": {
                    "version": {
                        "type": "string"
                    },
                    "version_alias": {
                        "type": "string"
                    },
                    "app_version_info": {
                        "type": "string"
                    },
                    "snapshot_mode": {
                        "type": "boolean"
                    },
                    "snapshot_version": {
                        "type": "string"
                    },
                    "version_id": {
                        "type": "integer"
                    },
                    "scope": {
                        "type": "string",
                        "enum": [
                            "local",
                            "goodrain"
                        ]
                    },
                    "market_name": {
                        "type": "string"
                    },
                    "preferred_app_id": {
                        "type": "string"
                    },
                    "preferred_version": {
                        "type": "string"
                    }
                }
            },
            "required_context": [
                "team_name",
                "region_name",
                "app_id"
            ],
            "stages": [
                {
                    "id": "resolve-scope",
                    "kind": "resolve_context"
                },
                {
                    "id": "inspect-version-center",
                    "kind": "tool_call",
                    "tool": "rainbond_get_app_version_overview",
                    "args": {
                        "team_name": "$context.team_name",
                        "region_name": "$context.region_name",
                        "app_id": "$context.app_id"
                    }
                },
                {
                    "id": "list-snapshots",
                    "kind": "tool_call",
                    "tool": "rainbond_list_app_version_snapshots",
                    "args": {
                        "team_name": "$context.team_name",
                        "region_name": "$context.region_name",
                        "app_id": "$context.app_id"
                    }
                },
                {
                    "id": "execute-version-action",
                    "kind": "branch",
                    "branches": [
                        {
                            "id": "inspect-snapshot-detail",
                            "tool": "rainbond_get_app_version_snapshot_detail",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "version_id": "$input.version_id"
                            }
                        },
                        {
                            "id": "create-snapshot",
                            "tool": "rainbond_create_app_version_snapshot",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "version": "$input.version",
                                "version_alias": "$input.version_alias",
                                "app_version_info": "$input.app_version_info"
                            }
                        },
                        {
                            "id": "create-snapshot-draft",
                            "tool": "rainbond_create_app_share_record",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "snapshot_mode": "$input.snapshot_mode",
                                "snapshot_version": "$input.snapshot_version"
                            }
                        },
                        {
                            "id": "inspect-publish-candidates",
                            "tool": "rainbond_get_app_publish_candidates",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "scope": "$input.scope",
                                "market_name": "$input.market_name",
                                "preferred_app_id": "$input.preferred_app_id",
                                "preferred_version": "$input.preferred_version"
                            }
                        },
                        {
                            "id": "rollback-to-snapshot",
                            "tool": "rainbond_rollback_app_version_snapshot",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "version_id": "$input.version_id"
                            }
                        }
                    ]
                },
                {
                    "id": "report",
                    "kind": "summarize"
                }
            ]
        },
        "toolPolicy": {
            "preferred_tools": [
                "rainbond_get_app_version_overview",
                "rainbond_list_app_version_snapshots",
                "rainbond_get_app_version_snapshot_detail",
                "rainbond_create_app_version_snapshot",
                "rainbond_create_app_share_record",
                "rainbond_get_app_publish_candidates",
                "rainbond_rollback_app_version_snapshot"
            ],
            "approval": {
                "mutable_tools_require_scope_verification": true
            }
        },
        "outputContract": {
            "top_level_object": "AppVersionAssistantResult"
        }
    },
    {
        "id": "rainbond-delivery-verifier",
        "name": "rainbond-delivery-verifier",
        "description": "Use only when the next step is already known to be final delivery verification for an existing Rainbond app. Do not use as the first or default response to a generic current-project deployment request; route those to rainbond-app-assistant.",
        "mode": "embedded",
        "sourcePath": "/Users/guox/Desktop/agent/agent/skills-src/rainbond/rainbond-delivery-verifier/SKILL.md",
        "workflow": {
            "id": "rainbond-delivery-verifier",
            "entry": {
                "intents": [
                    "交付",
                    "验收",
                    "verify delivery",
                    "访问地址"
                ]
            },
            "required_context": [
                "team_name",
                "region_name",
                "app_id"
            ],
            "stages": [
                {
                    "id": "resolve-scope",
                    "kind": "resolve_context"
                },
                {
                    "id": "inspect-app",
                    "kind": "tool_call",
                    "tool": "rainbond_get_app_detail",
                    "args": {
                        "team_name": "$context.team_name",
                        "region_name": "$context.region_name",
                        "app_id": "$context.app_id"
                    }
                },
                {
                    "id": "inspect-components",
                    "kind": "tool_call",
                    "tool": "rainbond_query_components",
                    "args": {
                        "enterprise_id": "$actor.enterprise_id",
                        "app_id": "$context.app_id"
                    }
                },
                {
                    "id": "report",
                    "kind": "summarize"
                }
            ]
        },
        "toolPolicy": {
            "preferred_tools": [
                "rainbond_get_app_detail",
                "rainbond_query_components",
                "rainbond_get_component_summary"
            ],
            "approval": {
                "mutable_tools_require_scope_verification": true
            }
        },
        "outputContract": {
            "schema_ref": "./schemas/delivery-verification-result.schema.yaml",
            "top_level_object": "DeliveryVerificationResult"
        }
    },
    {
        "id": "rainbond-fullstack-troubleshooter",
        "name": "rainbond-fullstack-troubleshooter",
        "description": "Use only when the current task is already known to be runtime or build troubleshooting for an existing Rainbond app. Do not use as the first or default response to a generic current-project deployment request; route those to rainbond-app-assistant.",
        "mode": "embedded",
        "sourcePath": "/Users/guox/Desktop/agent/agent/skills-src/rainbond/rainbond-fullstack-troubleshooter/SKILL.md",
        "workflow": {
            "id": "rainbond-fullstack-troubleshooter",
            "entry": {
                "intents": [
                    "排障",
                    "排查",
                    "修复",
                    "恢复服务",
                    "构建失败",
                    "启动异常",
                    "troubleshoot",
                    "debug"
                ]
            },
            "input_schema": {
                "properties": {
                    "service_id": {
                        "type": "string"
                    },
                    "inspection_mode": {
                        "type": "string",
                        "enum": [
                            "summary",
                            "events",
                            "pods",
                            "pod_detail",
                            "logs",
                            "build_logs",
                            "envs",
                            "connection_envs",
                            "dependency",
                            "probe"
                        ]
                    },
                    "pod_name": {
                        "type": "string"
                    },
                    "event_id": {
                        "type": "string"
                    },
                    "action": {
                        "type": "string",
                        "enum": [
                            "service",
                            "container"
                        ]
                    },
                    "lines": {
                        "type": "integer"
                    },
                    "container_name": {
                        "type": "string"
                    },
                    "follow": {
                        "type": "boolean"
                    },
                    "envs": {
                        "type": "array"
                    },
                    "build_env_dict": {
                        "type": "object"
                    },
                    "dep_service_id": {
                        "type": "string"
                    },
                    "open_inner": {
                        "type": "boolean"
                    },
                    "container_port": {
                        "type": "integer"
                    },
                    "attr_name": {
                        "type": "string"
                    },
                    "attr_value": {
                        "type": "string"
                    },
                    "probe_id": {
                        "type": "string"
                    },
                    "mode": {
                        "type": "string",
                        "enum": [
                            "readiness",
                            "liveness",
                            "ignore"
                        ]
                    },
                    "port": {
                        "type": "integer"
                    },
                    "path": {
                        "type": "string"
                    },
                    "cmd": {
                        "type": "string"
                    }
                }
            },
            "required_context": [
                "team_name",
                "region_name",
                "app_id"
            ],
            "stages": [
                {
                    "id": "resolve-scope",
                    "kind": "resolve_context"
                },
                {
                    "id": "inspect-app",
                    "kind": "tool_call",
                    "tool": "rainbond_get_app_detail",
                    "args": {
                        "team_name": "$context.team_name",
                        "region_name": "$context.region_name",
                        "app_id": "$context.app_id"
                    }
                },
                {
                    "id": "inspect-components",
                    "kind": "tool_call",
                    "tool": "rainbond_query_components",
                    "args": {
                        "enterprise_id": "$actor.enterprise_id",
                        "app_id": "$context.app_id",
                        "page": 1,
                        "page_size": 20
                    }
                },
                {
                    "id": "inspect-runtime",
                    "kind": "branch",
                    "branches": [
                        {
                            "id": "inspect-component-summary",
                            "tool": "rainbond_get_component_summary",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id"
                            }
                        },
                        {
                            "id": "inspect-component-pods",
                            "tool": "rainbond_get_component_pods",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id"
                            }
                        },
                        {
                            "id": "inspect-pod-detail",
                            "tool": "rainbond_get_pod_detail",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "pod_name": "$input.pod_name"
                            }
                        },
                        {
                            "id": "inspect-component-events",
                            "tool": "rainbond_get_component_events",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "page": 1,
                                "page_size": 20
                            }
                        },
                        {
                            "id": "inspect-component-logs",
                            "tool": "rainbond_get_component_logs",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "action": "$input.action",
                                "lines": "$input.lines",
                                "pod_name": "$input.pod_name",
                                "container_name": "$input.container_name",
                                "follow": "$input.follow"
                            }
                        },
                        {
                            "id": "inspect-component-build-logs",
                            "tool": "rainbond_get_component_build_logs",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "event_id": "$input.event_id"
                            }
                        },
                        {
                            "id": "inspect-runtime-envs",
                            "tool": "rainbond_manage_component_envs",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "operation": "summary"
                            }
                        },
                        {
                            "id": "inspect-connection-envs",
                            "tool": "rainbond_manage_component_connection_envs",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "operation": "summary"
                            }
                        },
                        {
                            "id": "inspect-dependencies",
                            "tool": "rainbond_manage_component_dependency",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "operation": "summary"
                            }
                        },
                        {
                            "id": "inspect-probes",
                            "tool": "rainbond_manage_component_probe",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "operation": "summary"
                            }
                        }
                    ]
                },
                {
                    "id": "classify-and-repair",
                    "kind": "branch",
                    "branches": [
                        {
                            "id": "replace-build-envs",
                            "tool": "rainbond_manage_component_envs",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "operation": "replace_build_envs",
                                "build_env_dict": "$input.build_env_dict"
                            }
                        },
                        {
                            "id": "upsert-runtime-envs",
                            "tool": "rainbond_manage_component_envs",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "operation": "upsert",
                                "envs": "$input.envs"
                            }
                        },
                        {
                            "id": "create-connection-env",
                            "tool": "rainbond_manage_component_connection_envs",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "operation": "create",
                                "attr_name": "$input.attr_name",
                                "attr_value": "$input.attr_value"
                            }
                        },
                        {
                            "id": "add-dependency",
                            "tool": "rainbond_manage_component_dependency",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "operation": "add",
                                "dep_service_id": "$input.dep_service_id",
                                "open_inner": "$input.open_inner",
                                "container_port": "$input.container_port"
                            }
                        },
                        {
                            "id": "update-probe",
                            "tool": "rainbond_manage_component_probe",
                            "args": {
                                "team_name": "$context.team_name",
                                "region_name": "$context.region_name",
                                "app_id": "$context.app_id",
                                "service_id": "$input.service_id",
                                "operation": "update",
                                "probe_id": "$input.probe_id",
                                "mode": "$input.mode",
                                "port": "$input.port",
                                "path": "$input.path",
                                "cmd": "$input.cmd"
                            }
                        }
                    ]
                },
                {
                    "id": "report",
                    "kind": "summarize"
                }
            ]
        },
        "toolPolicy": {
            "preferred_tools": [
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
            "approval": {
                "mutable_tools_require_scope_verification": true
            }
        },
        "outputContract": {
            "schema_ref": "./schemas/troubleshoot-result.schema.yaml",
            "top_level_object": "TroubleshootResult"
        }
    },
    {
        "id": "rainbond-template-installer",
        "name": "rainbond-template-installer",
        "description": "Use when installing a local or cloud Rainbond app template into an existing or newly created target app through the current Rainbond MCP template-install workflow.",
        "mode": "embedded",
        "sourcePath": "/Users/guox/Desktop/agent/agent/skills-src/rainbond/rainbond-template-installer/SKILL.md",
        "workflow": {
            "id": "rainbond-template-installer",
            "entry": {
                "intents": [
                    "模板安装",
                    "云市场安装",
                    "本地模板安装",
                    "install template"
                ]
            },
            "input_schema": {
                "required": [
                    "source",
                    "app_model_id",
                    "app_model_version"
                ],
                "properties": {
                    "source": {
                        "type": "string",
                        "enum": [
                            "local",
                            "cloud"
                        ]
                    },
                    "market_name": {
                        "type": "string"
                    },
                    "app_model_id": {
                        "type": "string"
                    },
                    "app_model_version": {
                        "type": "string"
                    },
                    "template_query": {
                        "type": "string"
                    },
                    "is_deploy": {
                        "type": "boolean"
                    }
                }
            },
            "required_context": [
                "team_name",
                "region_name",
                "app_id"
            ],
            "stages": [
                {
                    "id": "resolve-scope",
                    "kind": "resolve_context"
                },
                {
                    "id": "discover-template",
                    "kind": "branch",
                    "branches": [
                        {
                            "id": "discover-local-templates",
                            "tool": "rainbond_query_local_app_models",
                            "args": {
                                "enterprise_id": "$actor.enterprise_id",
                                "page": 1,
                                "page_size": 20,
                                "query": "$input.template_query"
                            }
                        },
                        {
                            "id": "discover-cloud-markets",
                            "tool": "rainbond_query_cloud_markets",
                            "args": {
                                "enterprise_id": "$actor.enterprise_id",
                                "extend": true
                            }
                        },
                        {
                            "id": "discover-cloud-templates",
                            "tool": "rainbond_query_cloud_app_models",
                            "args": {
                                "enterprise_id": "$actor.enterprise_id",
                                "market_name": "$input.market_name",
                                "page": 1,
                                "page_size": 20,
                                "query": "$input.template_query"
                            }
                        }
                    ]
                },
                {
                    "id": "resolve-version",
                    "kind": "tool_call",
                    "tool": "rainbond_query_app_model_versions",
                    "args": {
                        "enterprise_id": "$actor.enterprise_id",
                        "app_model_id": "$input.app_model_id",
                        "source": "$input.source",
                        "market_name": "$input.market_name",
                        "page": 1,
                        "page_size": 20
                    }
                },
                {
                    "id": "install",
                    "kind": "tool_call",
                    "tool": "rainbond_install_app_model",
                    "args": {
                        "team_name": "$context.team_name",
                        "region_name": "$context.region_name",
                        "app_id": "$context.app_id",
                        "source": "$input.source",
                        "market_name": "$input.market_name",
                        "app_model_id": "$input.app_model_id",
                        "app_model_version": "$input.app_model_version",
                        "is_deploy": "$input.is_deploy"
                    }
                },
                {
                    "id": "report",
                    "kind": "summarize"
                }
            ]
        },
        "toolPolicy": {
            "preferred_tools": [
                "rainbond_query_cloud_markets",
                "rainbond_query_local_app_models",
                "rainbond_query_cloud_app_models",
                "rainbond_query_app_model_versions",
                "rainbond_install_app_model"
            ],
            "approval": {
                "mutable_tools_require_scope_verification": true
            }
        },
        "outputContract": {
            "top_level_object": "TemplateInstallResult"
        }
    }
];
