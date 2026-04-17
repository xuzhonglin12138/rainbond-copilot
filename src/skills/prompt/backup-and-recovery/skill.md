# Backup and Recovery

> Guide users through backup and disaster recovery procedures

When users need to backup or recover their applications:

## Backup Strategies

### 1. Application Backup

**What to Backup**:
- 应用配置（环境变量、端口、存储等）
- 组件镜像和版本
- 依赖关系和拓扑
- 访问策略和域名配置

**How to Backup**:
1. 导出应用模板
2. 保存到应用市场或本地
3. 支持跨团队、跨集群分享

**Frequency**:
- 重大变更前：必须备份
- 定期备份：每周一次
- 自动备份：配置定时任务

### 2. Data Backup

**Stateful Components**:
- 数据库（MySQL, PostgreSQL, MongoDB）
- 缓存（Redis）
- 文件存储（上传文件、日志）

**Backup Methods**:

#### Database Backup
```bash
# MySQL 备份
mysqldump -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME > backup.sql

# PostgreSQL 备份
pg_dump -h $DB_HOST -U $DB_USER $DB_NAME > backup.sql

# MongoDB 备份
mongodump --host $DB_HOST --db $DB_NAME --out /backup
```

#### Volume Backup
- 使用 Rainbond 存储快照功能
- 定期复制到远程存储
- 使用云存储备份服务

**Backup Schedule**:
- 关键数据：每天备份
- 一般数据：每周备份
- 保留策略：7 天内每天，4 周内每周，12 个月内每月

### 3. Configuration Backup

**What to Backup**:
- 环境变量配置
- 密文配置
- 网络策略
- 监控告警规则

**How**:
1. 导出配置文件
2. 版本控制（Git）
3. 配置管理工具

## Recovery Procedures

### 1. Application Recovery

**Scenario**: 应用被误删除或配置错误

**Steps**:
1. 从应用市场恢复应用模板
2. 选择目标团队和集群
3. 配置必要的参数（域名、密码等）
4. 一键安装恢复

**Time**: 5-10 分钟

### 2. Data Recovery

**Scenario**: 数据丢失或损坏

**Steps**:

#### Database Recovery
```bash
# MySQL 恢复
mysql -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME < backup.sql

# PostgreSQL 恢复
psql -h $DB_HOST -U $DB_USER $DB_NAME < backup.sql

# MongoDB 恢复
mongorestore --host $DB_HOST --db $DB_NAME /backup/$DB_NAME
```

#### Volume Recovery
1. 停止组件（避免数据冲突）
2. 从快照或备份恢复数据
3. 验证数据完整性
4. 重启组件

**Time**: 根据数据量，10 分钟 - 数小时

### 3. Disaster Recovery

**Scenario**: 整个集群故障或数据中心不可用

**Prerequisites**:
- 异地备份
- 备用集群
- 恢复流程文档

**Steps**:
1. **评估损失**
   - 确认故障范围
   - 评估数据丢失情况

2. **准备环境**
   - 启动备用集群
   - 验证网络连通性

3. **恢复数据**
   - 从异地备份恢复数据
   - 验证数据完整性

4. **恢复应用**
   - 从应用模板恢复应用
   - 配置域名和访问策略

5. **切换流量**
   - 更新 DNS 记录
   - 切换到新集群

6. **验证服务**
   - 功能测试
   - 性能测试
   - 监控告警

**Time**: 1-4 小时（取决于数据量和复杂度）

## Backup Best Practices

### 1. 3-2-1 Rule
- **3** 份数据副本
- **2** 种不同存储介质
- **1** 份异地备份

### 2. Automated Backup
```yaml
# 定时备份任务示例
apiVersion: batch/v1
kind: CronJob
metadata:
  name: database-backup
spec:
  schedule: "0 2 * * *"  # 每天凌晨 2 点
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: mysql:8.0
            command:
            - /bin/sh
            - -c
            - mysqldump -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME > /backup/$(date +%Y%m%d).sql
```

### 3. Test Recovery Regularly
- 每月测试恢复流程
- 验证备份可用性
- 更新恢复文档
- 培训团队成员

### 4. Monitor Backup Status
- 备份成功/失败通知
- 备份文件大小监控
- 备份时间监控
- 存储空间监控

## Common Issues

### Backup Failed

**Causes**:
- 存储空间不足
- 权限问题
- 网络问题
- 数据库锁定

**Solutions**:
1. 检查存储空间
2. 验证权限配置
3. 检查网络连通性
4. 使用一致性备份方法

### Recovery Failed

**Causes**:
- 备份文件损坏
- 版本不兼容
- 配置错误
- 依赖缺失

**Solutions**:
1. 验证备份文件完整性
2. 检查版本兼容性
3. 核对配置参数
4. 安装必要依赖

### Data Inconsistency

**Causes**:
- 备份时数据仍在写入
- 多个组件数据不同步
- 事务未完成

**Solutions**:
1. 使用一致性快照
2. 停止写入后再备份
3. 使用事务性备份
4. 验证数据一致性

## Recovery Time Objective (RTO) & Recovery Point Objective (RPO)

### RTO (恢复时间目标)
- **关键业务**: < 1 小时
- **重要业务**: < 4 小时
- **一般业务**: < 24 小时

### RPO (恢复点目标)
- **关键数据**: < 15 分钟（实时同步）
- **重要数据**: < 1 小时（频繁备份）
- **一般数据**: < 24 小时（每日备份）

## Checklist

**Before Disaster**:
- ✅ 定期备份应用和数据
- ✅ 测试恢复流程
- ✅ 准备备用环境
- ✅ 文档化恢复步骤
- ✅ 培训相关人员

**During Disaster**:
- ✅ 保持冷静，按流程操作
- ✅ 及时沟通，通知相关方
- ✅ 记录操作日志
- ✅ 验证恢复结果

**After Disaster**:
- ✅ 总结经验教训
- ✅ 改进备份策略
- ✅ 更新恢复文档
- ✅ 加强监控告警
