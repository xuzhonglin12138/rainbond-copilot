# Rainbond Agent 高层 MCP 接口清单与 Schema 规格

## 1. 适用范围

本规格用于实现：

- Codex / Claude Code 这类 agent 平台
- 本地工作区项目
- 通过 **Skill + Rainbond MCP** 完成部署、验证、发布、回滚

本规格只定义 **新增的高层 MCP 接口**。  
现有底层 MCP 工具继续保留，但不作为用户主路径。

## 2. 设计原则

### 2.1 职责边界

#### Skill 负责

- 读取本地工作区
- 检测项目类型
- 本地打包 / 本地构建
- 调用上传 URL 上传本地产物
- 保存 workspace binding 和 deployment receipt
- 组织对用户的输出

#### MCP 负责

- 提供团队/应用/环境绑定能力
- 提供部署流程编排原语
- 提供上传会话、部署状态、日志、验证、发布、回滚能力
- 输出结构化结果与下一步建议

### 2.2 为什么不把“本地文件上传”直接塞进 MCP

Rainbond MCP 运行在服务端，通常无法直接读取用户本地工作区文件。  
因此对于本地 artifact，推荐拆成两步：

1. MCP 创建上传会话，返回 `upload_url`
2. Skill 在本地用 `curl` / HTTP client 上传文件

这既符合 agent 平台能力边界，也更容易兼容 Codex / Claude Code。

## 3. 核心对象模型

## 3.1 WorkspaceBinding

```json
{
  "binding_id": "rb_bind_123",
  "workspace_path": "/abs/path/project",
  "team_name": "yirlz5nj",
  "region_name": "rainbond",
  "app_id": 73,
  "app_name": "demo-app",
  "environment": "preview"
}
```

## 3.2 DeployStrategy

```json
{
  "strategy": "package",
  "confidence": 0.92,
  "reason": "workspace contains deployable package artifact",
  "required_local_steps": ["npm run build", "zip dist artifact"],
  "required_remote_steps": ["create_upload_session", "register_package_build", "build_component"]
}
```

## 3.3 UploadSession

```json
{
  "upload_session_id": "rb_upload_123",
  "event_id": "evt_abc",
  "upload_url": "https://upload.example.com/...",
  "upload_field_name": "packageTarFile",
  "expires_at": "2026-03-26T18:00:00+08:00"
}
```

## 3.4 DeploymentReceipt

```json
{
  "deployment_id": "rb_dep_456",
  "binding_id": "rb_bind_123",
  "app_id": 73,
  "service_id": "svc_xxx",
  "strategy": "package",
  "status": "ready",
  "preview_url": "https://preview.example.com",
  "build_event_id": "evt_build",
  "runtime_status": "running",
  "created_at": "2026-03-26T18:00:00+08:00"
}
```

## 3.5 FailureExplanation

```json
{
  "failure_type": "insufficient_cpu",
  "summary": "Deployment could not be scheduled due to insufficient CPU.",
  "root_cause": "cluster capacity is lower than requested 500m CPU",
  "suggested_actions": [
    "Reduce CPU request to 100m",
    "Retry deployment",
    "Ask cluster admin to expand capacity"
  ]
}
```

## 4. 新增高层 MCP 接口清单

## 4.1 `rainbond_link_workspace`

### Purpose

将工作区绑定到 Rainbond team / region / app / environment。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "workspace_id": { "type": "string" },
    "workspace_path": { "type": "string" },
    "team_name": { "type": "string" },
    "region_name": { "type": "string" },
    "app_name": { "type": "string" },
    "app_id": { "type": "integer", "minimum": 1 },
    "environment": {
      "type": "string",
      "enum": ["development", "preview", "production", "custom"]
    },
    "custom_environment_name": { "type": "string" },
    "auto_create_app": { "type": "boolean" }
  },
  "required": ["workspace_path", "team_name", "region_name", "environment"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "binding_id": { "type": "string" },
    "workspace_path": { "type": "string" },
    "team_name": { "type": "string" },
    "region_name": { "type": "string" },
    "app_id": { "type": "integer" },
    "app_name": { "type": "string" },
    "environment": { "type": "string" },
    "created_app": { "type": "boolean" }
  },
  "required": ["binding_id", "workspace_path", "team_name", "region_name", "environment"]
}
```

## 4.2 `rainbond_get_workspace_binding`

### Purpose

读取某工作区当前绑定信息。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "workspace_id": { "type": "string" },
    "workspace_path": { "type": "string" }
  }
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "found": { "type": "boolean" },
    "binding": {
      "type": "object",
      "properties": {
        "binding_id": { "type": "string" },
        "workspace_path": { "type": "string" },
        "team_name": { "type": "string" },
        "region_name": { "type": "string" },
        "app_id": { "type": "integer" },
        "app_name": { "type": "string" },
        "environment": { "type": "string" }
      }
    }
  },
  "required": ["found"]
}
```

## 4.3 `rainbond_detect_deploy_strategy`

### Purpose

根据 workspace 元信息判断推荐部署策略。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "workspace_path": { "type": "string" },
    "repo_url": { "type": "string" },
    "branch": { "type": "string" },
    "artifact_type": {
      "type": "string",
      "enum": ["auto", "source", "image", "package", "yaml", "helm"]
    },
    "files": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["workspace_path"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "strategy": {
      "type": "string",
      "enum": ["source", "image", "package", "yaml", "helm"]
    },
    "confidence": { "type": "number" },
    "reason": { "type": "string" },
    "framework": { "type": "string" },
    "runtime": { "type": "string" },
    "required_local_steps": {
      "type": "array",
      "items": { "type": "string" }
    },
    "required_remote_steps": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["strategy", "confidence", "reason"]
}
```

## 4.4 `rainbond_preflight_resources`

### Purpose

部署前检查资源、镜像仓库、端口与域名条件，减少“部署后才失败”。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "team_name": { "type": "string" },
    "region_name": { "type": "string" },
    "app_id": { "type": "integer" },
    "cpu_request_milli": { "type": "integer", "minimum": 0 },
    "memory_request_mb": { "type": "integer", "minimum": 0 },
    "image": { "type": "string" },
    "port": { "type": "integer", "minimum": 1 }
  },
  "required": ["team_name", "region_name"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "ok": { "type": "boolean" },
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "status": { "type": "string", "enum": ["pass", "warn", "fail"] },
          "message": { "type": "string" }
        },
        "required": ["name", "status"]
      }
    },
    "suggested_defaults": {
      "type": "object",
      "properties": {
        "cpu_request_milli": { "type": "integer" },
        "memory_request_mb": { "type": "integer" }
      }
    }
  },
  "required": ["ok", "checks"]
}
```

## 4.5 `rainbond_create_upload_session`

### Purpose

为 package / artifact 上传创建服务端会话，返回 `upload_url` 和字段名。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "team_name": { "type": "string" },
    "region_name": { "type": "string" },
    "artifact_kind": {
      "type": "string",
      "enum": ["package", "yaml", "helm"]
    },
    "component_id": { "type": "string" }
  },
  "required": ["team_name", "region_name", "artifact_kind"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "upload_session_id": { "type": "string" },
    "event_id": { "type": "string" },
    "upload_url": { "type": "string" },
    "upload_field_name": { "type": "string" },
    "status_poll_url": { "type": "string" }
  },
  "required": ["upload_session_id", "event_id", "upload_url", "upload_field_name"]
}
```

## 4.6 `rainbond_get_upload_session`

### Purpose

查询上传会话状态和已识别的包名。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "upload_session_id": { "type": "string" },
    "event_id": { "type": "string" },
    "team_name": { "type": "string" },
    "region_name": { "type": "string" }
  },
  "required": ["event_id", "team_name", "region_name"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": ["unfinished", "uploaded", "detected", "ready", "failed"]
    },
    "package_names": {
      "type": "array",
      "items": { "type": "string" }
    },
    "message": { "type": "string" }
  },
  "required": ["status"]
}
```

## 4.7 `rainbond_deploy_workspace`

### Purpose

高层部署主入口。  
给 Skill 一个“单工具完成部署”的统一原语。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "binding_id": { "type": "string" },
    "workspace_path": { "type": "string" },
    "strategy": {
      "type": "string",
      "enum": ["source", "image", "package", "yaml", "helm", "auto"]
    },
    "repo_url": { "type": "string" },
    "branch": { "type": "string" },
    "image": { "type": "string" },
    "event_id": { "type": "string" },
    "service_cname": { "type": "string" },
    "k8s_component_name": { "type": "string" },
    "environment": { "type": "string" },
    "auto_create_app": { "type": "boolean" },
    "wait_until": {
      "type": "string",
      "enum": ["accepted", "built", "ready"]
    }
  },
  "required": ["binding_id"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "deployment_id": { "type": "string" },
    "binding_id": { "type": "string" },
    "app_id": { "type": "integer" },
    "service_id": { "type": "string" },
    "strategy": { "type": "string" },
    "status": {
      "type": "string",
      "enum": ["accepted", "building", "ready", "failed"]
    },
    "preview_url": { "type": "string" },
    "build_event_id": { "type": "string" },
    "message": { "type": "string" }
  },
  "required": ["deployment_id", "binding_id", "strategy", "status"]
}
```

## 4.8 `rainbond_get_latest_deployment`

### Purpose

返回某 binding / app 的最近一次 deployment。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "binding_id": { "type": "string" },
    "app_id": { "type": "integer" },
    "environment": { "type": "string" }
  }
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "found": { "type": "boolean" },
    "deployment": {
      "type": "object",
      "properties": {
        "deployment_id": { "type": "string" },
        "app_id": { "type": "integer" },
        "service_id": { "type": "string" },
        "status": { "type": "string" },
        "preview_url": { "type": "string" },
        "created_at": { "type": "string" }
      }
    }
  },
  "required": ["found"]
}
```

## 4.9 `rainbond_get_deployment_logs`

### Purpose

统一读取 build logs、event logs、runtime logs。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "deployment_id": { "type": "string" },
    "service_id": { "type": "string" },
    "team_name": { "type": "string" },
    "region_name": { "type": "string" },
    "log_type": {
      "type": "string",
      "enum": ["build", "event", "runtime", "all"]
    },
    "format": {
      "type": "string",
      "enum": ["summary", "raw", "jsonl"]
    },
    "lines": { "type": "integer", "minimum": 1 }
  },
  "required": ["service_id", "team_name", "region_name", "log_type"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "deployment_id": { "type": "string" },
    "log_type": { "type": "string" },
    "entries": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "ts": { "type": "string" },
          "level": { "type": "string" },
          "source": { "type": "string" },
          "message": { "type": "string" }
        },
        "required": ["message"]
      }
    },
    "summary": { "type": "string" }
  },
  "required": ["log_type", "entries"]
}
```

## 4.10 `rainbond_verify_deployment`

### Purpose

对 deployment 做机器可消费的验证。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "deployment_id": { "type": "string" },
    "preview_url": { "type": "string" },
    "checks": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["http_200", "content_match", "header_match", "port_open"]
      }
    },
    "content_contains": { "type": "string" },
    "timeout_seconds": { "type": "integer", "minimum": 1 }
  },
  "required": ["deployment_id"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "deployment_id": { "type": "string" },
    "status": {
      "type": "string",
      "enum": ["healthy", "degraded", "failed"]
    },
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "status": { "type": "string", "enum": ["pass", "fail", "skip"] },
          "message": { "type": "string" }
        },
        "required": ["name", "status"]
      }
    }
  },
  "required": ["deployment_id", "status", "checks"]
}
```

## 4.11 `rainbond_explain_deployment_failure`

### Purpose

将平台错误转成 agent 友好的失败摘要。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "deployment_id": { "type": "string" },
    "service_id": { "type": "string" },
    "team_name": { "type": "string" },
    "region_name": { "type": "string" }
  },
  "required": ["service_id", "team_name", "region_name"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "failure_type": {
      "type": "string",
      "enum": [
        "build_failed",
        "image_pull_failed",
        "insufficient_cpu",
        "insufficient_memory",
        "runtime_crash",
        "config_error",
        "unknown"
      ]
    },
    "summary": { "type": "string" },
    "root_cause": { "type": "string" },
    "suggested_actions": {
      "type": "array",
      "items": { "type": "string" }
    },
    "retryable": { "type": "boolean" }
  },
  "required": ["failure_type", "summary", "suggested_actions", "retryable"]
}
```

## 4.12 `rainbond_promote_deployment`

### Purpose

将 preview deployment 切到 production。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "deployment_id": { "type": "string" },
    "binding_id": { "type": "string" },
    "target_environment": {
      "type": "string",
      "enum": ["production", "custom"]
    },
    "custom_environment_name": { "type": "string" },
    "domain_strategy": {
      "type": "string",
      "enum": ["switch", "keep_preview_only"]
    }
  },
  "required": ["deployment_id", "target_environment"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "deployment_id": { "type": "string" },
    "promoted": { "type": "boolean" },
    "production_url": { "type": "string" },
    "domain_status": { "type": "string" }
  },
  "required": ["deployment_id", "promoted"]
}
```

## 4.13 `rainbond_rollback_deployment`

### Purpose

回滚到历史 deployment。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "deployment_id": { "type": "string" },
    "target_deployment_id": { "type": "string" },
    "binding_id": { "type": "string" }
  },
  "required": ["target_deployment_id"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "rollback_id": { "type": "string" },
    "target_deployment_id": { "type": "string" },
    "status": { "type": "string", "enum": ["accepted", "ready", "failed"] },
    "production_url": { "type": "string" }
  },
  "required": ["rollback_id", "target_deployment_id", "status"]
}
```

## 4.14 `rainbond_manage_project_env`

### Purpose

按 environment 统一管理变量，而不是只按组件维度管理。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "binding_id": { "type": "string" },
    "environment": { "type": "string" },
    "operation": {
      "type": "string",
      "enum": ["list", "set", "delete", "sync"]
    },
    "vars": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    },
    "keys": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["binding_id", "environment", "operation"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "environment": { "type": "string" },
    "operation": { "type": "string" },
    "vars": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    }
  },
  "required": ["environment", "operation"]
}
```

## 4.15 `rainbond_manage_project_domain`

### Purpose

统一管理 preview / production 域名状态。

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "binding_id": { "type": "string" },
    "operation": {
      "type": "string",
      "enum": ["list", "bind", "switch", "inspect"]
    },
    "domain": { "type": "string" },
    "deployment_id": { "type": "string" }
  },
  "required": ["binding_id", "operation"]
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "domains": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "domain": { "type": "string" },
          "environment": { "type": "string" },
          "status": { "type": "string" }
        },
        "required": ["domain", "status"]
      }
    }
  }
}
```

## 5. Skill 侧推荐编排

## 5.1 `rainbond-deploy`

推荐内部编排：

1. `rainbond_get_workspace_binding`
2. 若无 binding，则 `rainbond_link_workspace`
3. `rainbond_detect_deploy_strategy`
4. 若 strategy 为 package：
   - `rainbond_create_upload_session`
   - 本地上传 artifact
   - `rainbond_get_upload_session`
5. `rainbond_deploy_workspace`
6. `rainbond_verify_deployment`

## 5.2 `rainbond-release`

推荐内部编排：

1. `rainbond_get_latest_deployment`
2. `rainbond_verify_deployment`
3. 审批
4. `rainbond_promote_deployment`

## 5.3 `rainbond-deploy-debug`

推荐内部编排：

1. `rainbond_get_latest_deployment`
2. `rainbond_get_deployment_logs`
3. `rainbond_explain_deployment_failure`
4. 必要时调用底层工具进行修复

## 6. 最小落地顺序

### 第一批必须做

- `rainbond_link_workspace`
- `rainbond_get_workspace_binding`
- `rainbond_detect_deploy_strategy`
- `rainbond_create_upload_session`
- `rainbond_get_upload_session`
- `rainbond_deploy_workspace`
- `rainbond_get_latest_deployment`
- `rainbond_get_deployment_logs`
- `rainbond_verify_deployment`
- `rainbond_explain_deployment_failure`

### 第二批再做

- `rainbond_promote_deployment`
- `rainbond_rollback_deployment`
- `rainbond_manage_project_env`
- `rainbond_manage_project_domain`

## 7. 关键实现建议

### 7.1 高层 MCP 一定要自己做 orchestration

不要让 Skill 去拼：

- create app
- create component
- build component
- get summary

这些应该在 MCP 内部整合成少数几个高层工具。

### 7.2 每个高层接口都要返回稳定字段

至少保证：

- `status`
- `message`
- `next_actions`
- `resource_ids`
- `urls`

### 7.3 错误分类要统一

建议统一的 failure_type：

- `image_pull_failed`
- `build_failed`
- `insufficient_cpu`
- `insufficient_memory`
- `port_conflict`
- `domain_not_ready`
- `runtime_crash`
- `unknown`

## 8. 总结

对于“Rainbond MCP + Skill 实现类似 Vercel 的效果”，最关键的不是增加更多零散工具，而是：

1. 补一层 **高层 deployment workflow MCP**
2. 让 Skill 专注于 **用户意图编排**
3. 用 binding / receipt 把工作区上下文稳定下来

如果你按这份接口规格推进，后端、MCP、Skill 三侧就能并行落地。
