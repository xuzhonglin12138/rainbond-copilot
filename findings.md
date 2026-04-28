# Findings & Decisions

## 2026-03-26 Vercel DX Research

### Requirements
- 目标不是简单复刻 Vercel 功能，而是复刻“用户通过 Codex / Claude Code 部署和管理应用时的顺滑体验”
- 输入前提：Rainbond 已经实现 MCP，需要分析还缺哪些体验层能力
- 输出需要面向实现：给出 Rainbond 的分阶段方案，而不是抽象点评

### Initial Research Findings
- Vercel 官方文档把开发者主路径拆得很清楚：登录/链接项目、部署、预览、查看日志、管理环境变量、域名与生产发布
- 这种路径天然适合 agent 编排，因为每一步都对应单一职责、低歧义的 CLI / API 动作
- Vercel 的顺滑感大概率来自“强约定优于配置”：项目绑定、构建默认值、预览 URL、生产 promote/rollback 都有默认路径
- 对 agent 来说，最关键的不只是“能部署”，而是“拿到明确状态回执和下一步动作”。
- 如果 Rainbond 只暴露底层 MCP 工具，而没有更高层的工作流抽象，用户体验会更像“拼 API”，不像“顺滑部署”

### Official Vercel UX Findings
- `vercel link` 把本地目录绑定到项目，并在本地生成 `.vercel` 配置；后续部署都围绕“已绑定项目”展开
- `vercel env pull` / `vercel pull` 让本地开发、构建、部署使用同一套环境上下文，这减少了 agent 决策时的歧义
- `vercel deploy` 默认创建 Preview Deployment，并直接把部署 URL 输出到标准输出，这对 agent 特别友好，因为它能把“部署结果”直接当作下游输入
- `vercel deploy --logs`、`vercel logs --deployment ...`、`vercel curl / --deployment ...` 形成了“部署 -> 验证 -> 诊断”闭环
- Vercel 区分 Preview / Production / Custom Environments，且 CLI 对这些环境是统一模型：`deploy --target=...`、`env add ... <env>`、`pull --environment=...`
- Vercel 支持 `vercel promote`、`vercel rollback`、Instant Rollback，说明“发布”和“构建”在体验上是解耦的
- `vercel --prod --skip-domain` 再配合 `vercel promote`，说明 Vercel 很强调“先产出部署，再控制域名切换”的两阶段模型
- Preview 有 branch-specific URL 和 commit-specific URL 两类地址，这让 agent 和人类都能稳定引用“当前版本”和“特定版本”
- CLI 文档特意强调 `stdout` 是 Deployment URL、`stderr` 和 exit code 用于错误处理，这种 I/O 约定非常适合 Codex / Claude Code 这种 agent 平台

### Agent-Centric Observations
- Vercel 不只是“提供 CLI”，而是在文档和 I/O 设计上默认 CLI 会被自动化系统和 agent 编排
- `vercel logs --json` 说明它显式考虑了机器消费日志，而不只是人类终端阅读
- `vercel curl` 把“验证某次部署是否真的可访问”抽象成了低摩擦原语，agent 无需自己绕一层域名与鉴权细节
- `vercel build` + `vercel deploy --prebuilt` 把“本地产物”和“远端发布”拆开，这使 agent 可以更安全地先验证再上线
- `vercel promote` / `vercel rollback` 让 agent 可以实现“先预览后切流”和“快速回退”，而不是每次重新构建
- `vercel pull` / `vercel env pull` 把“环境同步”抽象成第一等动作，agent 不必自己发散地处理本地 `.env` 与云端配置差异
- `vercel open` 这种命令虽然简单，但它体现出一个重要思路：CLI 和 Dashboard 不是割裂的，agent 能在需要时把用户无缝带回管理界面
- 域名能力也被做成标准 CLI 流程：`domains ls/add/inspect` 和 `dns add`，这让“上线 URL 是否真正可达”成为可编排动作

### Rainbond Current-State Findings
- Rainbond 当前 MCP 工具覆盖面已经很广，具备应用、组件、环境变量、端口、日志、构建、升级等底层能力
- 但从 agent 体验看，Rainbond 现在更像“底层动作全集”，还不是“高层部署工作流产品”
- 真实实验中，Rainbond 的部署链路存在多段隐式协议：
- 软件包构建需要先创建 `event_id`
- 再走 `upload_url`
- 且上传字段名必须是 `packageTarFile`
- 然后才进入 `package_build`
- 再进入检测/构建/部署
- 这些对前端是可见的，但对 agent 不够显式，容易造成流程碎片化
- Rainbond 当前 MCP streamable HTTP 会话行为不够稳定，对标准客户端存在兼容性问题
- 构建与部署虽然可追踪，但错误恢复仍偏“平台运维视角”，没有自动收敛成 agent 友好的下一步建议
- 真实部署实验还暴露了两个平台级问题：
- 资源不足会在较后阶段才暴露
- 垂直缩容接口存在后端 bug：`container_gpu cannot be null`
- 成功样例与失败样例之间的差别，目前还需要 agent 手动对比 build env 才能定位，这说明 Rainbond 还缺“推荐修复动作”层
- Rainbond 的访问地址虽然能自动生成，但还没有 Vercel 那种“Preview URL 是稳定一等对象”的产品心智

### Skill Design Findings
- 对当前需求，单个大而全 skill 不如按场景拆分更合适
- 推荐拆成 3 个 prompt skills：
- 外部工具集成：面向 Codex / Claude Code
- 内嵌 agent：面向 Rainbond 控制台内嵌体验
- 场景测试：面向 MCP 开发、联调与回归验证
- Skill 内容应同时覆盖：
- 用户最佳实践
- 场景化使用向导
- Rainbond 部署与运维领域知识
- Skill 不应暴露底层 MCP 细节给最终用户，而应强调高层 workflow 和稳定输出

### Experience Hypotheses
- Vercel 在 agent 场景中的优势，不只是功能全，而是“默认输出就是 agent 想消费的结构化下一步”
- “项目已绑定 + 预览默认存在 + 域名切换独立 + 回滚无重建”这 4 个点共同构成顺滑体验
- Rainbond 若想接近这个体验，需要把“部署工作流”从一堆分散动作提升为几个高层工作流 primitive
- Rainbond 要逼近 Vercel 体验，不能只做 MCP 暴露，还要补“项目绑定、部署工作流、验证、发布、回滚”这几个高层抽象
- 关键不是把所有平台能力都让 agent 直接操作，而是把最常见的目标路径压缩成少量稳定原语

### Resources
- Official Vercel docs search results (to expand in later phases)
- [Deploying a project from the CLI](https://vercel.com/docs/projects/deploy-from-cli)
- [vercel deploy](https://vercel.com/docs/cli/deploy)
- [vercel rollback](https://vercel.com/docs/cli/rollback)
- [Environments](https://vercel.com/docs/deployments/environments)
- [Vercel CLI Overview](https://vercel.com/docs/cli)
- [Deploying Projects from Vercel CLI](https://vercel.com/docs/cli/deploying-from-cli)
- [vercel logs](https://vercel.com/docs/cli/logs)
- [vercel curl](https://vercel.com/docs/cli/curl)
- [vercel pull](https://vercel.com/docs/cli/pull)
- [vercel env](https://vercel.com/docs/cli/env)
- [Promoting a preview deployment to production](https://vercel.com/docs/deployments/promote-preview-to-production)
- [Accessing deployments through generated URLs](https://vercel.com/docs/concepts/deployments/generated-urls)
- [Setting up a custom domain](https://vercel.com/docs/domains/set-up-custom-domain)

## Requirements
- 目标是实现类似 `Rainbond AI Copilot 交互原型.tsx` 的交互效果
- 底层核心希望采用 OpenClaw 风格 agent runtime
- 功能和能力通过扩展 skills 实现
- Rainbond 的具体平台动作需要判断应落在 MCP、skills，还是混合架构
- 聊天窗口要支持三类体验：了解 Rainbond、排错、自动执行操作
- 用户切换到 Rainbond 某个页面时，agent 要理解当前上下文
- 若发生操作或诊断流程，页面需要出现高亮、聚焦或步骤反馈
- 第一阶段集成入口已明确：Rainbond Web 控制台右侧抽屉
- 第一版就支持真实操作，不只做解释和诊断
- Rainbond 动作优先封装在 skills 中，以便按需扩展能力
- 当前优先级调整为：第一阶段先不集成真实 Rainbond，只实现完整的 OpenClaw 风格 agent runtime 原型
- 第一阶段要能“理解 Rainbond”这一领域，并允许后续自行扩展 skills
- 第二阶段再对接 Rainbond 的真实 skills、MCP 与页面展示互动
- 第一阶段的能力范围已确定为“标准内核”
- Skills 机制采用混合模式：统一 skill 接口，底层同时支持 `SKILL.md` 与代码插件
- 审批策略采用分级型：高风险操作审批，低风险操作自动执行

## Research Findings
- 当前项目目录只有一个高保真交互原型文件：`Rainbond AI Copilot 交互原型.tsx`
- 原型已经明确了关键 UX：聊天侧栏、工具调用可见、页面节点高亮、审批卡片、执行后状态联动
- 原型中的“agentic loop”实际包含 5 类事件：用户消息、tool call、UI action、AI text、approval
- 从产品结构看，Rainbond Copilot 不只是 chat agent，还需要“页面上下文输入通道”和“页面动作输出通道”
- 由于入口是 Web 控制台右侧抽屉，前端需要和当前路由、选中资源、当前页面组件状态建立事件桥接
- 用户更倾向于把 Rainbond 动作放进 skills，而不是直接暴露为独立 MCP 接口层
- 当前任务已从“直接做 Rainbond 集成”收窄为“先做 runtime 内核 + 领域技能扩展机制”
- 因此第一阶段的设计重点应转向 runtime 能力拆解，而不是 Rainbond API 对接细节
- “标准内核”包含：会话、流式回复、skills 加载、工具调用、审批卡、可见 tool trace、子 agent、任务分解、记忆/工作区文件、UI action 事件
- Skills 不会只做 OpenClaw 式文档技能，也不会只做代码插件，而是两者并存
- 审批机制需要被 runtime 一等支持，因为原型里审批卡片是核心交互，不是单独的前端补丁
- 架构方案已确定为 Hybrid Runtime：agent 只面对统一 skill 接口，底层同时支持 Prompt Skill 与 Action Skill
- 整体架构分为 6 层：UI Drawer、Gateway、Agent Runtime、Session Store、Workspace/Memory Files、Skill Registry、UI Action Bus、Action Adapter
- 该分层已得到确认，可以继续细化事件模型与状态机
- 事件模型与状态机设计已确认：runtime 必须产出独立事件流，而不只是文本回复
- Skill 系统设计已确认：统一 skill 接口，Prompt Skill 负责认知，Action Skill 负责执行，审批和 UI action 由 runtime 统一承接
- 会话、记忆与 workspace 文件模型已确认：需要显式 session state、事件 transcript、结构化 memory 和 OpenClaw 风格 workspace files
- UI 事件协议已确认：前端消费归一化事件流，审批必须回到 runtime 恢复执行，页面联动通过正式 `ui.effect` 协议驱动

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 先围绕事件模型设计 | 原型的本质是一个事件驱动 UI，而不是单纯对话框 |
| 重点比较 MCP 与 skills 的边界，而不是二选一 | 两者大概率是上下层关系，不是替代关系 |
| 第一版允许执行真实操作 | 需要从一开始就设计审批、回滚和页面动作反馈 |
| Rainbond 平台动作优先由 skills 暴露给 agent | 更符合用户预期的扩展方式 |
| 第一阶段不接真实 Rainbond，先做完整 runtime 壳和可扩展技能框架 | 降低外部依赖，先验证 agentic 核心体验 |
| 第一阶段以“标准内核”为目标 | 对齐交互原型，又控制实现复杂度 |
| Skills 采用混合装载模型 | 兼顾 OpenClaw 的灵活扩展与 Rainbond 动作的强约束实现 |
| 审批采用分级策略 | 在安全性与交互效率之间做平衡，接近真实 Copilot 体验 |
| 选择 Hybrid Runtime 而不是纯 skill-first 或 MCP-first | 兼顾首阶段体验速度与二阶段架构演进空间 |
| Skill 元数据统一承载 schema、risk、approval 与 executor 信息 | 保证 runtime 可以统一治理执行、审批和 trace |
| 第一阶段即引入显式 workspace 文件层 | 让调试、回放、记忆沉淀和二阶段扩展都更可控 |
| UI 只消费 Gateway 归一化后的事件协议 | 保持前端稳定，屏蔽 runtime 内部事件演进 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 当前目录没有实际项目源码，只有交互原型 | 先以交互原型为需求源，输出架构设计 |

## Resources
- `/Users/liufan/Code/openclaw/Rainbond AI Copilot 交互原型.tsx`
- `/Users/liufan/Code/openclaw/task_plan.md`
- `/Users/liufan/Code/openclaw/findings.md`
- `/Users/liufan/Code/openclaw/progress.md`
- `/Users/liufan/Code/openclaw/docs/plans/2026-03-13-rainbond-copilot-design.md`
- `/Users/liufan/Code/openclaw/docs/plans/2026-03-13-rainbond-copilot-implementation.md`

## Visual/Browser Findings
- 原型左侧是 Rainbond 应用拓扑，右侧是 AI chat drawer
- 聊天流里显式展示了 `tool_call` 与 `action`
- 人工审批卡片出现于高风险操作之前
- 页面高亮通过 `highlightedNode` 驱动，可视化反馈与 AI 回复是同步的

## 2026-04-03 Gemma 4 for RainAgent Research

### Initial Project Findings
- 当前项目的运行时模型接入主要落在 `src/llm`，现有 provider 只有 `openai` 与 `anthropic`
- `src/runtime/agent-runtime.ts` 和 `src/runtime/planner.ts` 都依赖“聊天补全 + tool calling”的工作方式，而不是单纯文本生成
- 当前项目存在 `MODEL_COMPATIBILITY.md` 与 `MODEL_CONFIGURATION_GUIDE.md`，说明项目已经考虑“通过兼容层接入不同模型服务”，而不一定强耦合某一家官方 SDK
- 因此评估 Gemma 4 时，关键不是“Google 是否原生支持本项目”，而是“Gemma 4 是否能通过兼容 OpenAI 的 serving 层稳定提供 tool calling / structured output / 足够上下文”

### Initial Evaluation Dimensions
- 模型能力：推理、中文、代码、长上下文、工具调用、结构化输出
- 部署能力：是否开放权重、是否允许商用/内置、是否能自托管
- 工程兼容性：是否容易挂到现有 OpenAI-compatible adapter
- 平台可运营性：显存成本、并发吞吐、是否适合作为 Rainbond 内置默认模型

### Official Gemma 4 Findings
- Google 于 2026-04-02 正式发布 Gemma 4，官方定位为 “most capable open models to date”，并明确强调适用于 `agentic workflows`
- Gemma 4 采用 Apache 2.0 许可；Google Open Source Blog 明确称这是 Gemmaverse 首批按 OSI-approved Apache 2.0 发布的模型，意味着商用与内置分发障碍相比旧版大幅降低
- 官方发布页明确写出 Gemma 4 原生支持 `function-calling`、`structured JSON output` 和 `system instructions`
- 官方 Hugging Face 模型卡进一步确认 Gemma 4 支持 `system` 角色、`Function Calling`、可配置 `thinking mode`，并可解析结构化响应
- 上下文窗口方面，小模型 E2B/E4B 为 128K，26B A4B 与 31B 为 256K
- 模型规模与部署形态分四档：
- E2B / E4B：偏 edge / on-device，支持 text + image + audio
- 26B A4B MoE：总参数 25.2B，推理时激活 3.8B，强调“接近 4B 速度”
- 31B Dense：强调最高质量
- 官方发布页称 26B/31B 的 bf16 权重可放进单张 80GB H100；量化版本可运行在消费级 GPU 上
- 官方发布页还给出 day-one 生态支持：Transformers、vLLM、llama.cpp、Ollama、NVIDIA NIM、MLX、SGLang 等
- 官方文档称 Gemma 4 支持 140+ 语言；Hugging Face 模型卡对外描述为 “out-of-the-box support for 35+ languages, pre-trained on 140+ languages”，说明多语言覆盖很广，但“默认高质量可直接使用”的语言范围和“训练覆盖语言范围”需要区分
- 对 RainAgent 相关性最高的能力是：
- 原生工具调用
- 原生 JSON/结构化输出
- 长上下文
- 代码和推理能力
- 可本地或私有化部署

### RainAgent Compatibility Findings
- `src/llm/openai-client.ts` 直接使用 OpenAI Node SDK 的 `chat.completions.create()`，并把 `tools` 作为 OpenAI function calling 结构传给后端
- `src/runtime/agent-runtime.ts` 假设模型返回 `message.tool_calls`，并要求 `finish_reason` 能标记 `tool_calls`
- 因此当前 RainAgent 对底层模型的真实协议要求，不是“必须是 OpenAI 模型”，而是“必须提供足够兼容 OpenAI Chat Completions + Tool Calling 的服务端”
- `src/llm/config.ts` 允许为 OpenAI provider 注入自定义 `baseURL`，说明只要部署一个 OpenAI-compatible endpoint，理论上就能把任意合适模型接入现有 runtime
- `docs/phase-1.5-progress.md` 和 `QUICKSTART.md` 都写明当前系统支持“兼容 OpenAI 格式的其他 API”，这进一步降低了接入 Gemma 4 的代码改造门槛
- 当前项目的主要技术风险不在“能否连通 HTTP API”，而在：
- 返回格式是否真的兼容 `tool_calls`
- tool calling 稳定性是否足够支撑多轮 agent loop
- 中文和运维问答质量是否达到 Rainbond 场景要求

### Serving and Deployment Findings
- vLLM 官方 Gemma 4 配方已明确支持通过 `OpenAI SDK` 方式调用 Gemma 4，并将服务暴露在 `http://localhost:8000/v1` 这类 OpenAI-compatible API 上
- 同一份 vLLM 官方文档给出了 Gemma 4 的 `Function Calling / Tool Use` 示例，返回 `message.tool_calls`，并支持把 `tool` 角色结果回填继续推理，这与当前 `AgentRuntime` 的工作方式高度一致
- vLLM 官方文档还给出了 `Structured Outputs` 示例，支持 `response_format: { type: \"json_schema\" }`，这意味着 Gemma 4 在兼容 serving 层下能满足后续更强结构化输出需求
- Gemma 4 的 OpenAI-compatible tool calling 不是零配置可得；vLLM 官方要求启动时显式打开 `--enable-auto-tool-choice`、`--tool-call-parser gemma4`，如需 reasoning/thinking 还要加 `--reasoning-parser gemma4`
- 因此 Rainbond 如果要“内置 Gemma 4”，不能只内置模型权重，还必须内置一套正确配置好的 serving 模板
- vLLM 官方文档给出的最小 BF16 部署门槛是：
- E2B / E4B：1 张 24GB+ GPU
- 26B A4B：1 张 80GB GPU
- 31B：1 张 80GB GPU
- 这意味着“能内置”与“适合默认内置”是两回事：
- 作为可选内置模型服务：可行
- 作为所有 Rainbond 用户默认自带模型：门槛仍然偏高

### Benchmark and Quality Signals
- 官方 Hugging Face 模型卡显示 31B 在 MMLU Pro 85.2%、AIME 2026 no tools 89.2%、LiveCodeBench v6 80.0%、MMMLU 88.4%
- 26B A4B 也较强：MMLU Pro 82.6%、AIME 2026 no tools 88.3%、LiveCodeBench v6 77.1%、MMMLU 86.3%
- 小模型 E4B/E2B 能力明显低一个台阶，尤其在编码和复杂推理上与 26B/31B 差距较大
- 结合这些官方 benchmark，可以合理推断：
- 26B A4B / 31B 有资格进入 RainAgent 主力候选名单
- E2B / E4B 更适合作为轻量 FAQ、边缘端或低成本试验模型，而不适合作为默认自治 agent 主模型

### Risk Findings
- 官方模型卡明确提醒 Gemma 4 在开放式复杂任务、事实准确性、常识判断上仍有局限，且可能输出错误或过时信息
- 对 Rainbond 场景，这意味着它可以承担 Copilot / Agent 基础能力，但不能替代审批、工具结果校验和运维安全护栏
- 由于当前项目强依赖中文问答和 Rainbond 运维语境，Gemma 4 的中文可用性虽有官方多语言背书，但仍需针对中文运维问答、日志诊断、工具选择做专门验证
- 另一个现实风险是默认上下文虽然很大，但 vLLM 官方文档也建议按 workload 主动降低 `--max-model-len` 以节约 KV cache；这意味着在 Rainbond 内置方案里，需要把“上下文长度 / 显存 / 并发”作为可调策略，而不是一刀切开满 128K/256K

### Follow-up Verification: E2B/E4B, Low Memory, and CPU
- 需要先纠正一个潜在歧义：截至当前这次核验，Google 官方 `Gemma 4 model card` 明确写出 Gemma 4 家族包含 `E2B`、`E4B`、`26B A4B`、`31B` 四个尺寸，不是只有 26B/31B
- Google 官方同时说明 E2B/E4B 面向 `high-end phones`、`laptops` 等 on-device 场景，并强调其 `effective parameters` 与较低内存占用
- Unsloth 中文文档给出更细的本地推理经验值：
- E2B：4-bit 约 `4 GB`，8-bit `5–8 GB`，BF16/FP16 `10 GB`
- E4B：4-bit 约 `5.5–6 GB`，8-bit `9–12 GB`，BF16/FP16 `16 GB`
- 同页还特别说明这类数值是 `总内存 = RAM + VRAM / 统一内存` 的经验值，而且上下文窗口越大，需要的额外内存越多
- 这比用户提到的“5GB / 15GB”更细一些，也更接近真实部署判断：低位量化下小模型确实可以落在个位数 GB 到十几 GB 总内存区间
- 关于 CPU，可确认方向是“能跑”：
- Google 官方 `Run Gemma` 页面明确说某些执行框架如 `Ollama` 和 `gemma.cpp` 可以让 Gemma 在更常见的 x86/ARM CPU 上运行
- Google 官方 `gemma.cpp` 教程明确称它是 `CPU inference` 研究/实验用轻量 C++ runtime
- Unsloth 文档也给出 `llama.cpp` 的 CPU 推理路径
- 但对 RainAgent / Rainbond 的判断必须再加一句：CPU 可跑 != 适合默认承担交互式 agent 主模型
- 低位量化 + CPU 对单轮问答、轻量助手、演示或边缘部署是可行的
- 但对多轮 tool-calling、长上下文、日志诊断、中文运维问答这类 agent 负载，纯 CPU 的时延和并发能力大概率仍是主要瓶颈
