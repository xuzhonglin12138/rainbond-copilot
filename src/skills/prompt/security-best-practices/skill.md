# Security Best Practices

> Guide users on securing their Rainbond applications

When users ask about security or need to secure their applications:

## Security Checklist

### 1. Access Control

**Authentication**:
- ✅ 启用强密码策略
- ✅ 使用 OAuth/OIDC 单点登录
- ✅ 定期更换密码和密钥
- ✅ 禁用默认账户

**Authorization**:
- ✅ 实施最小权限原则
- ✅ 使用 RBAC 角色管理
- ✅ 定期审查权限配置
- ✅ 记录访问日志

### 2. Network Security

**Service Exposure**:
- ✅ 仅暴露必要的端口
- ✅ 使用 HTTPS 加密传输
- ✅ 配置 WAF（Web 应用防火墙）
- ✅ 限制访问来源 IP

**Internal Communication**:
- ✅ 使用服务网格加密内部流量
- ✅ 启用 mTLS（双向 TLS）
- ✅ 隔离敏感服务

### 3. Data Security

**Sensitive Data**:
- ✅ 使用密文存储敏感配置
- ✅ 加密数据库连接
- ✅ 定期备份数据
- ✅ 加密备份文件

**Environment Variables**:
```bash
# ❌ 错误：明文存储密码
DATABASE_PASSWORD=mypassword123

# ✅ 正确：使用 Rainbond 密文配置
DATABASE_PASSWORD=${SECRET:db-password}
```

### 4. Container Security

**Image Security**:
- ✅ 使用官方或可信镜像
- ✅ 定期更新基础镜像
- ✅ 扫描镜像漏洞
- ✅ 最小化镜像大小

**Runtime Security**:
- ✅ 以非 root 用户运行
- ✅ 只读文件系统（适用时）
- ✅ 限制容器权限
- ✅ 禁用特权模式

### 5. Application Security

**Code Security**:
- ✅ 输入验证和过滤
- ✅ 防止 SQL 注入
- ✅ 防止 XSS 攻击
- ✅ 防止 CSRF 攻击

**Dependency Security**:
- ✅ 定期更新依赖包
- ✅ 扫描依赖漏洞
- ✅ 使用安全的依赖版本
- ✅ 移除未使用的依赖

## Common Security Issues

### 1. Exposed Secrets

**Problem**:
- 密码、API 密钥硬编码在代码中
- 敏感信息提交到 Git 仓库

**Solution**:
1. 使用 Rainbond 密文配置
2. 使用环境变量注入
3. 使用密钥管理服务（如 Vault）
4. 从 Git 历史中删除敏感信息

### 2. Insecure Communication

**Problem**:
- 使用 HTTP 而非 HTTPS
- 未验证 SSL 证书
- 内部服务明文通信

**Solution**:
1. 启用 HTTPS 访问策略
2. 配置 SSL 证书（Let's Encrypt 自动续期）
3. 启用服务网格加密内部流量

### 3. Weak Access Control

**Problem**:
- 使用默认密码
- 权限配置过于宽松
- 缺少访问审计

**Solution**:
1. 强制修改默认密码
2. 实施最小权限原则
3. 启用访问日志和审计
4. 定期审查权限配置

### 4. Vulnerable Dependencies

**Problem**:
- 使用过时的依赖包
- 依赖包存在已知漏洞

**Solution**:
1. 定期更新依赖包
2. 使用漏洞扫描工具
3. 订阅安全公告
4. 及时修复漏洞

## Security Configuration Examples

### HTTPS Configuration

```yaml
# 启用 HTTPS 访问
ports:
  - port: 443
    protocol: https
    certificate: auto  # 自动申请 Let's Encrypt 证书
```

### Secret Management

```yaml
# 使用密文配置
env:
  - name: DATABASE_PASSWORD
    value: ${SECRET:db-password}
  - name: API_KEY
    value: ${SECRET:api-key}
```

### Network Policy

```yaml
# 限制访问来源
access_control:
  - source: 10.0.0.0/8  # 仅允许内网访问
  - source: 192.168.1.100  # 特定 IP
```

## Security Monitoring

**What to Monitor**:
- 异常登录尝试
- 权限变更
- 敏感操作（删除、修改配置）
- 异常流量模式
- 漏洞扫描结果

**Alert Rules**:
- 连续登录失败 > 5 次
- 权限提升操作
- 敏感数据访问
- 发现高危漏洞

## Compliance

**Common Standards**:
- **GDPR**: 数据隐私保护
- **PCI DSS**: 支付卡行业标准
- **SOC 2**: 安全控制标准
- **ISO 27001**: 信息安全管理

**Rainbond Support**:
- 数据加密（传输和存储）
- 访问控制和审计
- 备份和恢复
- 安全配置管理

## Incident Response

**When a security incident occurs**:

1. **Contain**: 隔离受影响的组件
2. **Investigate**: 查看日志和审计记录
3. **Remediate**: 修复漏洞或配置
4. **Recover**: 恢复服务
5. **Review**: 总结经验，改进流程

**Use tools**:
- `get-component-logs`: 查看日志
- `restart-component`: 重启受影响组件
- 备份恢复: 回滚到安全状态
