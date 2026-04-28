# Rainbond Copilot - 快速启动指南

## 当前状态

✅ Phase 1.5 核心功能已完成：
- OpenAI API 集成（支持自定义端点）
- LLM Function Calling 工具选择
- 多轮对话循环
- Rainbond 知识库
- 完整的 UI 界面

✅ API Service 基础链路已完成：
- 多租户 Actor 透传
- Session / Run / Approval / Event 服务端契约
- HTTP + SSE 基础接口
- 审批决策与恢复链路
- Memory / File 两种本地存储模式

## 启动应用

1. **确保环境变量已配置**（.env 文件）：
   ```
   VITE_OPENAI_API_KEY=sk-f160c387700eae2bdcdf2dd525ed6e50477894b614c03e3d3e141d1344e327ee
   VITE_OPENAI_MODEL=gpt-4o-mini
   VITE_OPENAI_BASE_URL=http://101.47.156.0:10000
   ```

2. **启动开发服务器**：
   ```bash
   npm run dev
   ```

3. **访问应用**：
   打开浏览器访问 http://localhost:5174

## 启动 API 服务

1. **选择存储模式**：

   内存模式：
   ```bash
   export COPILOT_STORE_MODE=memory
   ```

   文件模式：
   ```bash
   export COPILOT_STORE_MODE=file
   export COPILOT_DATA_DIR=.copilot-data
   ```

2. **编译服务端代码**：
   ```bash
   npm run build:server
   ```

3. **启动服务**：
   ```bash
   npm run start:server
   ```

   或者直接使用启动脚本：
   ```bash
   ./scripts/start-copilot-api.sh
   ```

4. **健康检查**：
   ```bash
   curl http://127.0.0.1:8787/healthz
   ```

## 另一个项目的接入示例

可直接参考：

- [backend-example.mjs](/Users/guox/Desktop/归档/examples/copilot-api-client/backend-example.mjs)
- [frontend-sse-example.ts](/Users/guox/Desktop/归档/examples/copilot-api-client/frontend-sse-example.ts)
- [README.md](/Users/guox/Desktop/归档/examples/copilot-api-client/README.md)

如果你想直接复用一个轻量客户端封装，可以看：

- [copilot-api-client.ts](/Users/guox/Desktop/归档/src/shared/copilot-api-client.ts)

## API 基础流程

1. **创建会话**：
   ```bash
   curl -X POST http://127.0.0.1:8787/api/v1/copilot/sessions \
     -H 'Content-Type: application/json' \
     -H 'x-copilot-tenant-id: t_123' \
     -H 'x-copilot-user-id: u_456' \
     -H 'x-copilot-username: alice' \
     -H 'x-copilot-source-system: ops-console' \
     -d '{}'
   ```

2. **发送消息启动 run**：
   ```bash
   curl -X POST http://127.0.0.1:8787/api/v1/copilot/sessions/<session_id>/messages \
     -H 'Content-Type: application/json' \
     -H 'x-copilot-tenant-id: t_123' \
     -H 'x-copilot-user-id: u_456' \
     -H 'x-copilot-username: alice' \
     -H 'x-copilot-source-system: ops-console' \
     -d '{"message":"restart frontend-ui","stream":true}'
   ```

3. **订阅 SSE**：
   ```bash
   curl -N http://127.0.0.1:8787/api/v1/copilot/sessions/<session_id>/runs/<run_id>/events \
     -H 'Accept: text/event-stream' \
     -H 'x-copilot-tenant-id: t_123' \
     -H 'x-copilot-user-id: u_456' \
     -H 'x-copilot-username: alice' \
     -H 'x-copilot-source-system: ops-console'
   ```

4. **提交审批决定**：
   ```bash
   curl -X POST http://127.0.0.1:8787/api/v1/copilot/approvals/<approval_id>/decisions \
     -H 'Content-Type: application/json' \
     -H 'x-copilot-tenant-id: t_123' \
     -H 'x-copilot-user-id: u_456' \
     -H 'x-copilot-username: alice' \
     -H 'x-copilot-source-system: ops-console' \
     -d '{"decision":"approved","comment":"确认执行"}'
   ```

## 测试 LLM 集成

尝试以下问题来测试真实的 LLM 功能：

1. **基础问答**：
   - "什么是 Rainbond？"
   - "Rainbond 的核心概念有哪些？"
   - "如何排查组件故障？"

2. **工具调用**：
   - "查看 frontend-ui 组件的状态"
   - "获取 backend-api 的日志"

3. **审批流程**：
   - "重启 frontend-ui 组件"（会触发审批请求）

## 架构说明

```
用户输入 → App.tsx → InProcessGateway → AgentRuntime → OpenAI API
                                              ↓
                                         SkillRegistry
                                              ↓
                                         Action Skills
                                              ↓
                                         返回结果 → UI 显示
```

API Service 形态：

```
Caller Project Backend
    ↓ trusted headers
Copilot API Server
    ↓
Controller / Services
    ↓
Session / Run / Approval / Event Stores
    ↓
SSE Broker
```

支持的后端模式：

- `memory`：测试和临时调试
- `file`：当前推荐的部署持久化方式

## 下一步

- Task 16: 端到端流程验证（当前进行中）
- Task 17: 错误处理和优化
- Task 19: 扩展 Prompt Skills 覆盖更多场景
