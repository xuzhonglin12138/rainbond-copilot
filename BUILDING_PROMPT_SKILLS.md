# 领域知识 Skills 建设指南

## 什么是 Prompt Skills？

Prompt Skills 是注入到系统提示词中的**结构化领域知识**，用于指导 AI 在特定场景下提供专业的帮助。

### 与 Action Skills 的区别

| 类型 | Prompt Skills | Action Skills |
|------|--------------|---------------|
| **性质** | 知识和指导 | 可执行操作 |
| **作用** | 告诉 AI "怎么回答" | 告诉 AI "怎么做" |
| **格式** | Markdown 文档 | TypeScript 代码 |
| **示例** | 部署指南、最佳实践 | 查询状态、重启组件 |

### 为什么需要 Prompt Skills？

1. **补充 AI 的领域知识** - AI 可能不了解 Rainbond 的具体操作
2. **标准化回答** - 确保 AI 按照最佳实践回答
3. **提高准确性** - 减少 AI 的幻觉和错误
4. **可维护性** - 知识更新只需修改 markdown 文件

## 识别需要创建的 Skills

### 方法 1: 用户问题分析

收集用户常问的问题，归类为不同场景：

```
用户问题                    → 对应 Skill
"如何部署应用？"            → deploy-application
"应用很慢怎么办？"          → performance-optimization
"如何保护密码？"            → security-best-practices
"怎么备份数据？"            → backup-and-recovery
```

### 方法 2: 产品功能覆盖

根据产品的核心功能模块创建 Skills：

```
产品功能                    → 对应 Skill
应用部署                    → deploy-application
组件管理                    → component-management
网络配置                    → network-configuration
存储管理                    → storage-management
监控告警                    → monitoring-alerting
CI/CD 集成                  → cicd-integration
```

### 方法 3: 用户旅程映射

根据用户使用产品的生命周期创建 Skills：

```
阶段                        → 对应 Skill
1. 入门                     → getting-started
2. 部署第一个应用            → deploy-application
3. 配置和优化                → configuration-optimization
4. 监控和运维                → monitoring-operations
5. 故障排查                  → troubleshooting
6. 扩展和升级                → scaling-upgrading
```

### 方法 4: 痛点驱动

根据用户最常遇到的问题创建 Skills：

```
痛点                        → 对应 Skill
部署失败                    → deployment-troubleshooting
性能问题                    → performance-optimization
安全漏洞                    → security-best-practices
数据丢失                    → backup-and-recovery
```

## Skill 内容组织结构

### 标准模板

```markdown
# Skill 标题

> 一句话描述这个 Skill 的作用

## 使用场景

描述什么时候应该使用这个 Skill，触发条件是什么。

## 核心概念

解释相关的核心概念和术语。

## 操作步骤

### 场景 1: XXX

**步骤**:
1. 第一步
2. 第二步
3. 第三步

**注意事项**:
- 注意点 1
- 注意点 2

### 场景 2: YYY

...

## 最佳实践

列出推荐的做法和要避免的坑。

## 常见问题

### 问题 1: XXX

**原因**: ...
**解决方案**: ...

### 问题 2: YYY

...

## 相关工具

如果有相关的 Action Skills，在这里说明如何使用。

## 示例

提供具体的示例和代码。
```

### 内容编写原则

#### 1. 结构化和层次化

```markdown
✅ 好的结构：
# 部署应用
## 部署方式
### 从源码部署
#### Git 仓库
#### SVN 仓库
### 从镜像部署
### 从应用模板部署

❌ 差的结构：
# 部署应用
部署应用有很多方式，可以从源码部署，也可以从镜像部署...
（一大段文字，没有层次）
```

#### 2. 可操作性

```markdown
✅ 好的指导：
**步骤**:
1. 进入"应用管理"页面
2. 点击"创建组件"按钮
3. 选择"从源码构建"
4. 输入 Git 仓库地址: https://github.com/...

❌ 差的指导：
你需要创建一个组件，然后配置源码地址。
```

#### 3. 场景化

```markdown
✅ 好的场景：
### 场景 1: 部署 Node.js 应用
适用于: Express、Koa、Nest.js 等 Node.js 框架

### 场景 2: 部署 Java 应用
适用于: Spring Boot、Maven、Gradle 项目

❌ 差的场景：
### 部署应用
（没有区分不同类型的应用）
```

#### 4. 问题导向

```markdown
✅ 好的问题：
### 问题: 构建失败，提示 "npm install 超时"

**原因**: npm 仓库访问慢或被墙
**解决方案**:
1. 配置国内镜像源
2. 使用 cnpm 或 yarn

❌ 差的问题：
### 构建问题
构建可能会失败，需要检查日志。
```

## 文件组织规范

### 目录结构

```
src/skills/prompt/
├── rainbond-core/
│   └── skill.md
├── diagnose-service/
│   └── skill.md
├── deploy-application/
│   └── skill.md
├── performance-optimization/
│   └── skill.md
├── security-best-practices/
│   └── skill.md
└── backup-and-recovery/
    └── skill.md
```

### 命名规范

**目录名**: 使用 kebab-case（小写 + 连字符）
```
✅ deploy-application
✅ performance-optimization
❌ DeployApplication
❌ deploy_application
```

**文件名**: 统一使用 `skill.md`
```
✅ skill.md
❌ deploy.md
❌ guide.md
```

**Skill ID**: 与目录名保持一致
```typescript
createPromptSkill(
  "deploy-application",  // ← 与目录名一致
  "Application Deployment Guide",
  "Guide users through deploying applications",
  deployApplicationSkill
)
```

## 注册和加载 Skills

### 步骤 1: 创建 Skill 文件

```bash
# 创建目录
mkdir -p src/skills/prompt/network-configuration

# 创建 skill.md
cat > src/skills/prompt/network-configuration/skill.md << 'EOF'
# Network Configuration

> Guide users on configuring network and access policies

## 使用场景

当用户需要配置以下内容时使用：
- 端口映射
- 域名绑定
- 访问策略
- 负载均衡

...
EOF
```

### 步骤 2: 在 registry.ts 中导入

```typescript
// src/skills/registry.ts

// 添加导入
import networkConfigurationSkill from "./prompt/network-configuration/skill.md?raw";
```

### 步骤 3: 注册 Skill

```typescript
// src/skills/registry.ts

constructor(_baseDir?: string) {
  this.skills = [
    // ... 其他 skills

    // 添加新的 Prompt Skill
    createPromptSkill(
      "network-configuration",
      "Network Configuration",
      "Guide users on configuring network and access policies",
      networkConfigurationSkill
    ),
  ];
}
```

### 步骤 4: 验证

```bash
# 重新构建
npm run build

# 检查是否有错误
# 如果构建成功，说明 Skill 已正确加载
```

## 内容质量检查清单

### 完整性检查

- [ ] 有清晰的标题和描述
- [ ] 说明了使用场景
- [ ] 包含核心概念解释
- [ ] 提供了操作步骤
- [ ] 列出了最佳实践
- [ ] 包含常见问题和解决方案
- [ ] 有具体的示例

### 准确性检查

- [ ] 所有步骤都经过验证
- [ ] 命令和代码可以直接运行
- [ ] 没有过时的信息
- [ ] 版本信息准确

### 可读性检查

- [ ] 结构清晰，层次分明
- [ ] 使用了列表和表格
- [ ] 有代码块和示例
- [ ] 语言简洁明了
- [ ] 没有错别字

### 实用性检查

- [ ] 覆盖了常见场景
- [ ] 提供了可操作的步骤
- [ ] 包含了故障排查
- [ ] 有相关工具的说明

## 最佳实践

### 1. 保持聚焦

每个 Skill 只关注一个主题：

```
✅ 好的聚焦：
- deploy-application: 只讲部署
- performance-optimization: 只讲性能
- security-best-practices: 只讲安全

❌ 差的聚焦：
- rainbond-guide: 什么都讲（太宽泛）
```

### 2. 适当的粒度

```
✅ 好的粒度：
- deploy-application (部署应用)
  - 从源码部署
  - 从镜像部署
  - 从模板部署

❌ 太细的粒度：
- deploy-from-git (从 Git 部署)
- deploy-from-svn (从 SVN 部署)
- deploy-from-docker (从 Docker 部署)
（太碎片化，应该合并）

❌ 太粗的粒度：
- rainbond-operations (Rainbond 运维)
  - 部署、监控、备份、安全...
（太宽泛，应该拆分）
```

### 3. 引用 Action Skills

当 Skill 中提到需要执行操作时，明确说明使用哪个 Action Skill：

```markdown
## 诊断步骤

1. **查询组件状态**
   使用 `get-component-status` 工具查询组件当前状态

2. **查看日志**
   使用 `get-component-logs` 工具查看最近的日志

3. **分析问题**
   根据状态和日志判断问题原因
```

### 4. 使用真实示例

```markdown
✅ 好的示例：
### 示例: 部署 Express 应用

```bash
# Git 仓库地址
https://github.com/expressjs/express-starter

# 构建命令
npm install && npm run build

# 启动命令
npm start

# 端口
3000
```

❌ 差的示例：
### 示例
输入你的 Git 地址，然后点击部署。
```

### 5. 保持更新

```markdown
# 在 Skill 开头注明版本和更新时间

# Deploy Application

> 最后更新: 2026-03-14
> 适用版本: Rainbond 5.x

...
```

## 常见问题

### Q1: Skill 太长会影响性能吗？

**A**: 会的。每个 Skill 都会被注入到系统提示词中，太长会：
- 增加 token 使用量
- 增加 API 调用成本
- 可能超出上下文限制

**建议**:
- 单个 Skill 控制在 2-3KB
- 如果内容太多，拆分成多个 Skills
- 使用简洁的语言，避免冗余

### Q2: 如何决定创建 Prompt Skill 还是 Action Skill？

**A**:
- **Prompt Skill**: 提供知识和指导（"怎么做"）
- **Action Skill**: 执行具体操作（"做什么"）

**示例**:
```
场景: 用户问"如何重启组件？"

Prompt Skill (deploy-application):
- 解释什么情况需要重启
- 说明重启的影响
- 提供重启的步骤

Action Skill (restart-component):
- 实际执行重启操作
- 返回重启结果
```

### Q3: 多个 Skills 有重复内容怎么办？

**A**:
1. **提取公共知识** - 放到 `knowledge/` 目录
2. **交叉引用** - 在 Skill 中引用其他 Skill
3. **保持独立** - 如果重复不多，保持独立更清晰

### Q4: 如何测试 Skill 是否生效？

**A**:
1. 构建应用: `npm run build`
2. 启动应用: `npm run dev`
3. 问相关问题，看 AI 是否使用了 Skill 中的知识
4. 检查系统提示词是否包含 Skill 内容（查看控制台日志）

## 实战示例

### 示例 1: 创建"网络配置"Skill

```bash
# 1. 创建目录和文件
mkdir -p src/skills/prompt/network-configuration
cat > src/skills/prompt/network-configuration/skill.md << 'EOF'
# Network Configuration

> Guide users on configuring network and access policies

## 使用场景

当用户需要配置以下内容时使用：
- 端口映射和对外访问
- 域名绑定和 HTTPS
- 访问策略和白名单
- 负载均衡和服务网格

## 端口配置

### 添加端口

**步骤**:
1. 进入组件详情页
2. 点击"端口"标签
3. 点击"添加端口"
4. 配置端口信息：
   - 容器端口: 应用监听的端口（如 3000）
   - 协议: HTTP、TCP、UDP
   - 对外访问: 是否开启外部访问

### 开启 HTTPS

**步骤**:
1. 在端口配置中选择 HTTPS 协议
2. 选择证书来源：
   - 自动申请（Let's Encrypt）
   - 上传自有证书
3. 配置域名
4. 保存并重启组件

## 域名配置

### 绑定自定义域名

**步骤**:
1. 在端口配置中点击"访问策略"
2. 添加域名: `app.example.com`
3. 配置 DNS 解析：
   - A 记录指向集群 IP
   - 或 CNAME 指向平台域名
4. 等待 DNS 生效（通常 5-10 分钟）

## 访问控制

### IP 白名单

**场景**: 限制只有特定 IP 可以访问

**配置**:
```yaml
access_control:
  - source: 10.0.0.0/8      # 内网
  - source: 192.168.1.100   # 特定 IP
```

### 认证配置

**场景**: 需要用户名密码才能访问

**配置**:
1. 启用 Basic Auth
2. 设置用户名和密码
3. 保存配置

## 负载均衡

### 水平扩展

**场景**: 单个实例无法承载流量

**步骤**:
1. 增加实例数量（如 1 → 3）
2. Rainbond 自动配置负载均衡
3. 流量自动分发到多个实例

### 会话保持

**场景**: 需要将同一用户的请求路由到同一实例

**配置**:
- 启用 Session Affinity
- 选择策略: Cookie 或 IP Hash

## 常见问题

### 问题 1: 域名无法访问

**原因**:
- DNS 未生效
- 端口未开启对外访问
- 防火墙阻止

**解决方案**:
1. 检查 DNS 解析: `nslookup app.example.com`
2. 确认端口已开启对外访问
3. 检查防火墙规则

### 问题 2: HTTPS 证书申请失败

**原因**:
- 域名未正确解析
- 80 端口被占用
- Let's Encrypt 限流

**解决方案**:
1. 确认域名已解析到正确 IP
2. 检查 80 端口是否可访问
3. 等待一段时间后重试

## 最佳实践

1. **使用 HTTPS** - 保护数据传输安全
2. **配置健康检查** - 确保流量只路由到健康实例
3. **启用访问日志** - 便于问题排查
4. **定期检查证书** - 避免证书过期
EOF

# 2. 在 registry.ts 中导入
# （手动编辑 src/skills/registry.ts，添加导入和注册）

# 3. 构建验证
npm run build
```

### 示例 2: 创建"监控告警"Skill

```bash
mkdir -p src/skills/prompt/monitoring-alerting
cat > src/skills/prompt/monitoring-alerting/skill.md << 'EOF'
# Monitoring and Alerting

> Guide users on setting up monitoring and alert rules

## 使用场景

当用户需要：
- 监控应用性能和资源使用
- 配置告警规则
- 接收告警通知
- 分析监控数据

## 监控指标

### 核心指标

**资源指标**:
- CPU 使用率
- 内存使用率
- 磁盘使用率
- 网络流量

**应用指标**:
- 请求数（QPS）
- 响应时间（P50, P95, P99）
- 错误率
- 并发连接数

### 查看监控

**步骤**:
1. 进入组件详情页
2. 点击"监控"标签
3. 选择时间范围
4. 查看各项指标趋势

## 告警配置

### 创建告警规则

**示例: CPU 使用率告警**

**规则**:
- 指标: CPU 使用率
- 条件: > 80%
- 持续时间: 5 分钟
- 告警级别: 警告

**步骤**:
1. 进入"告警管理"
2. 点击"创建告警规则"
3. 配置规则参数
4. 选择通知方式
5. 保存规则

### 通知渠道

**支持的渠道**:
- 邮件
- 短信
- 钉钉
- 企业微信
- Webhook

**配置示例**:
```yaml
notification:
  - type: email
    to: ops@example.com
  - type: dingtalk
    webhook: https://oapi.dingtalk.com/robot/send?access_token=xxx
```

## 常见告警规则

### 1. 资源告警

```yaml
# CPU 告警
- name: High CPU Usage
  metric: cpu_usage
  condition: > 80%
  duration: 5m
  level: warning

# 内存告警
- name: High Memory Usage
  metric: memory_usage
  condition: > 90%
  duration: 3m
  level: critical

# 磁盘告警
- name: Disk Space Low
  metric: disk_usage
  condition: > 85%
  duration: 10m
  level: warning
```

### 2. 应用告警

```yaml
# 错误率告警
- name: High Error Rate
  metric: error_rate
  condition: > 1%
  duration: 2m
  level: critical

# 响应时间告警
- name: Slow Response
  metric: response_time_p95
  condition: > 1000ms
  duration: 5m
  level: warning
```

### 3. 可用性告警

```yaml
# 组件异常
- name: Component Down
  metric: component_status
  condition: != running
  duration: 1m
  level: critical

# 健康检查失败
- name: Health Check Failed
  metric: health_check
  condition: failed
  duration: 2m
  level: critical
```

## 告警处理流程

### 收到告警后的步骤

1. **确认告警**
   - 查看告警详情
   - 确认是否为误报

2. **快速诊断**
   - 使用 `get-component-status` 查看状态
   - 使用 `get-component-logs` 查看日志

3. **采取行动**
   - 如果是资源问题，使用 `scale-component-memory` 扩容
   - 如果是故障，使用 `restart-component` 重启
   - 如果是配置问题，修改配置

4. **记录和总结**
   - 记录问题原因
   - 记录解决方案
   - 优化告警规则

## 最佳实践

1. **分级告警**
   - Critical: 立即处理
   - Warning: 关注观察
   - Info: 记录备查

2. **避免告警疲劳**
   - 设置合理的阈值
   - 避免重复告警
   - 定期审查告警规则

3. **告警聚合**
   - 相同问题只发送一次告警
   - 设置告警静默期

4. **定期检查**
   - 每周查看监控趋势
   - 每月优化告警规则
   - 每季度容量规划
EOF
```

## 总结

构建领域知识 Skills 的关键步骤：

1. **识别场景** - 分析用户需求，确定需要哪些 Skills
2. **组织内容** - 使用标准模板，结构化编写
3. **创建文件** - 按照规范创建目录和文件
4. **注册加载** - 在 registry.ts 中导入和注册
5. **测试验证** - 构建应用，测试 Skill 是否生效
6. **持续优化** - 根据用户反馈不断改进

记住：**好的 Skill 应该是结构化、可操作、场景化的**！
