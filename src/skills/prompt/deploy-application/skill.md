# Deploy Application

> Guide users through deploying applications on Rainbond

When a user wants to deploy an application, guide them through these steps:

## Deployment Methods

### 1. From Source Code (Git/SVN)
**Best for**: Custom applications with source code access

**Steps**:
1. 创建组件，选择"从源码构建"
2. 输入 Git 仓库地址（支持 GitHub, GitLab, Gitee 等）
3. 选择分支或标签
4. Rainbond 自动检测语言和框架（支持 Java, Node.js, Python, Go, PHP 等）
5. 配置构建参数（可选）
6. 点击"创建并构建"

**注意事项**:
- 确保代码仓库可访问（公开仓库或配置了访问凭证）
- 检查 Dockerfile 或 buildpack 配置
- 首次构建可能需要较长时间

### 2. From Docker Image
**Best for**: Pre-built container images

**Steps**:
1. 创建组件，选择"从镜像构建"
2. 输入镜像地址（如 `nginx:latest`, `mysql:8.0`）
3. 配置镜像仓库凭证（如果是私有镜像）
4. 设置启动命令和参数（可选）
5. 点击"创建"

**常用镜像**:
- Web 服务器: `nginx`, `apache`
- 数据库: `mysql`, `postgresql`, `mongodb`, `redis`
- 应用运行时: `node`, `python`, `openjdk`

### 3. From Application Template
**Best for**: Quick deployment of common stacks

**Steps**:
1. 进入应用市场
2. 选择应用模板（如 WordPress, GitLab, Nextcloud）
3. 配置应用参数（数据库密码、域名等）
4. 一键安装

## Post-Deployment Configuration

### 1. Port Configuration
- 添加端口映射（容器端口 → 服务端口）
- 开启对外访问（HTTP/HTTPS）
- 配置访问策略（域名、路径）

### 2. Environment Variables
- 设置应用配置（数据库连接、API 密钥等）
- 使用配置组管理共享配置
- 敏感信息使用密文存储

### 3. Storage
- 添加持久化存储（数据库数据、上传文件等）
- 配置存储路径和大小
- 选择存储类型（本地存储、NFS、云存储）

### 4. Health Check
- 配置健康检查（HTTP、TCP、命令）
- 设置检查间隔和超时时间
- 确保应用启动后能通过健康检查

## Common Issues

### Build Failed
- 检查源码是否正确
- 查看构建日志找出错误
- 确认依赖是否可访问

### Container Crash
- 查看组件日志
- 检查启动命令是否正确
- 确认环境变量配置

### Cannot Access
- 检查端口配置
- 确认对外访问已开启
- 验证域名解析
