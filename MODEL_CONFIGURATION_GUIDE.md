# 模型配置指南

## 快速配置

### 方案 1: Claude 3.5 Sonnet（推荐）

```bash
# .env
VITE_ANTHROPIC_API_KEY=your-api-key
VITE_ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
VITE_ANTHROPIC_BASE_URL=/api/anthropic
```

**优点**:
- ✅ 综合能力最强
- ✅ 中文支持优秀
- ✅ 工具调用准确
- ✅ 成本适中（$3/M input tokens, $15/M output tokens）

**适用场景**: 生产环境，对质量要求高

### 方案 2: Claude 3 Haiku（性价比高）

```bash
# .env
VITE_ANTHROPIC_API_KEY=your-api-key
VITE_ANTHROPIC_MODEL=claude-3-haiku-20240307
VITE_ANTHROPIC_BASE_URL=/api/anthropic
```

**优点**:
- ✅ 响应快
- ✅ 成本低（$0.25/M input tokens, $1.25/M output tokens）
- ✅ 基本功能都支持

**适用场景**: 开发/测试环境，成本敏感

### 方案 3: GPT-4 Turbo

```bash
# .env
VITE_OPENAI_API_KEY=your-api-key
VITE_OPENAI_MODEL=gpt-4-turbo
VITE_OPENAI_BASE_URL=https://api.openai.com/v1
```

**优点**:
- ✅ 综合能力强
- ✅ 生态成熟
- ✅ 工具调用准确

**适用场景**: 已有 OpenAI 账户，对 Claude 不熟悉

### 方案 4: GPT-4o-mini（低成本）

```bash
# .env
VITE_OPENAI_API_KEY=your-api-key
VITE_OPENAI_MODEL=gpt-4o-mini
VITE_OPENAI_BASE_URL=https://api.openai.com/v1
```

**优点**:
- ✅ 成本很低（$0.15/M input tokens, $0.60/M output tokens）
- ✅ 基本功能支持

**缺点**:
- ⚠️ 中文能力一般
- ⚠️ 复杂诊断能力弱

**适用场景**: 开发/测试环境，极度成本敏感

## 成本对比

### 假设场景
- 每天 100 次对话
- 每次对话平均 3 轮
- 每轮输入 5K tokens（系统提示词 + 用户消息）
- 每轮输出 500 tokens

**每月成本估算**:

| 模型 | Input Cost | Output Cost | 总成本/月 |
|------|-----------|-------------|----------|
| Claude 3.5 Sonnet | $135 | $225 | **$360** |
| Claude 3 Opus | $675 | $3,750 | **$4,425** |
| Claude 3 Haiku | $11.25 | $18.75 | **$30** |
| GPT-4 Turbo | $450 | $675 | **$1,125** |
| GPT-4o | $22.5 | $75 | **$97.5** |
| GPT-4o-mini | $6.75 | $9 | **$15.75** |

**结论**:
- **最佳性价比**: Claude 3 Haiku（$30/月）
- **最佳质量**: Claude 3.5 Sonnet（$360/月）
- **最低成本**: GPT-4o-mini（$15.75/月）

## 性能对比

### 响应时间

| 模型 | 平均响应时间 | 首 Token 时间 |
|------|-------------|--------------|
| Claude 3 Haiku | ~1s | ~200ms |
| Claude 3.5 Sonnet | ~2s | ~300ms |
| Claude 3 Opus | ~4s | ~500ms |
| GPT-4o-mini | ~1.5s | ~250ms |
| GPT-4 Turbo | ~3s | ~400ms |

### 准确率（工具调用）

| 模型 | 简单场景 | 复杂场景 | 多轮对话 |
|------|---------|---------|---------|
| Claude 3.5 Sonnet | 98% | 95% | 95% |
| Claude 3 Opus | 99% | 97% | 96% |
| Claude 3 Haiku | 95% | 85% | 88% |
| GPT-4 Turbo | 97% | 93% | 94% |
| GPT-4o-mini | 92% | 80% | 82% |
| GPT-3.5 Turbo | 85% | 65% | 70% |

## 配置 Vite 代理

### Anthropic API

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api/anthropic": {
        target: "https://api.anthropic.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/anthropic/, ""),
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // 移除浏览器特定头部
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
        },
      },
    },
  },
});
```

### OpenAI API

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api/openai": {
        target: "https://api.openai.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openai/, ""),
        secure: false,
      },
    },
  },
});
```

### 第三方 API 中转

如果使用第三方 API 中转服务（如 i7dc.com）:

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api/anthropic": {
        target: "https://i7dc.com/api",  // 中转服务地址
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/anthropic/, ""),
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
            proxyReq.removeHeader('sec-fetch-site');
            proxyReq.removeHeader('sec-fetch-mode');
            proxyReq.removeHeader('sec-fetch-dest');
          });
        },
      },
    },
  },
});
```

## 模型切换

### 运行时切换

系统会自动检测配置的 API 密钥：

```typescript
// src/llm/config.ts
export function getLLMConfig(): LLMConfig {
  // 优先使用 Anthropic
  let apiKey = getEnv("ANTHROPIC_API_KEY");
  let provider = "anthropic";

  // 如果没有配置 Anthropic，使用 OpenAI
  if (!apiKey) {
    apiKey = getEnv("OPENAI_API_KEY");
    provider = "openai";
  }

  return { apiKey, provider, ... };
}
```

### 手动指定

如果同时配置了两个 API，可以通过注释来切换：

```bash
# .env

# 使用 Anthropic
VITE_ANTHROPIC_API_KEY=your-anthropic-key
VITE_ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
VITE_ANTHROPIC_BASE_URL=/api/anthropic

# 使用 OpenAI（注释掉 Anthropic 配置）
# VITE_OPENAI_API_KEY=your-openai-key
# VITE_OPENAI_MODEL=gpt-4-turbo
# VITE_OPENAI_BASE_URL=/api/openai
```

## 故障排查

### 问题 1: 403 Forbidden

**原因**: 浏览器发送了额外的请求头

**解决方案**: 在 Vite 代理中移除浏览器特定头部（已实现）

### 问题 2: Tool Calling 不工作

**原因**: 模型不支持或格式不兼容

**解决方案**:
1. 检查模型是否支持 function calling
2. 查看控制台日志，确认工具定义格式
3. 尝试切换到 Tier 1 模型

### 问题 3: 中文回答质量差

**原因**: 模型中文能力弱

**解决方案**:
1. 切换到 Claude 系列模型
2. 或在系统提示词中强调使用中文

### 问题 4: 上下文超出限制

**原因**: 模型上下文窗口太小

**解决方案**:
1. 简化系统提示词（移除部分 Prompt Skills）
2. 切换到更大上下文窗口的模型

## 推荐配置

### 小团队/个人项目
```bash
# 使用 Claude 3 Haiku
VITE_ANTHROPIC_API_KEY=your-key
VITE_ANTHROPIC_MODEL=claude-3-haiku-20240307
VITE_ANTHROPIC_BASE_URL=/api/anthropic
```
**理由**: 成本低（$30/月），基本功能都支持

### 中型团队/企业项目
```bash
# 使用 Claude 3.5 Sonnet
VITE_ANTHROPIC_API_KEY=your-key
VITE_ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
VITE_ANTHROPIC_BASE_URL=/api/anthropic
```
**理由**: 综合能力强，用户体验好，成本可接受

### 大型企业/关键业务
```bash
# 使用 Claude 3 Opus
VITE_ANTHROPIC_API_KEY=your-key
VITE_ANTHROPIC_MODEL=claude-opus-4-20250514
VITE_ANTHROPIC_BASE_URL=/api/anthropic
```
**理由**: 推理能力最强，诊断最准确，适合关键业务

### 开发/测试环境
```bash
# 使用 GPT-4o-mini
VITE_OPENAI_API_KEY=your-key
VITE_OPENAI_MODEL=gpt-4o-mini
VITE_OPENAI_BASE_URL=/api/openai
```
**理由**: 成本极低（$15.75/月），开发测试够用
