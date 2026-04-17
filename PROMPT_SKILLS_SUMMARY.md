# Prompt Skills 扩展完成

## 新增的 Prompt Skills

### 1. Deploy Application（应用部署指南）
**场景**: 用户想要部署新应用
**内容**:
- 三种部署方式：源码、镜像、应用模板
- 部署后配置：端口、环境变量、存储、健康检查
- 常见问题排查

**示例问题**:
- "如何部署一个 Node.js 应用？"
- "怎么从 Docker 镜像部署？"
- "部署后无法访问怎么办？"

### 2. Performance Optimization（性能优化）
**场景**: 用户遇到性能问题或想要优化应用
**内容**:
- 性能分析工作流
- CPU、内存、数据库、网络优化策略
- 水平扩展 vs 垂直扩展
- 监控和告警配置

**示例问题**:
- "应用响应很慢怎么办？"
- "CPU 使用率一直很高"
- "如何提高并发处理能力？"

### 3. Security Best Practices（安全最佳实践）
**场景**: 用户关注应用安全
**内容**:
- 安全检查清单（访问控制、网络安全、数据安全）
- 容器安全和应用安全
- 常见安全问题和解决方案
- 合规性支持

**示例问题**:
- "如何保护敏感配置？"
- "怎么启用 HTTPS？"
- "如何防止 SQL 注入？"

### 4. Backup and Recovery（备份和恢复）
**场景**: 用户需要备份数据或恢复服务
**内容**:
- 应用备份、数据备份、配置备份
- 恢复流程（应用恢复、数据恢复、灾难恢复）
- 备份最佳实践（3-2-1 规则）
- RTO 和 RPO 目标

**示例问题**:
- "如何备份数据库？"
- "应用被误删了怎么恢复？"
- "如何做灾难恢复？"

## 技术实现

### 1. Prompt Skills 加载机制

```typescript
// src/skills/registry.ts
import deployApplicationSkill from "./prompt/deploy-application/skill.md?raw";

createPromptSkill(
  "deploy-application",
  "Application Deployment Guide",
  "Guide users through deploying applications on Rainbond",
  deployApplicationSkill
)
```

### 2. 系统提示词集成

```typescript
// src/prompts/system-prompt.ts
function buildPromptSkillDescriptions(skills: Skill[]): string {
  const promptSkills = skills.filter((s) => s.kind === "prompt");

  return promptSkills
    .map((skill) => `### ${skill.name}\n${skill.content}`)
    .join("\n\n---\n\n");
}
```

### 3. 工作原理

```
用户提问
    ↓
系统提示词构建
    ├── 核心知识（knowledge/*.md）
    ├── Prompt Skills（skills/prompt/**/skill.md）
    └── Action Skills（skills/actions/**/plugin.ts）
    ↓
发送给 Claude API
    ↓
Claude 基于完整上下文回答
```

## 使用效果

### 之前
- 只有基础的核心概念和故障排查知识
- 缺少具体场景的详细指导
- 用户需要多次追问才能得到完整答案

### 现在
- 覆盖 6 大场景：核心知识、诊断、部署、性能、安全、备份
- 每个场景都有详细的步骤和最佳实践
- 一次性提供完整的解决方案

## 测试建议

尝试以下问题来测试新的 Prompt Skills：

1. **部署相关**:
   - "我想部署一个 WordPress 应用"
   - "如何从 Git 仓库部署？"

2. **性能相关**:
   - "我的应用很慢，怎么优化？"
   - "CPU 使用率 90%，怎么办？"

3. **安全相关**:
   - "如何保护数据库密码？"
   - "怎么启用 HTTPS？"

4. **备份相关**:
   - "如何备份 MySQL 数据库？"
   - "应用被删了怎么恢复？"

## 后续扩展

可以继续添加更多场景的 Prompt Skills：

- **网络配置**: 服务发现、负载均衡、域名配置
- **存储管理**: 持久化存储、共享存储、存储扩容
- **监控告警**: 指标配置、告警规则、日志分析
- **CI/CD 集成**: Jenkins、GitLab CI、GitHub Actions
- **多集群管理**: 集群接入、应用迁移、跨集群部署
- **团队协作**: 权限管理、资源配额、审计日志

## 文件结构

```
src/skills/
├── actions/                    # Action Skills（可执行操作）
│   ├── get-component-status/
│   ├── get-component-logs/
│   ├── restart-component/
│   └── scale-component-memory/
├── prompt/                     # Prompt Skills（指导性知识）
│   ├── rainbond-core/
│   ├── diagnose-service/
│   ├── deploy-application/     # 新增
│   ├── performance-optimization/  # 新增
│   ├── security-best-practices/   # 新增
│   └── backup-and-recovery/    # 新增
├── registry.ts                 # 技能注册中心
└── types.ts                    # 类型定义
```
