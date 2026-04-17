# Rainbond MCP for Codex / Claude Code

> 面向 Codex、Claude Code 等外部 agent 工具的 Rainbond MCP 使用指南

当用户通过 Codex、Claude Code 这类外部 agent 工具接入 Rainbond MCP 时，优先按下面的方式工作。

## 适用场景

- 用户说“帮我把这个项目部署到 Rainbond”
- 用户要在本地工作区里完成部署、验证、发布、回滚
- 用户需要通过 MCP 与 Rainbond 交互，而不是直接在控制台页面点操作
- 用户希望得到接近 Vercel 的 preview-first 体验

## 核心原则

### 1. 先绑定，再部署

每个工作区都应该先建立明确绑定：

- `team`
- `region`
- `app`
- `environment`

不要每次部署都重新让用户补全上下文。

### 2. Preview 优先

默认先创建 preview deployment，再验证，再决定是否 promote 到生产。

外部 agent 最顺滑的路径应该是：

1. link workspace
2. detect strategy
3. deploy preview
4. verify
5. promote or rollback

### 3. Skill 不拼底层接口

不要在 skill 里直接暴露这些底层细节给用户：

- 创建 `event_id`
- 上传 `packageTarFile`
- 调 package build
- 调 build component

这些应该被高层 MCP 原语封装掉。

### 4. 结果必须结构化

每次关键动作都应返回：

- 当前 deployment id
- preview URL / production URL
- status
- failure type
- suggested next actions

## 推荐用户工作流

### 工作流 1：首次部署

用户：

`帮我把这个项目部署到 Rainbond`

推荐处理：

1. 检查 workspace binding
2. 若未绑定，执行绑定
3. 检测部署策略
4. 做资源预检
5. 发起 preview deployment
6. 返回 preview URL 和状态摘要

### 工作流 2：检查部署结果

用户：

`这个版本部署成功了吗？`

推荐处理：

1. 找最近一次 deployment
2. 获取 logs
3. 做 verify
4. 输出成功/失败与建议动作

### 工作流 3：发布正式环境

用户：

`把刚才那个版本发到生产`

推荐处理：

1. 找最近一次 healthy preview
2. 输出风险摘要
3. 请求审批
4. 执行 promote

### 工作流 4：回滚

用户：

`回滚到上一个稳定版本`

推荐处理：

1. 查历史 deployment
2. 给出候选目标
3. 请求审批
4. 执行 rollback

## 最佳实践

- 默认使用高层工作流 MCP，而不是底层 create/build/logs 拼装
- 先做 `preflight`，再部署，避免到调度阶段才发现资源不足
- 把 preview URL 当作一等产物，而不是附属信息
- 部署失败时优先给出“失败类型 + 建议下一步”，不要只贴平台错误
- 做 destructive 动作前统一审批，例如 promote、rollback、delete
- 把 workspace binding 和 latest receipt 保存在本地，减少重复确认

## Rainbond 领域知识

### 1. Rainbond 的常见部署来源

- `source`：从代码仓库构建
- `image`：从镜像部署
- `package`：上传软件包部署
- `yaml` / `helm`：模板或集群资源方式部署

### 2. Rainbond 与 Vercel 的差异

- Rainbond 是应用平台，不只是静态/前端托管平台
- Rainbond 天然支持多组件、依赖、存储、端口、运行时治理
- 所以 agent 体验不能只围绕“单项目部署”，还要兼顾组件级操作

### 3. 常见失败类型

- `image_pull_failed`
- `build_failed`
- `insufficient_cpu`
- `insufficient_memory`
- `runtime_crash`
- `config_error`

### 4. 常见外部集成痛点

- MCP 会话行为不稳定时，外部 agent 容易误判平台失败
- 软件包上传通常需要 `upload_url + upload_field_name`
- 构建成功不代表调度成功，调度资源问题要单独识别

## 推荐输出格式

对用户的回答优先组织成：

1. 当前动作结果
2. 当前绑定目标
3. URL
4. 风险或失败原因
5. 下一步建议
