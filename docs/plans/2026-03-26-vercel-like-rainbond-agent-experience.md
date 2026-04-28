# Rainbond 实现 Vercel 式 Agent 部署体验方案

## 目标

让用户在 Codex、Claude Code 这类 agent 平台里，像使用 Vercel 一样顺滑地完成：

- 绑定项目
- 配置环境
- 发起部署
- 获取预览地址
- 查看日志与验证结果
- 切换生产流量
- 回滚到历史版本

重点不是简单补齐平台功能，而是把这些能力压缩成 agent 容易理解、容易组合、输出稳定的工作流原语。

## 一、Vercel 的顺滑体验来自什么

### 1. 项目绑定是第一等能力

Vercel 通过 `vercel link` 把“本地目录 <-> 远端项目”关系固定下来。  
后续部署、环境变量、日志、域名、生产发布都围绕已绑定项目展开。

这让 agent 不需要每次都问：

- 你要部署到哪个项目？
- 这是哪个团队？
- 目标环境是 preview 还是 production？

### 2. 预览部署是默认路径

Vercel 的默认部署结果不是“一个模糊的部署动作完成”，而是“一个可以立即访问的 Preview URL”。  
这个 URL 还是稳定的一等对象，适合被 agent 继续拿去：

- 做健康检查
- 跑 e2e
- 截图
- 让用户确认
- 再 promote 到生产

### 3. 构建与发布分离

Vercel 有清晰的两阶段模型：

- 先得到部署产物
- 再选择是否切换到生产

这对 agent 尤其重要，因为 agent 更适合先做“生成候选版本”，再做“切流”。

### 4. CLI 输出天然适合机器消费

Vercel 很多命令的输出并不是面向人类花式排版，而是对 agent 友好的结构：

- `stdout` 直接给 deployment URL
- `logs --json` 给结构化日志
- `curl` 直接验证指定 deployment
- exit code 反映动作成败

### 5. 环境模型统一

Vercel 把 `development / preview / production / custom environments` 统一进一套模型。  
这意味着 agent 不需要学多套 API，只要围绕“环境”这个核心概念工作即可。

### 6. 域名与部署状态解耦

预览地址天然存在，生产域名切换是后续动作。  
这大幅降低了部署失败时的破坏面，也让 agent 可以安全地做“先验证后上线”。

## 二、Rainbond 当前状态

### 已有优势

Rainbond 已经具备很强的平台底座：

- 有大量 MCP 工具，覆盖应用、组件、构建、环境变量、端口、日志、伸缩、升级等
- 平台本身支持镜像、源码、软件包、YAML、Helm 等多种交付方式
- 已能生成外部访问地址
- 已能提供事件和部分日志

### 当前问题

从 agent 体验角度，Rainbond 现在更像“底层动作仓库”，而不是“高层部署工作流产品”。

真实实验中已经暴露出这些问题：

1. MCP 会话兼容性不稳定
   现有 streamable HTTP 行为对标准客户端不够稳，容易出现 session 丢失。

2. 部署流程碎片化
   例如软件包部署需要：
   - 先创建 `event_id`
   - 再从 `upload_url` 上传
   - 且上传字段名必须是 `packageTarFile`
   - 再触发 package build
   - 再检测
   - 再构建
   - 再部署

3. 高层工作流不足
   虽然有很多 MCP 工具，但缺少 Vercel 式的一键高层原语，例如：
   - deploy current workspace
   - get preview URL
   - verify deployment
   - promote deployment
   - rollback deployment

4. 错误反馈不够 agent-friendly
   例如：
   - 镜像不可拉取
   - 资源不足
   - 构建失败
   这些错误虽然能看见，但没有被收敛成结构化“失败原因 + 建议下一步”。

5. 平台内部接口仍有坑
   例如垂直缩容链路报出后端错误：`container_gpu cannot be null`。  
   这会直接打断 agent 的自动修复闭环。

## 三、核心差距不在“有没有 MCP”，而在“有没有工作流抽象”

真正的差距可以分成 4 层：

### 1. Context Binding

Vercel:

- 项目绑定天然清晰

Rainbond:

- 团队、集群、应用、组件上下文需要反复指定

需要补：

- workspace 到 Rainbond project/app/environment 的绑定层

### 2. Workflow Abstraction

Vercel:

- `link`
- `deploy`
- `logs`
- `curl`
- `promote`
- `rollback`

Rainbond:

- 主要还是 create/build/manage 的底层动作

需要补：

- 面向 agent 的高层部署工作流 MCP

### 3. Structured Output

Vercel:

- URL、日志、状态、错误都比较适合机器消费

Rainbond:

- 事件丰富，但很多仍停留在平台内部语义

需要补：

- 统一 deployment receipt / error reason / next action schema

### 4. Safe Release Model

Vercel:

- preview 默认存在
- production promote 独立
- rollback 清晰

Rainbond:

- 更偏平台构建与组件管理

需要补：

- Preview / Release / Rollback 的产品级对象模型

## 四、Rainbond 的目标体验

理想情况下，用户在 Codex / Claude Code 中应该可以这样工作：

### 目标流 1：首次部署

用户：

`帮我把这个项目部署到 Rainbond`

Agent：

1. 自动识别当前工作区
2. 如果未绑定 Rainbond 项目，先执行绑定
3. 判断应该用源码、镜像、软件包还是 YAML
4. 发起一次 preview deployment
5. 返回：
   - deployment id
   - preview URL
   - build logs summary
   - detected framework/runtime
   - 下一步建议

### 目标流 2：验证部署

用户：

`这个版本部署好了吗？`

Agent：

1. 找到最近一次 deployment
2. 检查 deployment status
3. 调 `verify` 原语跑 health check / curl / 可选 e2e
4. 直接回答：
   - 是否成功
   - URL 是什么
   - 哪里失败
   - 建议修什么

### 目标流 3：发布到生产

用户：

`把刚才那个预览版本发布到正式环境`

Agent：

1. 找到上一次 preview deployment
2. 再做一次 preflight
3. 请求审批
4. 执行 promote
5. 返回生产 URL 和变更摘要

### 目标流 4：回滚

用户：

`回滚到昨天晚上那个正常版本`

Agent：

1. 列出最近历史版本
2. 定位目标 deployment
3. 请求审批
4. 执行 rollback
5. 返回恢复结果

## 五、Rainbond 应补的高层原语

建议不要让 Codex/Claude 直接拼底层 MCP。  
应在现有 MCP 之上补一层“agent-first deployment MCP”。

### P0 必备原语

- `rainbond_link_workspace`
  作用：把当前工作区绑定到 team / region / app / env

- `rainbond_deploy_workspace`
  作用：根据当前代码与绑定上下文，自动选择源码/软件包/镜像路径，产出 preview deployment

- `rainbond_get_latest_deployment`
  作用：获取最近一次 deployment 及其状态、URL、framework、commit/workspace source

- `rainbond_get_deployment_logs`
  作用：统一返回 build/runtime logs，支持摘要与原始模式

- `rainbond_verify_deployment`
  作用：对某次 deployment 做健康检查、HTTP 检查、端口连通性检查

- `rainbond_explain_deployment_failure`
  作用：把 Rainbond 事件和日志收敛成结构化失败原因与修复建议

### P1 增强原语

- `rainbond_promote_deployment`
  作用：将 preview 切到 production / 正式域名

- `rainbond_rollback_deployment`
  作用：回滚到历史 deployment

- `rainbond_manage_project_env`
  作用：按 environment 统一管理变量，而不是只按组件层操作

- `rainbond_manage_project_domain`
  作用：绑定/检查/切换域名

### P2 进一步增强

- `rainbond_preflight_resources`
  作用：在部署前评估 CPU/Memory/Node/Registry 可用性，提前告诉 agent 是否会失败

- `rainbond_open_console_target`
  作用：返回控制台深链接，让 Codex/Claude 在必要时能跳到对应页面

- `rainbond_diff_deployments`
  作用：比较两次 deployment 的配置差异、镜像差异、环境变量差异

## 六、推荐架构

### 架构原则

不要把“Vercel 体验”理解成单个 CLI 命令，而要理解成 3 层：

1. Platform Layer
   Rainbond 本身的构建、部署、路由、日志、资源调度能力

2. Workflow Layer
   将多个底层动作编排成高层部署工作流

3. Agent Layer
   给 Codex / Claude Code 暴露稳定的 MCP 原语与结构化输出

### 建议分层

- Layer A: Rainbond Core APIs
  继续保留现有底层能力

- Layer B: Agent Workflow Service
  新增一层服务，负责：
  - workspace binding
  - preview deployment creation
  - deployment receipt generation
  - failure summarization
  - promote / rollback orchestration

- Layer C: MCP Facade for Agents
  面向 agent 只暴露高层工作流工具

- Layer D: IDE / Agent Integrations
  给 Codex / Claude Code 提供一致体验

## 七、分阶段实施方案

### Phase A: 先把“能稳”补齐

目标：

- 修复 MCP 会话兼容性
- 保证 streamable HTTP 对标准客户端稳定
- 所有高频部署动作都能可靠返回结构化 JSON

必须完成：

- 修复 MCP session 生命周期
- 统一 tool output schema
- 统一错误码与 next_action
- 修复垂直缩容等明显后端 bug

验收标准：

- Codex / Claude Code 不需要特殊调用顺序即可稳定调用 MCP
- 失败时能返回稳定 machine-readable error

### Phase B: 做出最小 Vercel 式闭环

目标：

- 首次绑定
- 一键 preview deploy
- 返回 preview URL
- 查看部署日志
- 做部署验证

必须完成：

- `rainbond_link_workspace`
- `rainbond_deploy_workspace`
- `rainbond_get_latest_deployment`
- `rainbond_get_deployment_logs`
- `rainbond_verify_deployment`

验收标准：

- 用户在 Codex / Claude Code 中一句“部署这个项目”，就能得到预览地址与明确状态

### Phase C: 做出生产发布闭环

目标：

- preview -> production promote
- rollback
- environment-aware config
- domain-aware release

必须完成：

- `rainbond_promote_deployment`
- `rainbond_rollback_deployment`
- environment/project 级变量模型
- 域名切换模型

验收标准：

- 用户可以把 agent 用在正式上线，而不是只用在测试部署

### Phase D: 做出比 Vercel 更适合 Rainbond 的差异化体验

目标：

- 把 Rainbond 多集群、多团队、组件级治理优势做成 agent-first 能力

建议增强：

- 资源预检
- 调度失败自动建议
- 组件依赖图影响分析
- 跨环境/跨团队复制与 promote
- Helm / YAML / package / source 的统一 deploy abstraction

## 八、优先级建议

### 最高优先级

1. 稳定 MCP 会话与结构化输出
2. 建立 workspace binding
3. 交付 preview deployment 高层原语
4. 交付 deployment receipt / logs / verify 三件套

### 第二优先级

1. Promote / rollback
2. project/environment 级变量模型
3. domain 切换与检查

### 第三优先级

1. 资源预检
2. 自动修复建议
3. 控制台 deep link
4. deployment diff

## 九、关键产品判断

### 不要复刻 Vercel 的地方

- 不必把 Rainbond 做成“只有 project -> deployment”的极简模型
- 不必牺牲多组件、多团队、多集群能力去迁就单仓库体验

### 必须复刻的地方

- 默认工作流要短
- 输出要稳定
- preview 要天然存在
- promote / rollback 要清晰
- 错误要有下一步建议

## 十、结论

Rainbond 当前已经具备“被 agent 操作”的基础能力，但还不具备“像 Vercel 一样顺滑”的体验闭环。

要实现目标，重点不是继续增加更多底层 MCP 工具，而是：

1. 稳定 MCP 协议行为
2. 引入 workspace/project binding
3. 把部署抽象成 preview-first 的高层工作流
4. 把验证、发布、回滚做成一组统一原语
5. 把日志、错误、建议输出做成 agent-first 的结构化对象

如果沿这个方向推进，Rainbond 不只是能“支持 Codex / Claude Code 部署”，而是能真正形成一套适合 agent 平台的云原生部署体验。
