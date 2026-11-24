# Codex 缓存诊断

先识别哪一层出现重复工作，再选择证据：输入 token 复用看模型 usage，传输增量看 WebSocket 基线，技能与工具更新看目录快照及失效，模型可见性看模型目录身份与刷新策略。它们不能合并为一个命中指标。

**适用范围与状态**：基于 `rust-v0.171.0`，提交 `ccf9be8cc458bd6b8336fe84d68d8893f2691a5e`，2026-11-23 静态源码核对；本文是诊断方法，未执行线上实验。需要先读[缓存策略与实现](../../../架构/运行机制/缓存策略与实现/README.md)，证据见该主题的[来源页](../../../架构/运行机制/缓存策略与实现/来源与适用边界.md)。

## 1. 指标与口径

| 问题 | 观察项 | 解读 |
|---|---|---|
| 模型复用了多少输入？ | Responses `usage.input_tokens_details.cached_tokens` | 服务端报告的输入缓存 token，不能仅靠相同 key 推定 |
| 新写入缓存多少？ | `usage.input_tokens_details.cache_write_tokens`，若 provider 返回 | 与缓存读取分开记录；不能把缺字段当作已测得零写入 |
| Codex 内部如何保存？ | `TokenUsage.cached_input_tokens`、`cache_write_input_tokens` | SSE 映射；其中 cache_write 默认可为 0 |
| app-server 如何对外提供？ | `thread/tokenUsage/updated` 的 `tokenUsage.last`、`tokenUsage.total`；字段为 `cachedInputTokens`、`cacheWriteInputTokens`、`inputTokens` | last 是最近一次统计，total 是累积；不要对累积 total 重复相加 |
| 网络是否增量？ | WebSocket 分支及 non-incremental 原因，是否携带 previous_response_id | 只表示传输续传，不等于模型端命中 |
| 本地加载是否复用？ | 对应模块的 cache hit／reload／clear 与扫描、发现调用 | 作用对象是文件或目录，不是模型 token |

来源 S11 给出了 usage 映射。不同 provider 和客户端可能不暴露全部字段，缺失、默认值与明确上报零应分开。

若同一统计范围内 `input_tokens > 0`，可计算：

```text
输入缓存 token 占比 = Σ cached_input_tokens / Σ input_tokens
```

这是按 token 加权的占比，不是“命中请求数／总请求数”，更不是费用节省比例。不要把 cached tokens 再加到 input tokens 上重复计数；评估费用还需当前模型的读、写、普通输入与输出计费规则。对 API-key 计费与 ChatGPT 订阅使用量也应分别解释。

## 2. 按现象排查

| 现象 | 优先核对 | 处理方向 |
|---|---|---|
| 同一会话 cached tokens 低 | 真实模型／provider、前缀变化、内容长度、路由键、间隔、服务端规则 | 保留完整请求的结构差异和 usage；不能只比较用户问题 |
| WebSocket 总发 full | no_previous_response、model_changed、tools_changed、input_shortened／mismatch、restored_history 等 | 找到最早变化的字段；核对上次响应是否完成、历史是否压缩或改写 |
| 有 previous_response_id 仍未见缓存读取 | 模型 usage 与其实际提供能力 | 传输续传成功不保证模型计算缓存驻留 |
| 修改本地 Skill 后仍见旧目录 | 实际技能根、加载配置键、是否注册 watcher、是否过滤／远端、通知及节流 | 使用宿主已有的 reload／refresh 路径；不能假定所有修改即时生效 |
| Cloud Skill 旧内容或反复发现 | auth／resource generation、partial／warning、退避与显式刷新 | 分辨正常退避、接受新目录后清空正文、旧代际读被拒绝 |
| MCP 目录可见但调用不可用 | 连接 ready 状态、当前认证、线程绑定、服务端声明变化 | 目录缓存不能修复连接或重新授权；实际调用错误独立诊断 |
| 模型列表与预期不同 | CODEX_HOME、版本、identity、TTL、ETag、发现开关及刷新策略 | 核对是否允许远端发现，以及是否退回 bundled／内存目录 |
| 重启后变慢 | 内存快照／连接丢失、磁盘目录是否仍有效 | 对比冷启动和常驻进程，分别测量各阶段 |

## 3. 可复现观察方案

以下是实验设计建议，本文未执行。使用只读任务或专用测试工具，避免重复触发真实副作用。

1. 固定 Codex 提交、模型、provider、认证方式、配置、workspace 状态、技能及 MCP 声明；记录请求间隔。
2. 在同一活跃会话完成首次请求，再追加一个简短问题；分别记录耗时、输入／输出／缓存读写 token，以及 WS full／incremental 状态。
3. 每轮只改变一个因素：工具顺序、技能内容、推理配置、模型，或执行上下文压缩。比对请求属性和 input 第一个差异，避免同时变化导致无法归因。
4. 分别做“同进程新线程”和“重启新进程”对照，区分进程缓存、线程快照、磁盘缓存与服务端前缀。
5. 验证失效正确性：更新技能、刷新目录、切换测试认证身份后，检查旧代际不再被误用。先验收新鲜度与隔离，再比较性能。

只记录必要的结构指纹、计数、版本与有界原因，诊断材料避免包含凭据或完整私有 prompt。短样本只能说明该次实验，不能推导固定 TTL、跨用户共享缓存或稳定成本收益。

## 4. 当前能控制什么

- 普通使用：保持无须变化的输入结构稳定，复用所需会话，更新已变化的真实知识。
- 宿主集成：按公开接口核对缓存键策略、turn 参数、生命周期和 refresh 行为；Core 存在某类型不等于 app-server 已公开相应字段。
- 外层 Agent Server：独立定义 Session／Project 缓存的 key、权限范围、版本及失效，不将其归为 Codex 已实现功能。

不提供未经核实的“清除全部 Codex 缓存”命令。清理本地文件不保证清除服务端 Prompt Cache，也可能丢失与当前问题无关的状态；应先定位具体缓存再操作。

[返回监控与诊断](../README.md) · [缓存策略与实现](../../../架构/运行机制/缓存策略与实现/README.md)
