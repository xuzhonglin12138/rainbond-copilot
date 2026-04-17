# Rainbond Copilot - 快速启动指南

## 当前状态

✅ Phase 1.5 核心功能已完成：
- OpenAI API 集成（支持自定义端点）
- LLM Function Calling 工具选择
- 多轮对话循环
- Rainbond 知识库
- 完整的 UI 界面

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

## 下一步

- Task 16: 端到端流程验证（当前进行中）
- Task 17: 错误处理和优化
- Task 19: 扩展 Prompt Skills 覆盖更多场景
