# Rainbond MCP Scenario Testing

> 面向 Rainbond MCP 场景化开发与测试的测试指南

当需要为 Rainbond MCP 设计、开发、验证场景时，按这份 playbook 执行。

## 适用场景

- 设计新的高层 MCP 接口
- 验证 Codex / Claude Code 集成体验
- 验证 Rainbond 内嵌 agent 场景
- 做部署、验证、发布、回滚、失败恢复等流程测试

## 测试原则

### 1. 场景优先，不是接口优先

不要只测试：

- 这个接口 200 不 200

而要测试完整场景：

- 首次绑定并部署一个项目
- 得到 preview URL 后是否可验证
- 发布正式环境是否可审批
- 回滚是否能回到指定版本

### 2. Happy Path 和 Failure Path 同等重要

至少覆盖：

- 成功部署
- 构建失败
- 镜像拉取失败
- CPU / Memory 资源不足
- 端口或域名不可达
- promote 失败
- rollback 失败

### 3. 输出必须可机器消费

测试时重点检查：

- 是否有稳定 `status`
- 是否有稳定 `error_type`
- 是否有 `suggested_actions`
- 是否能拿到 URL / deployment id / app id / service id

## 推荐测试矩阵

### 场景 1：工作区绑定

验证点：

- 新工作区能绑定
- 已绑定工作区能读取 binding
- app 不存在时能正确报错或自动创建

### 场景 2：部署策略识别

验证点：

- source 项目能识别为 source
- 镜像输入能识别为 image
- 软件包输入能识别为 package
- yaml / helm 项目能识别正确

### 场景 3：Preview 部署

验证点：

- 能产出 deployment receipt
- 能拿到 preview URL
- 日志可查
- verify 可执行

### 场景 4：失败解释

验证点：

- 错误是否被归类成统一 failure_type
- 是否给出建议动作
- 是否可区分 retryable / non-retryable

### 场景 5：发布与回滚

验证点：

- promote 前是否要求审批
- promote 后是否给出 production URL
- rollback 是否能指向目标 deployment

## 最佳实践

- 每个高层 MCP 都准备一组固定测试用例
- 至少准备一个真实样例和一个故障样例
- 测试输出不要只看文案，要看 schema 是否稳定
- 把测试重点放在 workflow 连贯性，而不是单点调用成功
- 外部 agent 与内嵌 agent 需要分别验收

## Rainbond 领域知识

### 1. Rainbond 真实问题经常发生在链路中段

不是所有失败都会在“创建组件”时发生。

常见中段失败：

- 包上传成功，但检测失败
- 构建成功，但调度失败
- 部署成功，但访问未通

### 2. Preview URL 不等于 Ready

Rainbond 可能在较早阶段就生成访问地址，但服务还未真正 Running。  
所以必须把 URL 校验和 deployment verify 作为独立测试项。

### 3. 测试时要重点盯住这些状态

- `accepted`
- `building`
- `ready`
- `waiting`
- `undeploy`
- `failed`

### 4. 测试时应保留足够上下文

至少记录：

- team_name
- region_name
- app_id
- service_id
- deployment_id
- event_id
- preview_url

## 建议测试报告格式

每次场景测试都输出：

1. 场景名称
2. 输入条件
3. 预期结果
4. 实际结果
5. 失败类型
6. 建议修复项
