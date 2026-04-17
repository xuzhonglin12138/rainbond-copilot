# Rainbond Agent 部署 MCP 正式接口文档

## 文档元信息

| 字段 | 值 |
|------|-------|
| 标题 | Rainbond Agent 部署 MCP 正式接口文档 |
| 版本 | 0.1.0 |
| 状态 | Draft |
| 日期 | 2026-03-26 |
| 读者 | Rainbond Console 后端、MCP 实现方、Skill/Agent 集成方 |
| 范围 | 面向 Codex / Claude Code 部署与发布工作流的高层 MCP 工具 |

## 1. 文档目标

本文档定义一组新的高层 Rainbond MCP 接口合同，用于支撑 agent 驱动的部署工作流。

目标是让 Codex、Claude Code 等 agent 平台，在 Rainbond 上获得接近 Vercel 的体验：

- 绑定工作区到部署目标
- 从当前工作区发起部署
- 返回预览地址
- 查看日志与健康状态
- 发布到生产
- 安全回滚

本文档**不替代**现有低层 Rainbond MCP 工具。  
它定义的是位于现有底层能力之上的一层“工作流型 MCP”。

## 2. 设计范围

### 范围内

- 项目绑定
- 部署策略识别
- 上传会话创建
- 部署工作流编排
- 最近部署查询
- 部署日志查询
- 部署验证
- 部署失败解释
- 发布到生产
- 回滚
- 项目级环境变量管理
- 项目级域名管理

### 范围外

- 本地文件打包
- 本地构建执行
- 服务端 MCP 直接访问用户本地工作区文件
- 前端 UI 渲染细节

## 3. 分层职责

### MCP 负责

- 暴露高层 Rainbond 工作流原语
- 将 Rainbond 内部流程归一化成稳定 schema
- 输出结构化 deployment receipt
- 输出归一化失败解释

### Skill 负责

- 检查本地工作区
- 选择本地构建/打包步骤
- 上传本地产物到 `upload_url`
- 在本地保存 workspace binding 和最新 receipt
- 组织面向用户的结果与审批流程

## 4. 传输假设

本规格假设使用 streamable HTTP MCP 传输，但工具定义本身不依赖具体传输形式。

推荐属性：

- 标准 MCP 客户端可稳定建立会话
- 所有工具结果都有结构化输出
- 错误类型有稳定分类

## 5. 通用约定

## 5.1 命名约定

- MCP 工具名称统一使用 `rainbond_*`
- 除非明确声明为整数，所有 ID 一律视为不透明字符串
- 环境统一使用：`development`、`preview`、`production`、`custom`

## 5.2 时间格式

所有时间字段统一使用 RFC 3339 字符串。

示例：

```json
"2026-03-26T18:00:00+08:00"
```

## 5.3 URL 字段

所有 URL 字段必须返回绝对 URL。

## 5.4 部署状态枚举

```json
[
  "accepted",
  "uploading",
  "uploaded",
  "detecting",
  "building",
  "ready",
  "promoted",
  "rolling_back",
  "failed"
]
```

## 5.5 标准结果 Envelope

所有工具都应该返回可被 agent 无损消费的结构化结果。

推荐 MCP 返回形态：

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"status\":\"ready\"}"
    }
  ],
  "structuredContent": {
    "status": "ready"
  },
  "isError": false
}
```

## 6. 通用错误模型

## 6.1 错误结构

当工具失败时，也必须返回 `structuredContent`。

```json
{
  "isError": true,
  "structuredContent": {
    "error_code": "INSUFFICIENT_CPU",
    "error_type": "insufficient_cpu",
    "message": "Deployment could not be scheduled due to insufficient CPU.",
    "retryable": true,
    "suggested_actions": [
      "Reduce CPU request to 100m",
      "Retry deployment",
      "Ask cluster admin to expand capacity"
    ]
  }
}
```

## 6.2 规范错误类型

| error_type | 含义 |
|------|-------|
| `binding_not_found` | 工作区尚未绑定 Rainbond 项目 |
| `project_not_found` | 无法解析 app/project |
| `upload_session_failed` | 上传会话创建失败 |
| `artifact_upload_failed` | 制品上传失败 |
| `build_failed` | 构建失败 |
| `image_pull_failed` | 镜像拉取失败 |
| `insufficient_cpu` | 调度时 CPU 不足 |
| `insufficient_memory` | 调度时内存不足 |
| `runtime_crash` | Pod/容器启动后崩溃 |
| `verify_failed` | 部署验证失败 |
| `promote_failed` | 发布到生产失败 |
| `rollback_failed` | 回滚失败 |
| `unknown` | 未知错误 |

## 7. 核心资源对象

## 7.1 WorkspaceBinding

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

## 7.2 DeployStrategy

```json
{
  "strategy": "package",
  "confidence": 0.92,
  "reason": "workspace contains deployable package artifact",
  "framework": "node-static",
  "runtime": "static",
  "required_local_steps": ["npm run build", "zip artifact"],
  "required_remote_steps": ["create_upload_session", "deploy_workspace"]
}
```

## 7.3 UploadSession

```json
{
  "upload_session_id": "rb_upload_123",
  "event_id": "evt_abc",
  "upload_url": "http://host:6060/package_build/component/events/evt_abc",
  "upload_field_name": "packageTarFile",
  "status_poll_url": "http://host/console/teams/foo/apps/package_build/record?event_id=evt_abc",
  "expires_at": "2026-03-26T18:00:00+08:00"
}
```

## 7.4 DeploymentReceipt

```json
{
  "deployment_id": "rb_dep_456",
  "binding_id": "rb_bind_123",
  "app_id": 73,
  "service_id": "svc_xxx",
  "strategy": "package",
  "status": "ready",
  "preview_url": "http://preview.example.com",
  "build_event_id": "evt_build",
  "runtime_status": "running",
  "created_at": "2026-03-26T18:00:00+08:00"
}
```

## 8. 工具定义

每个工具定义包含：

- 用途
- 请求 schema
- 响应 schema
- 说明

## 8.1 `rainbond_link_workspace`

### 用途

创建或更新本地工作区到 Rainbond 部署目标的绑定关系。

### 请求 Schema

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

### 响应 Schema

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

### 说明

- 若 `app_id` 和 `app_name` 都未提供，则应返回失败
- 若 `auto_create_app=true` 且目标 app 不存在，允许自动创建

## 8.2 `rainbond_get_workspace_binding`

### 用途

读取当前工作区的绑定信息。

### 请求 Schema

```json
{
  "type": "object",
  "properties": {
    "workspace_id": { "type": "string" },
    "workspace_path": { "type": "string" }
  }
}
```

### 响应 Schema

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

## 8.3 `rainbond_detect_deploy_strategy`

### 用途

根据工作区元信息判断推荐部署策略。

### 请求 Schema

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

### 响应 Schema

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

## 8.4 `rainbond_preflight_resources`

### 用途

在部署前检查资源、镜像与端口条件，尽量提前暴露失败。

### 请求 Schema

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

### 响应 Schema

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

## 8.5 `rainbond_create_upload_session`

### 用途

为本地 artifact 创建服务端上传会话。

### 请求 Schema

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

### 响应 Schema

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

## 8.6 `rainbond_get_upload_session`

### 用途

轮询上传会话状态与已识别包名。

### 请求 Schema

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

### 响应 Schema

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

## 8.7 `rainbond_deploy_workspace`

### 用途

基于现有 workspace binding 执行完整部署工作流。

### 请求 Schema

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

### 响应 Schema

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

## 8.8 `rainbond_get_latest_deployment`

### 用途

返回某个 binding 或 app 下最近一次 deployment。

### 请求 Schema

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

### 响应 Schema

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

## 8.9 `rainbond_get_deployment_logs`

### 用途

统一获取 build、event、runtime 三类日志。

### 请求 Schema

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

### 响应 Schema

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

## 8.10 `rainbond_verify_deployment`

### 用途

对 deployment 执行机器可消费的验证动作。

### 请求 Schema

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

### 响应 Schema

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

## 8.11 `rainbond_explain_deployment_failure`

### 用途

将 build/event/runtime 失败转换成统一诊断结果。

### 请求 Schema

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

### 响应 Schema

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

## 8.12 `rainbond_promote_deployment`

### 用途

将通过验证的 preview deployment 发布到 production。

### 请求 Schema

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

### 响应 Schema

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

## 8.13 `rainbond_rollback_deployment`

### 用途

将生产流量回滚到某个历史 deployment。

### 请求 Schema

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

### 响应 Schema

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

## 8.14 `rainbond_manage_project_env`

### 用途

按环境维度统一管理项目变量。

### 请求 Schema

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

### 响应 Schema

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

## 8.15 `rainbond_manage_project_domain`

### 用途

统一管理 preview / production 域名绑定。

### 请求 Schema

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

### 响应 Schema

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

## 9. 推荐 Skill 工作流

## 9.1 Deploy Skill

推荐流程：

1. `rainbond_get_workspace_binding`
2. 若无 binding，则 `rainbond_link_workspace`
3. `rainbond_detect_deploy_strategy`
4. 若需要本地 artifact：
   - `rainbond_create_upload_session`
   - Skill 本地上传
   - `rainbond_get_upload_session`
5. `rainbond_deploy_workspace`
6. `rainbond_verify_deployment`

## 9.2 Release Skill

1. `rainbond_get_latest_deployment`
2. `rainbond_verify_deployment`
3. 审批
4. `rainbond_promote_deployment`

## 9.3 Rollback Skill

1. 选定目标 deployment
2. 审批
3. `rainbond_rollback_deployment`

## 9.4 Debug Skill

1. `rainbond_get_latest_deployment`
2. `rainbond_get_deployment_logs`
3. `rainbond_explain_deployment_failure`

## 10. 最小交付顺序

### Phase A

- 会话稳定性
- 标准结果 envelope
- 标准错误模型

### Phase B

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

### Phase C

- `rainbond_promote_deployment`
- `rainbond_rollback_deployment`
- `rainbond_manage_project_env`
- `rainbond_manage_project_domain`

## 11. 最终建议

这份文档应作为新高层 Rainbond Agent Deployment MCP 的正式实现合同。

关键原则只有一条：

> Skill 负责用户意图编排。  
> MCP 负责稳定的部署工作流原语。  
> 底层平台步骤不应直接泄露到最终用户路径中。
