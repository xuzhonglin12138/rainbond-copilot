# Task Plan: Evaluate Gemma 4 for RainAgent and Rainbond Embedding

## Goal
调研 Google 最新发布的 Gemma 4 是否适合作为 RainAgent 的底层大模型，并判断如果采用它，Rainbond 是否具备“内置模型能力”的现实可行性。

## Current Phase
Phase 4

## Phases
### Phase 1: Gather Project Requirements
- [x] 梳理 RainAgent 当前模型接入方式、协议要求和 agent 运行依赖
- [x] 提取 Rainbond 第二阶段对底层模型的关键要求
- **Status:** complete

### Phase 2: Research Gemma 4
- [x] 查阅 Gemma 4 官方资料，确认模型形态、许可、上下文、推理能力、多模态与部署方式
- [x] 查阅 Gemma 4 是否支持 tool/function calling、结构化输出与 agent 场景
- **Status:** complete

### Phase 3: Evaluate Fitness for RainAgent
- [x] 对照 RainAgent 当前 OpenAI/Anthropic 风格接入层评估兼容性
- [x] 对照 Rainbond 内置部署诉求评估算力、部署形态和运维复杂度
- **Status:** complete

### Phase 4: Produce Recommendation
- [x] 给出是否建议作为底层模型的结论
- [x] 给出落地路径、风险和下一步验证方案
- **Status:** complete

## Key Questions
1. Gemma 4 是否具备 RainAgent 所需的工具调用、长上下文、中文能力和稳定结构化输出？
2. Gemma 4 是否能通过兼容 OpenAI 的 serving 层接入当前项目，而无需大改 runtime？
3. 如果 Rainbond 想内置 Gemma 4，部署门槛主要卡在许可、显存、吞吐，还是运维复杂度？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 本轮优先用官方资料做事实核验 | Gemma 4 是最新发布信息，时效性强 |
| 结论要同时覆盖“能不能接 RainAgent”和“能不能被 Rainbond 内置” | 用户关心的是技术可行性和产品化路径 |
| 先判断最小可行接入，再判断是否适合作为默认内置模型 | 避免把“可接入”误判成“适合默认内置” |
| 将结论分成“能接入 / 适合试点 / 默认内置”三个层级 | 方便后续产品和工程分别决策 |
| 推荐优先评估 Gemma 4 26B A4B + vLLM | 兼顾 agent 能力、OpenAI-compatible 接入和部署现实性 |
| 不建议把 Gemma 4 作为所有 Rainbond 安装默认自带模型 | GPU 门槛与运维复杂度仍然偏高 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       | 1       |            |

## Notes
- 需要优先查阅 Google 官方发布、Gemma 文档、Hugging Face 官方模型卡等一手资料
- 需要结合项目内 `src/llm` 与 `MODEL_COMPATIBILITY.md` 判断协议兼容性
- 结论应区分：技术可接入、适合试点、适合默认内置，这三个层级
- 当前结论：
- 技术可接入：是
- 适合做 RainAgent 试点底模：是，优先 26B A4B，其次 31B
- 适合做 Rainbond 默认内置模型：暂不建议
