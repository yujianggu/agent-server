# Codex 缓存策略与实现

Codex 的缓存分布在模型服务、模型请求客户端、技能与工具发现、元数据解析等不同层。客户端通过稳定请求内容和路由键帮助复用模型前缀计算，通过 WebSocket 保存连接和续传基线，并在本地用快照、LRU、内容指纹、身份隔离和主动失效减少重复发现与解析。

**适用范围**：OpenAI `openai/codex` 的 `rust-v0.171.0`，固定提交 `ccf9be8cc458bd6b8336fe84d68d8893f2691a5e`。核验日期：2026-11-23。本文基于源码与已有测试的静态核对，未运行该版本集成测试或测量线上命中率。源码能证明客户端如何请求和管理状态，不能证明私有模型后端的淘汰算法、实际驻留时间或一次请求必然命中。第三方 provider、桌面客户端与云端托管能力需分别核验。

## 1. 先分清缓存对象

| 层次 | 保存或复用什么 | 主要收益 | 不代表什么 |
|---|---|---|---|
| 模型端 Prompt Cache | 匹配前缀的模型计算状态 | 减少重复输入计算，影响延迟与费用 | 复用完整回答、跳过新一轮推理 |
| WebSocket 会话状态 | 连接、上次完整请求、已完成响应 ID 和输出项 | 少建连接、增量发送 input | 模型端一定命中、历史免费 |
| 模型目录 | provider 返回的模型能力元数据 | 少请求模型目录端点 | 保存模型权重或模型答案 |
| Host／Cloud／Executor Skills | 发现目录、解析快照，部分云端资源正文 | 少扫描与少读取 | 所有 SKILL.md 永久不再读取 |
| MCP 工具目录 | 工具声明及目录元数据 | 减少发现等待，允许合格场景先暴露目录 | 缓存工具执行结果或跳过权限检查 |
| 插件清单 | 同一内容版本的解析结果 | 少重复解析和校验 | 完全避免文件读取 |
| 会话审批决定 | 针对相应键的会话内批准 | 减少重复审批询问 | 允许所有后续操作 |

实现文件和证据索引见[来源与适用边界](来源与适用边界.md)；逐步调用逻辑见[实现逻辑](实现逻辑.md)。下文的常量均是该源码版本的实现细节，不是稳定配置契约。

## 2. 模型端 Prompt Cache：客户端控制请求，服务端决定复用

### 2.1 缓存键与请求组装

`ModelClient` 的 `PromptCacheKey` 有三个策略：

- `SessionDerived`：默认；通常使用 metadata 中的 session ID。显式 session ID override 优先；特定 Internal 会话有 parent thread ID 时使用 `source:parent_thread_id`。
- `Custom(String)`：请求体使用宿主指定的稳定键。
- `Omit`：不发送请求体 `prompt_cache_key`，不表示关闭服务端缓存。

请求体缓存键与会话身份分开管理。子 agent 会继承相关策略；特殊 fork 可共享缓存路由，同时保留自身会话身份。ChatGPT 路径还通过 Responses 的 session-id 请求头取得缓存亲和性，不能只观察 JSON 请求体判断全部路由。参见来源 S1、S2。

组装请求时，Codex 把 base instructions 转为 input 前缀项，以线程命名空间和可见内容生成稳定 ID；普通 Responses 的工具声明在 tools 字段，Responses Lite 路径另有 AdditionalTools 前缀。不能把概念图中的“System → Skills → Tools → Conversation”当作所有模型的固定线缆格式。

### 2.2 TTL 是请求能力，不是统一 CLI 开关

该版本的 `PromptCacheTtl` 包含 `ThirtyMinutes` 与 `TwelveHours`，序列化为 `30m`、`12h`。当当前 turn 的 `prompt_cache_ttl` 有值时，客户端写入 `prompt_cache_options.ttl`；没有值时省略该字段。标准 app-server 的 turn processor 在所核对路径中设置为 `None`，所以 Core 支持该类型不等于 CLI 或 app-server 已向用户公开同名参数。不要据此添加未经核对的 `--prompt-cache-ttl` 或 TOML 字段。参见 S1、S3。

按核验日的[官方 Prompt caching 文档](https://developers.openai.com/api/docs/guides/prompt-caching)，缓存依赖可复用前缀；相同 key 不能使不同前缀等价，也不能保证命中。TTL、最小可缓存长度、路由与计费规则依模型而异；新模型的 `30m`／`12h` 是最低保留时长请求，不是删除期限。旧模型可能使用不同 retention 字段，不能把所有模型统一解释成固定 5 分钟或 24 小时。该文档是核验日 API 背景，不用于证明本版本所有 provider 均支持这些能力。

### 2.3 稳定内容为何重要

后续请求若保留相同的早期内容并追加工具结果，较容易继续复用已有前缀。修改早期指令、重排工具声明、更新技能目录或改写历史，都可能改变可复用部分。保持内容稳定是优化建议，不能为了命中率保留过期技能、错误项目文件或已撤回权限。

恢复会话、上下文压缩与 fork 会改变上下文或路由条件；“可以继续聊”不等于旧的模型缓存仍然驻留。完整请求重发也可能复用服务端前缀，不能仅凭网络包变大判断缓存失效。

## 3. WebSocket 复用：保存续传基线，发送新增项

客户端维护 session 级状态，并在 turn 结束时把 `WebsocketSession` 放回 `ModelClient`，供后续 turn 取用。其关键状态是：连接、认证归属、连接键、`last_request` 和承载上一响应的 receiver。

增量复用需同时满足：

1. 能取得上一轮已完成响应，并且 response ID 非空。
2. 模型、tools、tool choice、推理设置、服务层级、缓存键和缓存选项等需要保持一致的请求属性不变。
3. 当前 input 的前缀逐项等于“上一请求 input ＋ 上一响应追加的输出项”。

满足时发送 `previous_response_id` 与剩余新增 input；否则使用完整 input。这里比较的是响应项的语义结构，少数内部元数据会被归一化，影响工具结果的元数据变更仍会阻止增量复用。完整属性清单和算法见[实现逻辑](实现逻辑.md)。

连接关闭、provider／认证修订／相关 headers 或 runtime 状态变化可触发连接重置；认证归属变化先丢弃旧状态。WebSocket 路径触发 HTTP fallback 后，该 `ModelClient` 会话余下 turn 保持 HTTP，并清空保存的 WebSocket 状态。preconnect 只建立连接；prewarm 使用 `generate=false` 的准备请求，不代表已产生一次普通回答或确保 Prompt Cache 命中。参见 S1。

## 4. 本地缓存：各自管理生命周期

| 缓存 | 身份／键 | 保存位置与上限 | 更新或失效策略 |
|---|---|---|---|
| 模型目录 | 客户端版本＋provider／认证 identity；可按 originator 分区 | 默认文件后端为 `$CODEX_HOME/models_cache.json`，默认 TTL 300 秒；另有当前内存目录 | 文件新鲜度、版本、identity 不符即不复用；ETag 变化刷新；访问或凭据拒绝可作废目录 |
| Host Skills 配置快照 | skill roots、scope、插件身份／namespace、文件系统访问键、规则、插件快照等 | 服务实例内 config 缓存最多 32 项；另有受条件限制的 cwd 快速缓存 | 配置键变化重建；force reload／clear_cache／extra roots 变化主动失效；不是统一 TTL |
| 内置系统 Skills | 内嵌技能目录的指纹 | `$CODEX_HOME/skills/.system` 与 marker 文件 | marker 相同跳过安装；不同时重新安装；与内存技能快照分开 |
| Cloud Skills | 认证代际＋资源目录状态；正文键为 authority＋package＋resource | 线程拥有的目录状态；正文最多 100 项、合计 8 MiB | 认证改变清空旧代际；接受刷新后替换目录并清正文；旧代际异步结果禁止写回；满额后不缓存新项 |
| Executor capability discovery | 捕获的环境实例、executor session、root、sandbox | 线程范围的发现快照 | 成功与永久失败可复用；暂时错误下次重试；身份变化不匹配；恢复状态用于失效下游投影 |
| MCP 工具目录 | server、transport 指纹、环境实例、必要的 cwd／凭据／协议上下文 | 进程范围 LRU，32 项，TTL 30 分钟 | TTL、revision、服务端 opt-out、身份变化共同控制；generation 防止旧 fetch 覆盖新目录 |
| 插件 manifest 解析 | root URI＋manifest URI；比较正文及 overlay 的 SHA-256 | plugin store 拥有的 LRU，128 项；合计输入超过 64 KiB 不缓存 | 内容指纹变化重新解析；store clone 共享，独立 store 不共享 |
| 会话审批 | 各工具构造的可序列化审批键 | session 服务内 map | 仅当所有键已有 ApprovedForSession 才复用批准；不缓存执行结果 |

这些缓存未采用一个统一 Redis，也不能用一个“全局 TTL”描述。MCP Apps、远程插件目录、认证状态、渲染等还有各自缓存；本主题覆盖请求链路与动态 Skill／MCP 集成的主要机制，未宣称穷举所有缓存。参见 S4—S10。

### 4.1 模型目录：TTL 与 ETag 配合

Models Manager 提供 `InMemory`、`Online`、`Offline`、`OnlineIfUncached` 刷新策略。在线发现是否允许，还受 provider、认证方式和 API-key discovery 开关等约束，不能理解为所有启动都会访问网络。

文件后端拒绝缺少版本、版本不符或超过 TTL 的记录；manager 再核验 identity 和作废标记。匹配 ETag 可以续期；文件版本、identity、ETag 都一致且年龄超过半个 TTL 才实际更新 fetched_at，减少频繁写盘。这是条件续期，不是每读一次自动延长 TTL。缓存写失败会记录错误，不直接使成功的模型发现失败。参见 S4。

### 4.2 Skills：发现快照与正文读取分开

Host Skills 对相同配置通过 `Arc<OnceCell<HostSkillsSnapshot>>` 合并首次加载，命中后把条目移到最近使用位置；容量淘汰不会破坏已被调用者持有的不可变快照。request-local root snapshots 进一步在同一次请求的不同 workspace 之间共享扫描。

app-server 的 SkillsWatcher 对已注册本地根目录的文件变化进行节流（该版本非测试间隔为 10 秒），随后 clear_cache 并发出 `skills/changed`。它不会覆盖所有远端、插件或系统根；系统目录事件被过滤，远端环境不在此处注册 watcher。必须按实际加载路径确认更新来源，不能声称“修改任何 Skill 都即时生效”。

Cloud Skills 目录在认证与资源状态一致、完整且无 warning 时可直接复用；错误、partial 或 warning 目录进入退避重试，显式刷新绕过复用。正文读取前后都检查当前认证与代际，防止账户切换或刷新中的迟到响应污染新缓存。非 Cloud 来源的 read 在该入口交给 provider，不能把 Cloud 正文缓存推广到所有技能文件。参见 S5、S6。

### 4.3 MCP：目录复用与实时调用分开

合格的工具目录快照可让部分场景在连接尚未 ready 时向模型提供声明，实际调用仍走绑定的客户端。指纹无法可靠表达的动态 HTTP helper、部分 OAuth／ChatGPT 认证场景等会禁用该通用目录复用路径；具体条件以源码为准。

目录发布时会清除工具 annotations，因为它们影响审批和并行决策，必须由 live connection 提供。工具列表通知 revision 使旧快照不可再选；并发 fetch 用递增 generation 保护新结果。TTL 判断是读取资格检查，不保证到点主动删除；一次捕获的 fallback 还可能跨过到期继续使用，但服务端禁用或 revision 不合格时不能继续兜底。参见 S7。

## 5. 对当前 Agent Server 方案的含义

以下为基于已核对机制的设计建议，不是 Codex 现成实现：

- Session 元信息、GitHub 元数据、项目索引和 scene → skill-set 映射可以由外层服务缓存；自行定义租户、仓库、worktree、配置、权限、内容版本和失效事件。
- 项目知识仅用 commit 作 key 不足以覆盖未提交修改。需要把工作区变化纳入版本或主动失效；不能把旧知识命中解释为“当前代码正确”。
- 已核验的稳定工具集合和技能目录可保持确定顺序；发生内容或权限变更必须更新。共享 key 既不能替代权限隔离，也不能保证跨会话命中。
- 常驻 app-server 有机会保留进程／服务实例级缓存；每次新建进程会失去这些内存状态。仅保持进程常驻不保证保留所有线程状态或模型端缓存。
- 不对有副作用的 shell、MCP 调用直接按输入复用返回结果；需要幂等或结果缓存时，作为独立业务机制设计。

原始[缓存概念笔记](../../../../cache-and-cache-hit.md)和[常驻服务方案](../../../../codex-server-complete-plan.md)是对话整理材料，里面的 Redis、Project Knowledge Cache、耗时和 token 示例不是 Codex 实测或已实现功能。

[实现逻辑](实现逻辑.md) · [来源与适用边界](来源与适用边界.md) · [缓存诊断](../../../运维/监控与诊断/缓存诊断/README.md) · [返回运行机制](../README.md)
