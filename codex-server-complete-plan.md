# 云端常驻 Codex 服务：实施方案与历史讨论

> 本文中的全部设计已废弃，仅保留为历史记录。后续设计由项目负责人重新确定。

来源：[实现常驻Codex服务](chatgpt-conversation://6aad2312-d71c-83ec-b481-13b82f4c0994)  
整理日期：2026-09-19  
范围：当前实施方案，以及该会话从最初的常驻服务请求到最后保存请求的 11 轮历史讨论。
方案更新日期：2026-11-23。

> 阅读说明：方案总览维护当前架构、职责与实施顺序；第 1—11 章保留历史问题与回答、示例、代码和 ASCII 架构图。原会话中的产品状态、套餐和接口描述属于历史讨论记录。原始引用中无法从会话读取结果还原链接的标记，显示为「〔原会话引用 N〕」；原文已有的链接照常保留。

> 项目决策更新（2026-11-23）：已确定采用“用户端（Web/App）→ 网关（可选）→ Agent Server → Codex App Server”的链路。后续实施以本文[方案总览](#方案总览)为准；[架构决策记录](docs/decisions/0001-codex-app-server.md)保留选型确认。

## 目录

- [方案总览](#方案总览)
- [1. 常驻服务的初始架构：Task、Queue 与 Worker](#chapter-1)
- [2. 明确产品目标：Codex App 式 Session Agent](#chapter-2)
- [3. 核心执行机制：Agentic Tool Loop](#chapter-3)
- [4. 方案收敛：将 Codex App Server 部署到云端](#chapter-4)
- [5. Control Plane：管理 Agent、Session 与 Workspace](#chapter-5)
- [6. Token、套餐、认证与额度管理](#chapter-6)
- [7. 阶段性共识：个人云端 Codex 的落地方向](#chapter-7)
- [8. 动态 Skill：场景装配、渐进加载与 MCP 依赖](#chapter-8)
- [9. Gateway 的作用与单服务 MVP](#chapter-9)
- [10. 缓存体系：数据、Agent Knowledge 与 Prompt Cache](#chapter-10)
- [11. 会话末尾的保存请求](#chapter-11)

---

## 方案总览

本节是当前实施方案，按 2026-11-23 确认的架构更新。后续第 1—11 章保留历史讨论，用于追溯需求与方案演进；与本节不一致时，以本节为准。当前已制作 Web 交互原型，尚未实现真实后端运行服务；以下服务接入步骤与验收条件均为待完成工作。

### 目标与确定的架构

将 Codex 执行环境部署到服务端，通过 Web 或 App 持续访问项目和会话，完成读写代码、执行命令、查看 diff、测试、审批和继续任务。

确定采用：**用户端（Web/App）→ 网关（可选）→ Agent Server → Codex App Server**。本文的 Codex Server 指 Codex App Server。Agent Server 是本项目的业务与管理服务，网关按接入需要选用。

```text
                用户端（Web / App）
                         ↕
                 网关（可选）
        统一接入 / 身份校验 / 路由 / 限流
                         ↕
                    Agent Server
        ┌──────────────────────────────┐
        │ API / 业务权限 / Session      │
        │ Workspace / Skill / MCP 管理 │
        │ 事件与审批交互 / Codex Adapter │
        └──────────────────────────────┘
                         ↕
                  Codex App Server
         会话执行 / 模型调用 / 工具交互
                         ↕
              Workspace / Shell / MCP
```

省略网关时，用户端直接连接 Agent Server。请求向下传递，响应、流式事件和审批请求向上返回；用户的审批决定再经同一链路回传。图中的 Workspace 是执行环境与文件资源，不是必须经过的网络服务跳数。

### 组件职责与边界

| 组件 | 本项目中的职责 |
|---|---|
| 用户端（Web/App） | 会话入口、任务提交、文本与工具事件展示、审批决定、取消、结果及 diff 查看 |
| 网关（可选） | 统一入口、身份校验、路由、限流、连接和事件代理；向 Agent Server 传递经过验证的身份上下文 |
| Agent Server | 业务权限、Session／thread 映射、Workspace 绑定、请求与状态管理、事件转发、审批关联和恢复协调 |
| Codex Adapter | Agent Server 内部的协议适配模块；管理 App Server 连接、请求 ID、响应／通知分流、服务端请求应答和错误 |
| Codex App Server | 通过实际接入版本提供 Codex 会话、模型与工具执行、审批交互等能力 |
| Workspace | 保存仓库、分支或 worktree、修改文件和验证产物；Agent Server 管理其绑定与生命周期 |
| Skill／MCP 管理 | Agent Server 按项目和场景选择能力，通过已核对的 Codex 加载或配置路径生效；动态装配机制后续实现 |

网关负责接入层控制，Agent Server 根据有效身份校验具体会话和工作区权限。网关的存在不改变 Session、Workspace 和 Codex thread 的管理归属。首版可使用单个 Agent Server 服务承载管理逻辑，后续是否拆出 Control Plane 或 Worker Pool 另行评估。

### 核心对象与状态归属

| 对象 | 管理方式 |
|---|---|
| 自有 Session | Agent Server 管理的业务会话，记录归属、Workspace、Codex thread 映射与必要状态 |
| Codex thread | 由 Codex App Server 管理的执行会话；通过协议创建、读取或恢复，具体接口按运行版本核对 |
| turn | 一次执行及其终止状态；Agent Server 关联用户请求与 Codex 返回的标识 |
| 客户端连接 | Web/App 的临时连接；断线不等于会话删除或执行已取消 |
| 审批请求 | 关联原始请求、所属会话与等待状态；用户决定回传前不得伪造“已批准” |
| Workspace | 持久化文件和 Git 状态；同一会话继续任务时保持正确绑定 |

业务会话、客户端连接、Codex 进程和模型端缓存的生命周期分别处理。不能用“保持一个连接”替代持久化映射，也不能把恢复历史解释成恢复了旧连接或模型缓存。

### 一次任务的完整路径

1. 用户端提交会话消息，经可选网关送达 Agent Server。
2. Agent Server 校验会话归属及 Workspace 访问权限，解析或创建对应的 Codex thread。
3. Codex Adapter 向 App Server 提交执行请求，并关联业务请求、thread 与 turn。
4. App Server 产生文本、工具和状态事件，Adapter 分流后由 Agent Server 返回用户端。
5. 若 App Server 要求审批，Agent Server 向用户端展示并等待决定，再由 Adapter 应答原始服务端请求。
6. 执行结束后记录完成、失败或取消状态，提供修改、diff 与验证结果。
7. 用户端断线后重新连接时，先核对实际会话与执行状态，再补齐展示；进程重启另走对应版本的恢复流程。

具体传输、历史读取与审批重放能力必须以实际接入协议验证。恢复流程需要区分可重建的状态和瞬时事件，不能先假定所有事件都能无损回放。

### 最小实施闭环与推进顺序

| 阶段 | 工作 | 验收结果 |
|---|---|---|
| 1. 版本与协议探针 | 固定二进制版本，核对初始化、thread／turn、事件、审批和错误协议，建立连接 | 可记录实际版本，完成协议初始化与一次可追踪往返 |
| 2. 单会话执行 | Agent Server 绑定测试 Workspace，创建会话并发起任务 | Web/App 接入路径能展示响应、工具状态及执行终止状态 |
| 3. 审批与取消 | 关联服务端请求、转发审批决定，接入取消处理 | 批准、拒绝、取消和错误均有明确状态，工具结果不会被误判成功 |
| 4. 持久化与恢复 | 保存 Session／thread／Workspace 映射，验证重连和进程重启 | 后续消息继续正确会话，恢复不串工作区，无法恢复时明确报错 |
| 5. 代码任务验收 | 在测试仓库修改代码、查看 diff、执行测试 | 修改与测试记录可回查，失败不标记为验证通过 |
| 6. 能力与性能扩展 | 接入场景 Skill／MCP、并发控制和缓存观测 | 在真实需求与测量依据下逐项扩展 |

优先交付物为“协议连接探针＋Agent Server 单会话完整往返＋测试记录”。先跑通用户端直连 Agent Server 的路径；若启用网关，再验证相同任务的事件传递、身份关联、审批往返与断线恢复。

### Web 用户端产品设计（第一版）

产品暂名 **Agent Workspace**。交付范围为产品方案与可交互页面原型；原型使用本地演示数据，尚未接入 Agent Server 或 Codex，不执行真实命令、不修改仓库。正式服务的开发语言和前端框架仍在实施阶段决定。

#### 产品定位与参考原则

围绕项目持续对话，让用户能提出任务、理解执行进展、处理审批和检查结果。主入口保持对话式使用方式，执行细节按需展开。

- 参考 ChatGPT 的侧栏会话导航、历史搜索与项目组织思路。官方参考：[查找对话、项目和文件](https://help.openai.com/en/articles/10056348-finding-your-chats-projects-and-files-in-chatgpt)、[Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)。
- 参考 DeepSeek 的任务输入及能力选择思路，减少发起任务前的操作层级。官方参考：[DeepSeek 对话能力说明](https://api-docs.deepseek.com/guides/build_a_chatbot/)。
- 上述参考于 2026-11-23 查阅公开官方说明，未逐屏核对登录后的 Web 界面。这里借鉴交互范式，页面布局和视觉规范为本项目设计，不表示复刻其当前版本，也不宣称已接入两家服务。

#### 信息架构与桌面布局

```text
┌──────────────────┬─────────────────────────────────┬──────────────────┐
│ 品牌 / 新建对话   │ 工作区 / 分支 / 任务详情入口      │ 任务详情（可收起）│
│ 搜索对话          ├─────────────────────────────────┤ 概览 / 变更 / 日志│
│ 工作区            │ 当前任务标题与状态               │ 任务进度          │
│ 最近对话          │ 用户消息 / Agent 回复            │ 文件变更与 diff   │
│                  │ 执行步骤 / 审批卡片              │ 工作区与能力      │
│                  ├─────────────────────────────────┤                  │
│ 个人设置          │ 输入 / 附件 / 任务模式 / 发送停止 │                  │
└──────────────────┴─────────────────────────────────┴──────────────────┘
```

现有原型的左侧导航同时展示对话和管理功能。正式设计按权限提供业务工作台与管理台，管理台包含专家、插件及知识库管理。左侧导航约 252 px；中央对话内容最大宽约 728 px；右侧任务详情约 306 px，可收起。宽度不足时右栏变为抽屉，手机端侧栏也转为抽屉，输入区保持可用。

| 区域／页面 | 主要内容与操作 |
|---|---|
| 新对话 | 当前工作区、任务输入、理解项目／执行任务／审查变更／整理方案的快捷提示 |
| 会话页 | 用户和 Agent 消息、任务状态、执行步骤、操作审批、复制与继续任务 |
| 会话导航与搜索 | 切换已保存会话，按标题或消息内容查找历史 |
| 工作区选择 | 显示仓库和分支；切换到另一工作区时新建对话，保留原会话绑定 |
| 任务概览 | 当前状态、步骤、相关文件、工作区和已启用能力 |
| 变更面板 | 文件清单、增删统计与代码 diff；所有示例明确标注 |
| 日志面板 | 按顺序展示接收、上下文梳理、审批和结束等执行节点 |
| 设置 | 浅色／深色、演示状态、浏览器存储说明和重置演示 |

当前原型先对齐 Codex App 风格的用户操作顺序。用户从侧栏新建、搜索及继续任务，从「项目」选择工作区并查看关联任务，从「自定义」浏览插件和技能并查看已安装条目。任务仍通过对话推进，执行详情展示进度、变更和日志。个人设置位于侧栏底部，企业配置由独立的管理 Web 提供。用户 Web 和管理 Web 分别使用原型的根路径和 /admin/，采用各自的页面和导航。两者共用浏览器演示数据，正式访问控制由 Agent Server 执行。

#### 企业业务与专家管理

本项目服务企业内部的具体业务。将现有业务流程拆成可发起、可授权、可验收的动作，由所属领域的专家承接。Web 一级菜单为「专家管理」，二级按领域展开，例如「供应链」「质量安全」。领域内可新建专家，例如「质量安全 → 工单专家」。

| 专家配置 | 具体内容 |
|---|---|
| 基本信息 | 所属领域、名称、职责和启停状态 |
| 执行上下文 | 运行工作区、专家指令、在该工作区可用的插件和知识库 |
| 业务动作 | 动作名称、输入字段与校验、调用目标、权限与审批要求、成功和失败结果 |
| 运行管理 | 正式版保存配置版本与变更记录，每次任务绑定执行时的专家配置 |

工单专家可以承接「创建质量异常工单」和「查询工单进度」。创建时应收集异常描述、影响范围与关联对象，按配置确认后调用工单系统并返回工单编号。查询时需校验用户对目标工单的访问权限。写入动作应记录操作者、审批决定、外部业务编号和结果，重试需避免重复建单。

原型支持创建领域、新建及编辑专家、配置工作区、指令、插件、知识库与动作名称，停用后禁止发起新动作。发起动作进入绑定专家的演示会话。动作字段、权限、审批、调用目标及配置版本属于正式接入设计。

#### 插件管理

插件模块负责将企业系统能力登记为可治理的业务操作，再授权给专家使用。参考 ChatGPT 的目录、详情和连接管理流程，产品入口保留「插件目录」和「工作区管理」。企业接入增加连接归属、动作授权和专家引用。[ChatGPT 插件](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt) · [连接与管理应用账号](https://help.openai.com/en/articles/20001494-connecting-and-managing-app-accounts-in-chatgpt)

##### 管理侧与用户侧

产品提供独立的管理 Web 和用户 Web。管理 Web 面向获授权的管理人员，用户 Web 面向企业员工。所属领域与工作区的权限由 Agent Server 校验。

| | 管理侧 · 管理台 | 用户侧 · 业务工作台 |
|---|---|---|
| 导航 | 插件管理 → 插件目录／工作区管理；专家管理 → 领域 → 专家配置 | 领域 → 专家 → 业务动作；自定义 → 插件／技能／已安装；我的任务与结果 |
| 插件与连接 | 登记和发布插件，配置企业连接，授权工作区可调用的操作，处理连接异常 | 浏览可见插件和当前已安装插件，在详情查看安装、连接与可用状态。需要个人授权时，可从插件详情或业务动作发起连接 |
| 专家与操作 | 将已授权的插件操作映射为专家的业务动作，配置参数、权限、审批与结果展示 | 选择专家与动作，填写业务信息，确认提交并查看结果 |
| 审批与记录 | 配置审批规则和审批角色，按权限查阅审计与影响范围 | 申请人查看审批进度，指定审批人在待办中处理，用户查看本人有权访问的任务记录 |

**用户侧插件入口。** 在业务工作台提供「自定义」入口。子导航包含「插件」与「技能」，下方常驻「已安装」列表。点击已安装插件可直接查看详情。插件目录支持搜索，技能入口当前展示空状态。

| 视图 | 用户能看到什么 |
|---|---|
| 插件目录 | 当前工作区向本人公开的插件，可按名称、领域或能力搜索。卡片显示用途、安装状态和可用条件。详情提供「安装」或「申请开通」，具体入口由工作区策略决定 |
| 已安装 | 导航中直接列出当前工作区内已装配给本人的插件，包含个人安装和管理员统一装配，标注安装来源。即使连接失效或插件被停用，也保留条目并说明当前状态及处理方式。个人安装支持卸载，统一装配的变更联系管理员 |

用户侧分别展示**安装、连接和使用资格**。例如，工单插件可以同时显示「已安装 · 管理员装配」「企业连接正常」「仅可查询」。安装成功后条目进入「已安装」，如需个人账号授权则提示连接。插件出现在用户的已安装列表中后，专家是否能调用具体动作仍由工作区授权、专家绑定及用户业务权限共同决定。

**管理侧流程。** 插件管理员发布工单插件 → 工作区管理员配置企业连接并开放查询和建单操作 → 专家管理员在「质量安全 → 工单专家」绑定操作，设定可使用人员和建单审批规则 → 配置校验通过后发布专家动作。

**用户侧流程。** 员工打开「质量安全 → 工单专家」，选择「创建质量异常工单」，填写异常描述并核对提交内容。需要审批时，员工查看进度，指定审批人处理待办。通过后由 Agent Server 调用插件，员工在任务页查看外部工单编号或失败原因。若同一员工仅有查询权限，发起建单的入口不可用，服务端也会拒绝直接提交。

**交付边界。** 管理侧发布的专家动作是用户侧的使用入口。插件停用或连接失效后，用户侧显示动作不可用及联系管理员的提示。企业连接的凭据保存在服务端，用户侧只接收业务所需的状态和结果。个人授权只用于规则允许的连接，并受工作区与目标系统权限共同约束。

插件是能力包，能包含 Skill 或外部系统操作。连接是访问外部系统的凭据及授权范围，纯 Skill 插件可以无需连接。专家负责面向用户的业务流程。例如「工单专家」引导用户补充异常信息，将「创建质量异常工单」映射到工单插件的建单操作，并展示真实执行结果。

| 功能 | 界面与行为 | 操作者 |
|---|---|---|
| 插件目录 | 按名称、领域和能力搜索。详情显示用途、所有者、版本、操作清单、授权要求及引用专家 | 员工查看可见插件，插件管理员登记与维护 |
| 工作区管理 | 选择可用插件版本、启停插件、配置连接、授权具体操作，并查看受影响的专家 | 工作区管理员 |
| 连接管理 | 建立、验证、重新授权和断开连接。显示账号归属、验证时间及异常原因。凭据由服务端保存 | 有权配置连接的管理员或账号所有者 |
| 操作管理 | 定义必填参数、校验、读写属性、权限、确认或审批规则、输出和错误映射 | 插件管理员维护，业务负责人确认 |
| 专家配置 | 选择工作区已授权的具体操作，配置业务字段映射，并显示连接与权限缺失 | 专家管理员 |
| 执行与审计 | 按用户、专家、工作区、插件和操作查询执行记录，关联审批决定与外部业务编号 | 业务人员查看本人任务，有权限的管理人员查阅审计 |

界面分别显示插件登记状态、工作区启用状态、连接状态和操作可用性。执行时同时检查用户权限、工作区授权、专家绑定及所需连接。审批只覆盖本次已确认参数，审批后如目标或参数变化，需要重新确认。需要外部权限的操作还须遵守目标系统的访问控制。

1. **登记插件。** 管理员填写名称、领域、负责人和连接类型，登记操作及参数契约。用测试环境验证返回结果、错误映射及权限后发布版本，目录展示其可用范围。
2. **接入工作区。** 工作区管理员打开插件详情，选择版本和允许的操作。需要连接时，查看请求的授权范围并完成授权，服务端验证通过后显示连接可用。验证失败时保留错误与重试入口。
3. **配置专家。** 在「质量安全 → 工单专家 → 编辑专家」添加操作绑定。例如将「创建质量异常工单」关联到工单系统的建单操作，配置业务字段、审批和结果展示。未通过校验的绑定保留为草稿。
4. **发起业务动作。** 员工选择专家和动作，补充参数。Agent Server 校验身份和权限，展示目标系统、具体操作、影响对象和必要的审批。审批通过并重新校验权限后执行，返回外部工单号或明确的失败原因。
5. **处理失败及变更。** 连接失效时提示有权人员重新授权。网络超时且外部结果未知时，先按业务请求标识查单，再决定是否重试，防止重复建单。停用、断开和升级前展示引用的专家及进行中的任务。生效后拦截后续调用，包括排队中尚未发出的调用。已发出的调用按外部系统结果核对，审批中任务在执行前重新校验。

| 工单专家动作 | 需要的信息 | 权限与执行结果 |
|---|---|---|
| 创建质量异常工单 | 异常描述、影响范围、关联对象 | 校验建单权限，按规则确认或审批。成功返回工单编号和状态，失败时区分未提交与结果待核对 |
| 查询工单进度 | 工单编号 | 校验目标工单的读取权限。返回状态、最近更新时间与处理摘要 |

首版建议选定一个质量安全工作区，接入一个工单系统，验证上述两个动作及失败分支。验收覆盖插件启用后专家可绑定授权操作、只读权限无法建单、拒绝审批时未发出写入、超时重试不会重复建单，以及停用后无法发起新调用。Agent Server 负责权限、审批和审计，Codex 承担会话和任务执行。正式插件连接与动作调用待服务端接入，现有 Web 原型提供目录、详情、模拟连接和范围配置。

#### 知识库管理

知识库管理是一级页面，区分知识内容、工作区可见范围和会话选择。资料按需进入任务上下文，不能把所有知识库全文默认塞入每次模型请求。

| 能力 | 第一版设计与原型行为 |
|---|---|
| 创建知识库 | 设置名称、用途和可用工作区 |
| 资料管理 | 手动新增、查看、编辑正文，保留来源／版本说明及最近修订日期 |
| 查找资料 | 在本地按知识库名称、资料标题、正文和来源做关键词检索；不宣称实现向量检索 |
| 归档与恢复 | 归档资料不参与检索，可恢复；首版不提供不可恢复删除 |
| 工作区范围 | 指定知识库可用于哪些工作区；移除绑定后，不再作为该工作区的可选上下文 |
| 会话选择 | 输入框“知识库”菜单选择本会话使用哪些库，任务详情显示当前选择 |
| 插件协作 | 知识库可被维护和选择；实际检索还需可用的知识检索能力，插件停用时明确提示 |

正式版由 Agent Server 管理资料存储、权限、索引状态、来源和引用。后续文件／URL／仓库接入、索引任务、修订历史及删除传播另行实现；本原型只支持手动文本和浏览器本地保存。知识库工作区绑定不替代用户级授权，生产服务必须检查归属和可见范围。

#### 输入与核心交互

输入区支持 Enter 发送、Shift+Enter 换行，并兼容中文输入法组合输入。处理过程中发送按钮变为停止按钮；等待审批时提示用户先处理审批，后续再根据真实协议设计 steering 或排队。

任务模式分为“计划并执行”和“仅分析”。原型只演示行为差异；正式版本中“仅分析”必须由 Agent Server 根据能力和权限实施约束，不能只靠前端提示词保证。能力菜单展示工作区可用能力及审批要求，不把未接入的工具按钮伪装为真实可用。

附件原型只展示用户所选文件的名称，不读取或上传正文；正式上传的接口、大小限制、保存方式和生命周期需另行定义。对话可导出 Markdown；导出结果注明原型演示性质。

#### 任务状态与异常反馈

| 状态 | 用户看到的内容与可用操作 |
|---|---|
| 准备就绪 | 工作区和输入框，可发送首条任务 |
| 处理中 | 进度或执行事件，可请求停止；不能伪造真实百分比 |
| 等待审批 | 命令或操作说明、作用范围、本次批准与拒绝按钮 |
| 验证中 | 审批结果与后续步骤；正式版等待真实执行事件 |
| 已完成 | 结果、变更与验证记录；模拟结果必须显式标注 |
| 已取消／失败 | 已知停止点或错误信息、已有产物与继续操作入口 |
| 断线／恢复中（正式接入） | 连接状态与最近已确认的执行状态分开显示；恢复完成前不推断任务成功或停止 |

审批决定绑定具体请求。正式接入应展示真实操作、影响范围和必要的风险说明；提交后区分“已提交决定”与“服务端确认”，避免多端重复应答。原型提供批准与拒绝模拟，不代表持久授权。

#### 视觉与响应式规范

浅色默认，冷灰导航与白色内容区，使用克制的绿色作为当前选择和主要动作强调色；审批卡片采用浅琥珀色。任务详情独立于对话正文，避免大量执行日志打断阅读。

正文约 16 px，常用操作与导航约 14 px，标题约 22 px；次要元数据适当缩小。输入、按钮、抽屉和弹窗提供可聚焦状态与清晰标签。状态同时使用文字表达，不能只靠颜色区分。

- 大屏：侧栏、对话、详情三栏布局。
- 中屏：右侧详情切换为抽屉，对话保留主要空间。
- 手机：导航与详情按需打开，任务标题、审批、输入和停止保持可访问。
- 快捷键：⌘／Ctrl+K 搜索；⌘／Ctrl+Shift+O 新建；Esc 关闭菜单或弹窗。

#### 原型与正式接入边界

[打开私有交互原型](https://agent-workspace-prototype-1123.gratefulcouch5.chatgpt.site)（需登录 ChatGPT）。原型源码位于 [web-prototype](web-prototype/README.md)。支持新建／切换／搜索对话、工作区选择、模拟任务与审批、详情选项卡、插件登记与按工作区启停、知识库及资料维护／检索／归档、会话知识库选择、深浅色、导出和本地保存。浏览器最多保留最近 30 个对话；此存储用于演示，不替代正式会话持久化。

正式版 Web 仅访问 Agent Server 或可选网关。Agent Server 返回会话、工作区、允许的能力及任务状态，并将 App Server 事件映射为产品状态。客户端不保管 Codex 认证凭据，也不直接连接 Codex App Server。

本节描述的消息、任务、审批与恢复是产品层对象和行为，尚未冻结 HTTP／WebSocket API 字段。协议、事件顺序、重复事件处理、重连恢复与错误映射需要与后端实施闭环一起验证。

#### 第一版产品验收

1. 新用户能选择工作区并发起第一条任务；历史会话能够搜索与继续。
2. 原型中的“发送 → 处理中 → 等待审批 → 批准或拒绝 → 完成或取消”完整可演示，且始终有模拟标记。
3. 任务概览、示例 diff 和日志可切换；收起详情不影响对话和输入。
4. 桌面与窄屏可操作，无主页面横向溢出；键盘输入、中文输入、搜索和弹窗基本可用。
5. 原型的状态与对话可在本浏览器刷新后保留；不把本地状态当作真实后端执行记录。
6. 插件可按工作区配置与启停，已启用和已连接明确区分；知识库可创建、维护、检索、归档／恢复并选择到会话，刷新后保留。
7. 正式接入后补验真实流式事件、权限、审批应答、停止确认与重连恢复；原型通过不等于后端功能通过。

### 动态 Skill、MCP 与缓存的推进范围

动态 Skill Registry／Resolver 和 MCP 装配是外层管理能力的后续设计。先明确所接入 Codex 版本的发现、加载、刷新及权限机制，再实现项目和场景选择；历史示例中的函数或接口不直接作为可用协议。

缓存分别处理：

- **Codex 已有机制**：模型端 Prompt Cache、WebSocket 连接与增量续传、模型目录、Skills／MCP 目录与插件解析等，各有独立的身份、容量和失效条件。
- **Agent Server 自有缓存**：Session 元信息、项目知识和场景映射等按需求另行实现，定义归属、版本与主动失效；Redis 是待评估的实现选项。
- **观测与正确性**：区分缓存 token 占比、传输增量与本地目录命中，优先保障数据新鲜度和身份隔离，再评估性能与成本。

具体实现依据见[缓存策略与实现](codex/架构/运行机制/缓存策略与实现/README.md)和[缓存诊断](codex/运维/监控与诊断/缓存诊断/README.md)。知识库当前以 `rust-v0.171.0` 为研究基线，生产运行版本在接入阶段固定。

### 已确定与待落实事项

| 状态 | 事项 |
|---|---|
| 已确定 | Web/App → 可选网关 → Agent Server → Codex App Server 的服务链路 |
| 已确定 | Codex App Server 作为执行引擎，Agent Server 承担自有业务与管理职责 |
| 推进基线 | 首版单服务管理逻辑，按协议探针、单会话、审批、恢复和代码验证顺序完成闭环 |
| 实施时落实 | 开发语言、部署位置、运行版本、进程部署方式、协议传输、存储和认证方式 |
| 按需求扩展 | 动态技能、独立网关、多用户、多节点、调度、预算和自有缓存 |

认证与套餐章节保留原讨论中的 ChatGPT 登录和 API Key 两条路线，尚未据此选定认证方式或承诺套餐可用性。历史命令、接口、套餐倍数与实验状态需按实际版本和账号核验。

### 历史讨论与当前方案的关系

第 1—11 章继续保留原始问题、回答、代码和图示。早期 Queue／Worker／自建 Runtime 是方案演进背景；第 9 章把 Gateway 与管理功能合并的讨论可作为无独立网关时的实现参考。当前角色划分及推进顺序以本节为准。

[架构决策记录](docs/decisions/0001-codex-app-server.md)作为选型确认与决策追溯，具体实施方案在本文维护。

---

<a id="chapter-1"></a>

## 1. 常驻服务的初始架构：Task、Queue 与 Worker

**用户问题**

> 如果我需要一个常驻的 服务端 codex agent 服务，用来接收用户端的 请求 应该怎么来实现？

**完整说明**

可以。比较合适的实现方式是把 **Codex 当成无状态/短状态的执行器（Worker）**，而不是直接把 Codex CLI 本身暴露成一个 HTTP 服务。

整体架构可以这样做：

```text
用户端 / IDE / Web / 企业系统
          │
          ▼
┌──────────────────────┐
│  Agent API Gateway   │
│ POST /tasks          │
│ GET  /tasks/{id}     │
│ WS   /tasks/{id}     │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Task Queue / Scheduler│
│ Redis / PostgreSQL    │
└──────────┬───────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────┐
│Codex    │ │Codex    │   ← 常驻 Worker
│Worker 1 │ │Worker N │
└────┬────┘ └────┬────┘
     │           │
     ▼           ▼
┌──────────────────────┐
│ Workspace Manager    │
│ git clone/worktree   │
│ branch / sandbox     │
└──────────┬───────────┘
           │
           ▼
      GitHub / GitLab
```

其中每个请求不要直接对应一个永久 Codex 进程，而是对应一个 **Agent Task / Session**。例如客户端提交：

```json
{
  "repo": "ai-idea",
  "branch": "main",
  "prompt": "分析当前项目，并修复登录模块的异常",
  "mode": "code",
  "session_id": "optional"
}
```

服务端完成五件事：鉴权和限流 → 创建 Task → 分配隔离 workspace → 调用 Codex 执行 → 将日志、diff、测试结果和最终状态持续回传。对于长任务，推荐立即返回 `task_id`，客户端通过 WebSocket/SSE 接收 Codex 的实时输出，而不是让 HTTP 请求一直阻塞。

如果你希望 Agent 真正做到**云端常驻**，我会再加一层 `Agent Runtime`。它负责保存 `session_id → repo/worktree/branch/context` 的映射。这样用户第二次发：

```text
继续刚才的任务，把测试也补上
```

服务端能够恢复之前的 workspace 和上下文，而不是重新 clone、重新理解整个项目。

生产环境尤其要注意 **不要让 Codex Worker 直接运行在 API Server 主机环境里**。推荐：

```text
Agent Server
   │
   ├── Task A → Docker / sandbox A → Codex
   ├── Task B → Docker / sandbox B → Codex
   └── Task C → Docker / sandbox C → Codex
```

每个任务限制 CPU、内存、运行时间、网络访问和文件系统范围；GitHub Token、OpenAI 凭据等通过 Secret Manager 临时注入。对于 `git push`、创建 PR、删除文件、执行部署等高风险动作，再增加 approval gate。

如果你的目标就是之前提到的 **GitHub `ai-idea` 仓库 + Codex**，第一版其实不用做得太重。我建议 MVP 采用：

**FastAPI / Node.js API → Redis Queue → Codex Worker → Docker Sandbox → Git worktree → GitHub**

然后定义几个核心接口：

```text
POST   /v1/tasks
GET    /v1/tasks/{task_id}
POST   /v1/tasks/{task_id}/message
POST   /v1/tasks/{task_id}/cancel
GET    /v1/tasks/{task_id}/events     # SSE
GET    /v1/tasks/{task_id}/diff
```

这样以后无论请求来自手机 App、Web、企业 IM、PQCP 或其他业务系统，都只是不同的 **Client Adapter**，底层共用同一个云端 Codex Agent Runtime。

还有一个关键设计选择：如果你的目标不是单纯的“远程运行 Codex”，而是希望以后实现类似：

```text
用户提出需求
   ↓
Planner Agent
   ↓
拆解任务
   ↓
Codex Agent
   ↓
修改代码
   ↓
Test Agent
   ↓
测试
   ↓
Review Agent
   ↓
检查 Diff
   ↓
GitHub PR
   ↓
等待人工审批
```

那么现在就应该把服务设计成 **Agent Runtime + Task Queue + Worker** 三层，而不要做成简单的 `HTTP → codex exec`。前一种架构后续很容易扩展成你所说的“云端常驻 Agent”。

如果你准备实际落地，我下一步可以直接按你的 `ai-idea` 项目给你设计一套 **可部署的 Codex Agent Server**，包括目录结构、FastAPI 服务、任务队列、Docker Sandbox、Codex 调用封装、SSE 实时日志以及 GitHub PR 流程。

---

<a id="chapter-2"></a>

## 2. 明确产品目标：Codex App 式 Session Agent

**用户问题**

> 我要做成 类似于 codex app 一样的能力 ，属于那种模式

**完整说明**

如果你的目标是做成 **类似 Codex App 的体验**——用户打开客户端，与一个长期存在的 Coding Agent 对话，它能持续理解仓库、执行命令、修改代码、展示 diff、跑测试、继续接受指令——那么它属于我上一条架构里的 **Agent Runtime / Session Agent 模式**，而不是简单的 Task Worker 模式。

可以把架构进一步明确成：

```text
┌──────────── Codex-like Client ────────────┐
│ Chat │ Tasks │ Diff │ Terminal │ Approval │
└──────────────────┬────────────────────────┘
                   │ WebSocket / SSE + HTTP
                   ▼
┌───────────────────────────────────────────┐
│             Agent Gateway                 │
│ auth / session / events / approval        │
└──────────────────┬────────────────────────┘
                   ▼
┌───────────────────────────────────────────┐
│              Agent Runtime                │
│                                           │
│ Session Manager                           │
│ Conversation Context                      │
│ Tool Dispatcher                           │
│ Execution State                           │
│ Approval Manager                          │
│ Context Compression                       │
└───────────────┬───────────────────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
   Codex / LLM       Task Scheduler
                         │
                         ▼
┌───────────────────────────────────────────┐
│          Persistent Workspace             │
│                                           │
│ repo / git branch / worktree              │
│ shell / files / build / test              │
└──────────────────┬────────────────────────┘
                   │
                   ▼
             Sandbox / Container
                   │
                   ▼
                 GitHub
```

这里最关键的变化是：**Session 才是一等公民，Task 是 Session 里面的一次执行。**

比如用户创建：

```text
Session #A
repo = ai-idea
branch = feature/login
workspace = /workspace/session-A
```

第一次说：

```text
分析登录模块为什么偶尔返回 500
```

Agent 执行一系列动作：

```text
read files
   ↓
search code
   ↓
run tests
   ↓
修改代码
   ↓
run tests
   ↓
生成 diff
```

过十分钟用户再说：

```text
这个方案不太好，换成 middleware 实现
```

不是启动一个全新的 Agent，而是：

```text
POST /sessions/A/messages
```

Agent Runtime 恢复：

```text
conversation
+
agent state
+
workspace
+
git state
+
previous tool results
+
current diff
```

继续工作。

这就是 Codex App 类产品与普通“调用 Codex API”的核心区别。

#### 你需要的是「长生命周期 Session + 按需唤醒 Worker」

这里还有一个很容易踩坑的地方。

“常驻 Agent”**不等于**：

```text
一个 Codex 进程
永远运行
永远占着 Container
```

更合理的是：

```text
           Session A
              │
       ┌──────┴──────┐
       │ Agent State │   ← 长期存在
       │ Workspace   │   ← 长期存在
       │ Git State   │
       │ Context     │
       └──────┬──────┘
              │
           用户请求
              ↓
         唤醒 Worker
              ↓
           Codex
              ↓
          Tool Loop
              ↓
         保存 Agent State
              ↓
         Worker 释放
```

也就是说：

**Agent 逻辑常驻，计算资源不一定常驻。**

这对以后做 100、1000 个 Coding Agent 非常重要。

#### Codex-like 产品建议拆成 6 个核心模块

| 模块 | 职责 |
|---|---|
| Client | Chat、Terminal、Diff、任务状态 |
| Agent Gateway | API、WebSocket、鉴权 |
| Session Manager | Agent 会话生命周期 |
| Agent Runtime | Codex/LLM + Tool Loop |
| Workspace Manager | repo、worktree、文件、Git |
| Sandbox Runtime | shell、build、test、MCP |

其中 **Agent Runtime 是整个系统核心**。

它不是简单：

```python
codex(prompt)
```

而是一个循环：

```text
User Message
      ↓
Build Context
      ↓
     LLM
      ↓
   Tool Call
      ↓
read / edit / shell / search / git / MCP
      ↓
Tool Result
      ↓
     LLM
      ↓
  Tool Call
      ↓
     ...
      ↓
Final Response
```

也就是典型的：

**Agentic Tool Loop。**

#### Workspace 则相当于 Agent 的“身体”

例如：

```text
/data/agents/

session-001/
 ├── repo/
 ├── .agent/
 │    ├── state.json
 │    ├── context.json
 │    └── events.jsonl
 └── artifacts/

session-002/
 ├── repo/
 └── .agent/
```

数据库保存：

```text
sessions
messages
runs
tool_calls
approvals
workspace
artifacts
```

这样即使：

```text
Agent Server 重启
Worker 重启
Container 被销毁
```

用户回来依然可以：

```text
继续昨天那个任务。
```

#### 最终我会把你的产品定位成

```text
          你的 Codex App
                │
                ▼
        Agent Control Plane
                │
     ┌──────────┼──────────┐
     ▼          ▼          ▼
 Session A   Session B   Session C
     │          │          │
     ▼          ▼          ▼
 Workspace  Workspace  Workspace
     │          │          │
     └──────────┼──────────┘
                ▼
          Worker Pool
                │
                ▼
        Codex / LLM Runtime
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
      Git     Shell     MCP
       │        │        │
       └────────┼────────┘
                ▼
             GitHub
```

所以如果给这种模式一个比较准确的名字，我会叫：

**Persistent Coding Agent Runtime（持久化编程 Agent 运行时）**

或者产品架构上叫：

**Agent Control Plane + Ephemeral Execution Plane**

前者保存 Session、上下文、Workspace、权限和任务状态；后者负责真正消耗 CPU/GPU/Token 去执行 Codex。

这比“部署一个常驻 Codex 服务”更接近你说的 **Codex App 能力**。

而且如果你后面还准备把 TradingAgents、研发 Agent、测试 Agent 等都放到这个“云端常驻 Agent”项目里，我建议进一步抽象成一个**通用 Agent Runtime**，Codex 只是其中一种 `CodingAgent`。这样以后可以同时跑 `CodingAgent / ResearchAgent / QAAgent / TradingAgent`，共用 Session、Scheduler、Sandbox、MCP、Memory 和 Event Stream。

---

<a id="chapter-3"></a>

## 3. 核心执行机制：Agentic Tool Loop

**用户问题**

> agentic tool loop 是什么意思

**完整说明**

**Agentic Tool Loop** 可以理解成：

> **AI 不只是“回答一次”，而是能够不断地「思考 → 调工具 → 看结果 → 再决定下一步」，直到任务完成。**

这正是你想做的 Codex App 类 Agent 的核心机制。

比如用户对你的 Coding Agent 说：

> “帮我看看登录接口为什么报 500，并修复它。”

普通 LLM 基本是：

```text
用户问题
   ↓
LLM
   ↓
生成回答
   ↓
结束
```

而 Agentic Tool Loop 是：

```text
用户需求
   ↓
┌──────────── Agent ────────────┐
│                               │
│  ① 分析当前任务                │
│          ↓                    │
│  ② 决定调用工具                │
│          ↓                    │
│  ③ 执行工具                    │
│          ↓                    │
│  ④ 获取执行结果                │
│          ↓                    │
│  ⑤ 根据结果决定下一步           │
│          │                    │
│          └───────↺────────────│
│                               │
└───────────────┬───────────────┘
                ↓
             任务完成
```

例如真实执行过程可能是：

```text
User:
登录接口报 500，帮我修一下。

        ↓

Agent:
我先看看项目结构。

        ↓
Tool: list_files()
        ↓
Result:
src/
  controller/
  service/
  repository/

        ↓

Agent:
登录应该在 controller。

        ↓
Tool: read_file("src/controller/login.ts")
        ↓
Result:
...

        ↓

Agent:
这里调用了 userService.login()，
继续检查 service。

        ↓
Tool: read_file("src/service/user.ts")
        ↓
Result:
...

        ↓

Agent:
发现可能存在 null user 问题。
先看看测试。

        ↓
Tool: run("npm test")
        ↓
Result:
login.test.ts FAILED
Cannot read property 'id' of null

        ↓

Agent:
问题确认。
修改代码。

        ↓
Tool: edit_file(...)
        ↓
Result:
success

        ↓

Agent:
重新测试。

        ↓
Tool: run("npm test")
        ↓
Result:
PASS

        ↓

Agent:
再检查 git diff。

        ↓
Tool: git_diff()
        ↓
Result:
...

        ↓

Agent:
任务完成，向用户汇报。
```

这里实际上发生了很多轮：

```text
LLM
 ↓
Tool
 ↓
Result
 ↓
LLM
 ↓
Tool
 ↓
Result
 ↓
LLM
 ↓
...
```

这个 **Loop（循环）** 就是名字里的 Tool Loop。

而 **Agentic** 强调的是：不是你提前把所有步骤写死，而是 **Agent 根据每一步得到的结果，动态决定下一步做什么。**

例如：

```python
while True:

    response = model(context, tools)

    if response.has_tool_call:

        result = execute_tool(
            response.tool_call
        )

        context.append(result)

    else:
        return response.final_answer
```

真实生产系统当然比这个复杂，但核心思想就是这几十行逻辑。

---

#### 放到你要做的 Codex App 里

你的 Agent Runtime 本质上就是运行这个循环：

```text
                ┌──────────────┐
                │     User     │
                └──────┬───────┘
                       ↓
                ┌──────────────┐
                │ Agent Runtime│
                └──────┬───────┘
                       ↓
                ┌──────────────┐
            ┌──→│  Codex / LLM │
            │   └──────┬───────┘
            │          ↓
            │    Decide Action
            │          ↓
            │   ┌──────────────┐
            │   │ Tool Router  │
            │   └──────┬───────┘
            │          ↓
            │
            │   ┌────────────────────┐
            │   │ read_file          │
            │   │ write_file         │
            │   │ shell              │
            │   │ git                │
            │   │ search             │
            │   │ browser            │
            │   │ MCP                │
            │   │ test               │
            │   └─────────┬──────────┘
            │             ↓
            │        Tool Result
            │             │
            └─────────────┘

                    直到完成
                       ↓
                Final Response
```

所以你前面说的 **“服务端常驻 Codex Agent”**，真正需要常驻的核心组件其实不是简单的：

```text
Codex Process
```

而更应该是：

```text
Agent Runtime
    │
    ├── Session Manager
    ├── Context Manager
    ├── Agentic Tool Loop   ← 核心
    ├── Tool Router
    ├── Approval Manager
    └── Event Stream
             │
             ▼
        Sandbox Worker
             │
     ┌───────┼────────┐
     ▼       ▼        ▼
   Shell    Git      MCP
```

你可以把 **Agentic Tool Loop 理解成 Agent 的“发动机”**；Codex/LLM 是负责判断下一步做什么的“大脑”，Shell、Git、文件系统、浏览器、MCP 等则是 Agent 可以使用的“工具”。

这三个概念区分清楚之后，你后面设计这个“云端常驻 Codex App”会容易很多：

**Agent = Model + Context + Tool Loop + Tools + Workspace + State。**

---

<a id="chapter-4"></a>

## 4. 方案收敛：将 Codex App Server 部署到云端

**用户问题**

> 如果我就是想用 将本地 codex app 部署到云端， 作为 service 呢？

**完整说明**

可以，而且现在官方已经提供了非常接近你这个需求的能力：**`codex app-server`**。

你不需要把“Codex App 的 GUI”搬到服务器上，更合适的是把 **Codex App 背后的 Codex harness/runtime 部署到云服务器，通过 App Server 对外提供服务**。OpenAI 官方说明，Codex CLI、IDE、Codex App 等底层都由同一套 Codex harness 驱动，而 App Server 就是把这套能力暴露给客户端的双向接口。〔原会话引用 0〕

#### 你想要的架构可以非常简单

```text
                    云服务器
┌────────────────────────────────────────┐
│                                        │
│            Codex App Server            │
│                                        │
│       Codex Harness / Agent Loop       │
│                  │                     │
│       ┌──────────┼──────────┐          │
│       ▼          ▼          ▼          │
│     Shell       Files       MCP        │
│       │          │          │          │
│       └──────────┼──────────┘          │
│                  ▼                     │
│          /workspace/project            │
│                  │                     │
│                 Git                    │
│                  │                     │
│                GitHub                  │
│                                        │
└──────────────────┬─────────────────────┘
                   │
             WSS / JSON-RPC
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
     手机端       Web端       PC客户端
```

这和我们前面讨论的“自己实现 Agentic Tool Loop”有一个很大的区别：

**你不需要自己实现 Tool Loop。**

Codex 已经替你实现：

```text
用户 Prompt
   ↓
Codex 判断
   ↓
读取代码
   ↓
执行 Shell
   ↓
观察结果
   ↓
继续分析
   ↓
修改文件
   ↓
执行测试
   ↓
继续分析
   ↓
完成任务
```

也就是直接复用 Codex 的 Agent Runtime。OpenAI 现在也明确把 `app-server` 定位为“当智能体本身就是产品的一部分”时的集成层。〔原会话引用 1〕

#### 最小版本甚至可以这样启动

服务器安装 Codex 后：

```bash
codex app-server --listen ws://127.0.0.1:4500
```

然后另一个 Codex CLI 可以远程连接：

```bash
codex --remote ws://127.0.0.1:4500
```

官方目前已经支持这种 Remote TUI 模式。远程连接时应使用 `wss://` + WebSocket 身份验证，而不是直接把未加密的 `ws://` 暴露到公网。〔原会话引用 2〕

所以你甚至可以先做一个实验：

```text
Mac / PC
Codex CLI
     │
     │ --remote
     ▼
公网 / VPN
     │
     ▼
Linux 云服务器
     │
     ▼
codex app-server
     │
     ▼
你的 ai-idea repo
```

这样你的 **Codex 实际执行环境已经不在电脑，而是在云端服务器**。

电脑只是客户端。

#### 再进一步，就可以做你自己的“Codex App”

官方 App Server 使用双向 JSON-RPC，已经提供 `thread/start`、`thread/resume`、`thread/read`、`thread/list` 等能力，并会流式发送 Agent 执行事件。〔原会话引用 3〕

于是你的客户端可以：

```text
┌──────────────────────────────┐
│       你的 Agent App          │
│                              │
│  ai-idea                     │
│                              │
│  ┌────────────────────────┐  │
│  │ 帮我实现用户登录功能      │  │
│  └────────────────────────┘  │
│                              │
│  ● 正在分析项目              │
│  ● Read auth.ts             │
│  ● Read user.ts             │
│  ● Run npm test             │
│  ● Edit auth.ts             │
│  ● Run npm test             │
│                              │
│  ✓ 完成                     │
│                              │
│  [查看 Diff] [继续] [提交]   │
└──────────────┬───────────────┘
               │
            WebSocket
               ↓
       Codex App Server
```

你客户端只负责 UI。

**Agent 能力直接使用 Codex。**

#### 这比我前面说的“自己做 Agent Runtime”更适合你现在的目标

之前的方案：

```text
你的 Agent Runtime
       ↓
自己实现 Session
       ↓
自己实现 Tool Loop
       ↓
自己实现 Tool Router
       ↓
自己调用 Model
       ↓
Shell / Git / MCP
```

现在可以变成：

```text
你的 Service
      ↓
Codex App Server
      ↓
Codex Harness
      ↓
Shell / Git / MCP
```

大量核心 Agent 能力都不用重新造。

而且官方 Codex SDK 也已经支持启动、继续和恢复 thread；官方建议自动化任务/CI 更偏向 SDK，而需要自己构建完整客户端体验、处理历史记录、审批和事件流时使用 App Server。〔原会话引用 4〕

#### 不过有一个目前非常重要的限制

官方文档当前明确标注：**App Server 的 WebSocket transport 仍然是 experimental，并“不支持生产工作负载”**。〔原会话引用 5〕

所以我不会建议你第一版直接：

```text
Internet
   ↓
wss://your-server:4500
   ↓
codex app-server
```

然后让大量用户直接连接它。

更稳妥的是：

```text
                 Internet

手机 / Web / PC
       │
       │ HTTPS / WSS
       ▼
┌──────────────────────┐
│  你的 Agent Service  │
│                      │
│ Auth                 │
│ User                 │
│ Session              │
│ Rate Limit           │
│ Permission           │
│ Workspace            │
└──────────┬───────────┘
           │
      内部连接
           ▼
┌──────────────────────┐
│ Codex App Server     │
│                     │
│ Codex Harness        │
│ Agent Loop           │
└──────────┬───────────┘
           ▼
       Workspace
           │
           ▼
         GitHub
```

这样 **你的 Service 是 Control Plane，Codex App Server 是 Agent Engine**。

这正好也符合你“云端常驻 Agent”这个项目的方向。

还有一个好消息：Codex App Server 的实现本身已经在 `openai/codex` 仓库中开源，所以你并不是在对一个完全封闭的黑盒做封装。〔原会话引用 6〕

[Codex App Server 官方文档](https://developers.openai.com/zh-Hans/docs/app-server?utm_source=chatgpt.com)

如果你现在只是准备做**第一版自己使用的云端 Codex**，我反而建议先不要上 Redis、Worker Pool、K8s 这些东西，直接做 **`Linux Server + Docker + codex app-server + ai-idea workspace + WSS/VPN`**。先实现“电脑/手机 → 云端 Codex → 修改 GitHub 项目”，跑通之后再做多用户 Session 和 Worker 隔离。

---

<a id="chapter-5"></a>

## 5. Control Plane：管理 Agent、Session 与 Workspace

**用户问题**

> control plane 是什么意思？

**完整说明**

在我们刚才讨论的“云端 Codex”架构里，**Control Plane（控制平面）可以简单理解成：负责“管 Agent”，而不是负责“干活”的那一层。**

例如：

```text
用户
 │
 ▼
┌──────────────────────────┐
│      Control Plane       │
│        控制平面            │
│                          │
│  你是谁？                 │
│  你有哪些 Agent？          │
│  这次连接哪个 Agent？       │
│  Agent 使用哪个项目？       │
│  Session 是哪个？          │
│  有没有执行权限？           │
│  Agent 是否正在运行？       │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│     Execution Plane      │
│        执行平面            │
│                          │
│     Codex App Server     │
│            ↓             │
│       Codex Agent        │
│            ↓             │
│  read / edit / shell     │
│  git / test / MCP        │
└──────────────────────────┘
```

比如你在手机上输入：

> “进入 `ai-idea` 项目，继续昨天那个任务，把测试补上。”

**Control Plane** 负责搞清楚：

```text
用户是谁
   ↓
找到 ai-idea Agent
   ↓
找到昨天的 Session
   ↓
找到对应 Workspace
   ↓
检查权限
   ↓
启动 / 唤醒 Codex
   ↓
把用户消息交给 Codex
```

而 **Codex** 真正负责：

```text
理解需求
 ↓
读代码
 ↓
搜索代码
 ↓
修改代码
 ↓
执行 shell
 ↓
运行测试
 ↓
查看错误
 ↓
继续修改
 ↓
完成
```

所以两者职责完全不同。

你甚至可以把它类比成公司的“项目经理 + 工程师”：

```text
Control Plane ≈ 项目经理 / 调度中心
Codex Agent   ≈ 真正工作的工程师
```

当然 Control Plane 本身不会智能地决定代码应该怎么修改，它主要负责**管理、调度、权限和状态**。

对于你这个“云端常驻 Codex Agent”，第一版 Control Plane 其实不需要复杂。我认为最核心只需要管理四个对象：

```text
User
 │
 └── Agent
       │
       └── Session
              │
              └── Workspace
```

比如数据库里：

```text
User
  id: 1001

Agent
  id: codex-01
  owner: 1001

Session
  id: session-abc
  agent: codex-01

Workspace
  repo: ai-idea
  branch: feature/login
  path: /workspace/session-abc
```

这样未来客户端断开甚至服务器重启，再回来时 Control Plane 仍然知道：

> `yuwujian → codex-01 → session-abc → ai-idea workspace`

然后重新唤醒 Codex，继续干活。

所以你前面那个方案，我建议你脑子里先形成一个非常简单的模型：

```text
               你的云端 Codex

                    用户
                     │
                     ▼
              Control Plane
               “管理 Agent”
                     │
                     ▼
             Codex App Server
               “运行 Agent”
                     │
                     ▼
                Workspace
               “Agent 工作区”
                     │
                     ▼
                  GitHub
```

**Control Plane = 管理谁、在哪、什么时候、以什么权限使用哪个 Codex。**

**Codex App Server = 真正执行 Agentic Tool Loop。**

**Workspace = Codex 实际读代码、改代码、运行命令的地方。**

如果你目前只是**自己一个人使用、一个 `ai-idea` 仓库、一个云端 Codex**，甚至可以暂时不要完整的 Control Plane，只做一个很薄的 Gateway；等以后扩展到多个项目、多个 Agent、多用户时，再逐渐演变成完整 Control Plane。

---

<a id="chapter-6"></a>

## 6. Token、套餐、认证与额度管理

**用户问题**

> codex app server  token 套餐怎么办？

**完整说明**

这个问题很关键：**`codex app-server` 本身不附带一套独立的 Token 套餐。计费取决于你让 App Server 用哪种身份认证。**

官方目前支持两条与你最相关的路线：**ChatGPT 账号登录**和**API Key**。〔原会话引用 0〕

#### 1. 如果只是你自己使用：直接用 ChatGPT Pro

架构就是：

```text
你的手机 / Web
       │
       ▼
你的云端 Service
       │
       ▼
codex app-server
       │
       │ ChatGPT OAuth
       ▼
你的 ChatGPT Pro
       │
       ▼
Codex 套餐额度
```

App Server 支持 `chatgpt` 登录，会保存并自动刷新 OAuth Token，同时能读到 `planType`。也就是说，你在云服务器跑 App Server，并不意味着必须改成 API Token 计费。〔原会话引用 1〕

你当前这种**个人云端常驻 Codex**场景，我会优先采用这种方式。

Codex 使用的是 ChatGPT 套餐包含的 Codex allowance；达到套餐限制后，符合条件的 Plus/Pro 用户还可以购买 credits 继续使用。〔原会话引用 2〕

所以不是：

```text
云服务器运行
     ↓
必须 API 按 Token 付钱
```

而可以是：

```text
云服务器
   ↓
codex app-server
   ↓
登录你的 ChatGPT Pro
   ↓
使用 Pro Codex allowance
```

官方当前 Pro 提供不同用量档位，Codex 用量相对 Plus 为 5× 或 20×，具体额度仍受模型、任务复杂度、上下文等影响。〔原会话引用 3〕

---

#### 2. 如果以后给很多用户使用：不要共用你的 Pro

例如以后你的产品变成：

```text
用户 A ─┐
用户 B ─┼→ 云端 Codex Service
用户 C ─┤
用户 D ─┘
```

这时候就不应该简单地让所有用户：

```text
       ↓
你的 ChatGPT Pro
       ↓
Codex
```

更适合考虑：

```text
                    Control Plane
                         │
              ┌──────────┴──────────┐
              │                     │
        用户自己认证             平台统一计费
              │                     │
              ▼                     ▼
       ChatGPT Auth              API Key
              │                     │
              └─────────┬───────────┘
                        ▼
                Codex App Server
```

尤其是 SaaS/企业服务，**API Key 模式更容易做成本核算、预算、限流和内部计费**。使用自己的 API Key 时走 API 定价，而不是 ChatGPT Pro 的 Codex 套餐额度。〔原会话引用 4〕

---

#### 3. App Server 已经给你提供了“额度管理”接口

这个对你做 Control Plane 很有用。

App Server 有：

```text
account/read
account/rateLimits/read
account/usage/read
```

比如你自己的 Service 可以显示：

```text
┌──────────────────────────┐
│ Cloud Codex              │
│                          │
│ Account: yuwujian        │
│ Plan: Pro                │
│                          │
│ Codex Usage              │
│ ███████████░░░░   72%    │
│                          │
│ Session: ai-idea         │
│ Status: Running          │
└──────────────────────────┘
```

其中 `account/usage/read` 还能拿到 Token 活动摘要，例如 lifetime tokens、每日使用量等；App Server 也提供 rate-limit 相关接口。〔原会话引用 5〕

这意味着你不用自己从模型请求里重新统计所有东西。

---

#### 4. 对你这个项目，我建议分两个阶段

**现在：个人版**

```text
iPhone / Mac / Web
        │
        ▼
Cloud Agent Service
        │
        ▼
codex app-server
        │
        ▼
ChatGPT OAuth
        │
        ▼
你的 Pro Codex allowance
        │
        ▼
ai-idea workspace
```

优点就是简单，而且最大程度保留 Codex App 本身的使用模式。

**以后：多人版**

```text
                  Agent Control Plane
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
       User A          User B          User C
          │              │              │
          ▼              ▼              ▼
      Session A      Session B      Session C
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                   Worker Pool
                         │
                         ▼
                 Codex App Server
                         │
                  API / Enterprise
```

这时候再认真设计 token budget、用户限额、并发、模型路由和成本控制。

**因此，你现在不用因为“部署到服务器”就改成 API Token 计费。**对于你目前“把自己的 Codex 搬到云端，手机/电脑远程使用”的目标，先让 `codex app-server` 使用你的 ChatGPT 登录是最直接的方案；等它演变成真正给多用户使用的 Service，再切到 API/企业身份和独立计费体系。

[Codex App Server 官方文档](https://developers.openai.com/zh-Hans/docs/app-server?utm_source=chatgpt.com)  
[Codex 当前定价与套餐](https://developers.openai.com/zh-Hans/docs/pricing?utm_source=chatgpt.com)

---

<a id="chapter-7"></a>

## 7. 阶段性共识：个人云端 Codex 的落地方向

**用户问题**

> 牛逼， 解决了我的大问题

**完整说明**

哈哈，那就对上路子了 😄

你这个需求现在可以很明确地收敛成：

**云端 `codex app-server` + ChatGPT Pro OAuth + 持久 Workspace + 一个轻量 Control Plane。**

这样既复用了 Codex 已有的 Agent 能力，又不用自己重造 Agentic Tool Loop，第一阶段也不用专门搞 API Token 计费。

后面真正值得花精力的是 **Session 持久化、Workspace 隔离、远程连接安全、断线恢复、手机端交互**。这几个做好，基本就是你自己的“云端 Codex App”雏形了。

---

<a id="chapter-8"></a>

## 8. 动态 Skill：场景装配、渐进加载与 MCP 依赖

**用户问题**

> 如果我要动态加载 skill 呢？ 即不同场景使用的skill 集是不一样的。

**完整说明**

可以，而且这一步我建议你**不要把所有 Skill 永久塞进 Codex 的上下文**，而是在你自己的 Control Plane 里增加一个 **Skill Registry + Skill Resolver**，每次 Session/Run 根据场景动态组装 Skill Set。

核心结构可以变成：

```text
用户请求
   ↓
Control Plane
   ↓
Scene / Intent Resolver
   ↓
Skill Resolver
   ↓
本次需要的 Skill Set
   ↓
Codex App Server
   ↓
Agentic Tool Loop
```

例如你定义几个场景：

```yaml
scenes:
  frontend_dev:
    skills:
      - react
      - typescript
      - playwright
      - ui-review

  backend_dev:
    skills:
      - java
      - springboot
      - database
      - api-testing

  code_review:
    skills:
      - code-review
      - security-review
      - git

  overseas_project:
    skills:
      - playwright
      - commercial-doc-search
      - translation
      - compliance
```

当用户说：

> 帮我修改这个 React 页面，并用 Playwright 验证一下。

Control Plane 可以解析成：

```text
scene = frontend_dev

        ↓

Skill Resolver

        ↓

react
typescript
playwright
ui-review

        ↓

只把这 4 个 Skill
提供给当前 Codex Session / Run
```

而不是：

```text
Codex
 ├── skill 1
 ├── skill 2
 ├── skill 3
 ├── ...
 └── skill 87
```

这样做对上下文长度、Agent 工具选择准确率、权限隔离都会更好。

更进一步，我建议你把 **Skill 分成“描述”和“正文”两层**，做 Lazy Loading：

```text
Skill Registry

react
 ├── name
 ├── description
 ├── tags
 ├── permissions
 └── SKILL.md     ← 暂时不加载

playwright
 ├── name
 ├── description
 ├── tags
 ├── permissions
 └── SKILL.md     ← 暂时不加载
```

Agent 初始只看到很小的索引：

```text
Available Skills:

react
  React frontend development

playwright
  Browser automation and E2E testing

postgres
  PostgreSQL schema/query/database operations

code-review
  Code review workflow
```

当 Agent 判断：

> 我现在需要 Playwright。

再执行：

```text
load_skill("playwright")
```

然后才加载完整：

```text
skills/playwright/SKILL.md
```

也就是：

```text
                   Skill Registry
                         │
                 ┌───────┴───────┐
                 ▼               ▼
            Skill Index      Skill Content
             很小               很大
                 │
                 ▼
              Codex
                 │
        “我要 playwright”
                 │
                 ▼
        load_skill(playwright)
                 │
                 ▼
        SKILL.md 注入 Context
```

这其实就是 **Progressive Disclosure（渐进式加载）**。

---

对于你的“云端常驻 Agent”，我甚至建议再多做一级：

```text
Global Skills
     +
Agent Skills
     +
Project Skills
     +
Scene Skills
     +
Dynamic Skills
```

比如：

```text
Global
├── git
├── shell
└── coding-standard

CodingAgent
├── code-review
├── testing
└── debugging

ai-idea Project
├── project-architecture
├── deployment
└── project-conventions

当前场景 frontend_dev
├── react
├── typescript
└── playwright

当前任务动态发现
└── figma
```

最终一次 Run 的有效 Skill Set：

```text
Effective Skills
      =
Global
+
Agent
+
Project
+
Scene
+
Dynamic
```

这就非常适合你现在这个 **云端常驻 Agent 平台**。

而且这里还有一个非常重要的设计：**Skill 和 MCP 不要混为一谈。**

```text
Skill
=
“Agent 应该怎么做”
知识 / SOP / Workflow / Prompt

MCP
=
“Agent 能调用什么”
外部能力 / Tool / Resource
```

例如：

```text
playwright skill
      │
      │ 告诉 Codex：
      │ 如何测试、什么时候截图、
      │ 如何判断页面是否正常……
      ▼
Codex
      │
      │ 调用
      ▼
Playwright MCP
      │
      ▼
真实浏览器
```

因此以后你的 Skill Registry 甚至可以声明依赖：

```yaml
name: frontend-e2e

description: >
  Frontend E2E testing workflow.

requires:
  mcp:
    - playwright

skills:
  - frontend-testing

permissions:
  network: true
  browser: true
```

Control Plane 加载这个 Skill 时发现：

```text
frontend-e2e
      ↓
requires playwright MCP
      ↓
检查当前 Sandbox
      ↓
没有
      ↓
挂载 Playwright MCP
      ↓
加载 SKILL.md
      ↓
启动 Codex Run
```

这样你的 **Skill Resolver 同时就变成了 Capability Resolver**。

最终我会把你的架构做到这一层：

```text
                 User Request
                      │
                      ▼
              ┌───────────────┐
              │ Control Plane │
              └───────┬───────┘
                      │
              Scene Resolver
                      │
                      ▼
               Skill Resolver
                      │
             ┌────────┴────────┐
             ▼                 ▼
      Skill Registry      MCP Registry
             │                 │
             └────────┬────────┘
                      ▼
              Capability Set
                      │
                      ▼
             Codex App Server
                      │
                      ▼
               Agentic Loop
                      │
             ┌────────┼────────┐
             ▼        ▼        ▼
           Skill     MCP      Shell
             │        │        │
             └────────┼────────┘
                      ▼
                  Workspace
```

**这一步其实已经开始从“云端部署一个 Codex”升级成“Agent Platform”了。**

尤其你后面如果要同时支持 Coding、QA、PM、Archive，甚至你刚研究的 TradingAgents，这套机制会非常有价值：**底层 Codex Runtime 不变，根据 Agent + Project + Scene 动态装配不同 Skill/MCP/权限组合。**这会比为每个场景部署一套独立 Agent 干净很多。

---

<a id="chapter-9"></a>

## 9. Gateway 的作用与单服务 MVP

**用户问题**

> agent api gateway 是什么，有什么作用，可以不要吗？

**完整说明**

可以不要，尤其是你现在这个**个人使用、单个云端 Codex** 的阶段。

先把概念说清楚：**Agent API Gateway 就是客户端和 Agent Runtime 之间的统一入口。**它自己通常不负责写代码，而负责“接请求、认用户、找 Agent、找 Session、转发请求、返回事件”。

```text
有 Gateway：

手机 / Web / PC
      │
      ▼
┌────────────────────┐
│ Agent API Gateway  │
│                    │
│ 鉴权                │
│ Session 路由        │
│ 限流                │
│ 权限                │
│ API 协议            │
│ SSE / WebSocket    │
│ 日志                │
└─────────┬──────────┘
          ▼
   Control Plane
          ▼
  Codex App Server
          ▼
     Workspace
```

比如客户端发：

```http
POST /agents/codex/sessions/123/messages
```

Gateway 判断：“这是用户 A → Session 123 → 对应 Codex 实例/Workspace”，然后再转给后面的系统。

#### Gateway 和 Control Plane 不完全是一回事

这个区别对你的架构很重要。

**Gateway 负责入口，Control Plane 负责管理。**

```text
             Client
                │
                ▼
        ┌───────────────┐
        │ API Gateway   │
        │ 对外通信       │
        └───────┬───────┘
                ▼
        ┌───────────────┐
        │ Control Plane │
        │ Agent 管理     │
        └───────┬───────┘
                ▼
        Codex App Server
```

比如：

```text
Gateway:
“这个 HTTP/WebSocket 请求是否合法？”

Control Plane:
“这个用户应该连接哪个 Agent？
这个 Session 对应哪个 Workspace？
应该加载哪些 Skill？
应该挂载哪些 MCP？”
```

所以你刚才讲的动态 Skill，实际上主要应该由 **Control Plane / Skill Resolver** 管，而不是 Gateway。

---

### 你现在完全可以不要独立 Gateway

如果现在只是：

> 我自己使用，把本地 Codex 搬到云服务器，然后手机/电脑远程访问。

第一版我甚至建议：

```text
Client
   │
   │ VPN / 私网
   ▼
Control Service
   │
   ▼
Codex App Server
   │
   ▼
Workspace
```

甚至进一步：

```text
Client
   │
   ▼
Codex App Server
   │
   ▼
ai-idea
```

先把 Codex Remote 跑起来。

没必要第一天就：

```text
Nginx
 ↓
API Gateway
 ↓
Auth Service
 ↓
Control Plane
 ↓
Scheduler
 ↓
Redis
 ↓
Worker
 ↓
Codex
```

这对于你目前的需求属于过度设计。

---

### 什么时候 Gateway 开始有价值？

当你的系统从：

```text
我
 ↓
1 个 Codex
```

发展成：

```text
        User A
        User B
        User C
           │
           ▼
      API Gateway
           │
           ▼
     Control Plane
           │
     ┌─────┼─────┐
     ▼     ▼     ▼
 Codex A Codex B Codex C
```

它就很有用了。

尤其出现这些需求之后：多用户登录、Token/JWT 鉴权、不同用户不同权限、多个 Codex 实例、限流、API Key、WebSocket/SSE、审计日志、统一错误处理、负载均衡、外部系统调用 Agent。

比如未来 PQCP 调你的 Agent：

```text
PQCP ─────────┐
              │
Web App ──────┤
              ▼
Mobile ──→ Agent Gateway
              │
IDE ──────────┤
              │
企业微信 ──────┘
              ↓
        Control Plane
```

Gateway 就变成统一入口。

---

### 对你现在这个项目，我建议再简化一个概念

实际上你**不需要一开始把 Gateway 和 Control Plane 做成两个服务**。

做一个：

```text
agent-server
```

里面同时包含：

```text
agent-server
│
├── API
│   ├── HTTP
│   ├── WebSocket
│   └── Auth
│
├── Session Manager
│
├── Agent Manager
│
├── Skill Resolver
│
├── MCP Manager
│
├── Workspace Manager
│
└── Codex Adapter
        │
        ▼
  codex app-server
```

逻辑上：

```text
API 部分
≈ Gateway

管理部分
≈ Control Plane
```

但物理上就是**一个服务、一个进程/Container**。

等以后用户和 Agent 数量上来，再拆：

```text
              Agent Gateway
                    │
                    ▼
              Control Plane
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
      Worker 01 Worker 02 Worker 03
          │         │         │
        Codex     Codex     Codex
```

#### 所以你当前 MVP 我会定成这样

```text
              iPhone / Mac / Web
                      │
                  HTTPS/WSS
                      │
                      ▼
              ┌──────────────┐
              │ Agent Server │
              │              │
              │ API          │
              │ Session      │
              │ Skill        │
              │ MCP          │
              │ Workspace    │
              └──────┬───────┘
                     │
                     ▼
              Codex App Server
                     │
                     ▼
                Workspace
                     │
                     ▼
                   GitHub
```

**先不要独立 Agent API Gateway。**

你真正应该优先做的是 **Agent Server + Codex App Server + Session + Workspace + 动态 Skill/MCP**。

等以后需要多用户、多 Agent、多节点的时候，再把 `Agent Server` 里的 API 层剥离出来成为真正的 **Agent API Gateway**。

这样你的第一版会轻很多，同时架构上又不会把未来的扩展路线堵死。

---

<a id="chapter-10"></a>

## 10. 缓存体系：数据、Agent Knowledge 与 Prompt Cache

**用户问题**

> 都到这里了， 给我展开讲讲 缓存 及缓存命中是什么意思？

**完整说明**

可以。结合我们刚才的 **云端 Codex Agent** 来讲，缓存会非常直观。

一句话先建立概念：

> **缓存（Cache）= 把以前计算过、读取过、生成过的结果临时保存起来，下次遇到相同或相似需求时直接复用。**
>
> **缓存命中（Cache Hit）= 这次需要的数据刚好已经在缓存里，所以不用重新做一遍。**

---

### 1. 先看一个最简单的例子

假设你的 Agent 每次启动都需要读取：

```text
ai-idea/
├── README.md
├── AGENTS.md
├── package.json
└── docs/
```

第一次：

```text
Codex
  ↓
读取 AGENTS.md
  ↓
磁盘 IO
  ↓
解析
  ↓
得到结果
```

花了 50ms。

如果你把结果放进缓存：

```text
Cache

key:
project:ai-idea:AGENTS.md

value:
解析后的内容
```

第二次再需要：

```text
Codex
  ↓
我要 AGENTS.md
  ↓
检查 Cache
  ↓
找到了！
  ↓
直接返回
```

这就叫：

**Cache Hit / 缓存命中。**

反过来：

```text
Codex
  ↓
我要 user-service.ts
  ↓
检查 Cache
  ↓
没有
  ↓
读取磁盘
```

这叫：

**Cache Miss / 缓存未命中。**

然后通常会：

```text
Cache Miss
   ↓
从原始数据源读取
   ↓
得到结果
   ↓
写入 Cache
   ↓
返回给 Agent
```

所以下一次就可能 Hit。

---

### 2. 为什么要缓存？

主要解决四个问题：

**速度、成本、并发、重复计算。**

例如你的云端 Agent：

```text
用户
 ↓
Agent Server
 ↓
Codex
 ↓
读取 100 个项目文件
 ↓
分析
 ↓
LLM
 ↓
MCP
 ↓
GitHub
```

这里很多东西其实会重复。

例如：

```text
项目结构
package.json
AGENTS.md
Skill Index
GitHub Repository 信息
MCP Tool Schema
依赖关系
代码索引
LLM Prompt Prefix
```

如果每一次用户发一句：

> “继续。”

你都重新：

```text
读取
→ 解析
→ 网络请求
→ Token 输入
→ 计算
```

就很浪费。

缓存就是：

```text
第一次：算一次 → 保存

第二次：直接用
第三次：直接用
第四次：直接用
```

---

### 3. 缓存命中率是什么？

这是你以后做 Agent Server 很常见的指标：

**Cache Hit Rate（缓存命中率）**

公式非常简单：

```text
缓存命中次数
──────────────
总缓存请求次数
```

比如：

```text
100 次请求缓存

80 次找到了
20 次没找到
```

那么：

```text
Cache Hit Rate
= 80 / 100
= 80%
```

也就是：

> **缓存命中率 80%。**

通常命中率越高，意味着重复工作越少。

但不是“越高就一定越好”，后面会讲为什么。

---

### 4. 缓存的核心其实是 Key → Value

绝大多数缓存都可以理解成：

```text
Key → Value
```

例如：

```text
"user:1001"
    ↓
{ name: "xxx", role: "admin" }
```

Agent 场景：

```text
"project:ai-idea:structure"
    ↓
项目目录树
```

Skill 场景：

```text
"skill:playwright:v3"
    ↓
playwright SKILL.md 内容
```

GitHub 场景：

```text
"github:ai-idea:main:latest_commit"
    ↓
abc123
```

甚至 LLM：

```text
hash(prompt + context)
        ↓
LLM response
```

所以缓存系统最重要的问题之一就是：

> **什么东西算“同一个东西”？**

这实际上就是在设计 Cache Key。

---

### 5. 你的云端 Codex 会有很多层缓存

真正有意思的是这里。

你的架构以后可能不是“一个缓存”，而是：

```text
                 User
                   │
                   ▼
             Agent Server
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
    Session     Skill       Project
     Cache      Cache        Cache
                   │
                   ▼
            Codex App Server
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
      Prompt      Tool       File
      Cache       Cache      Cache
                   │
                   ▼
              Workspace
                   │
                   ▼
                GitHub
```

分别看。

#### Session Cache

用户刚才在：

```text
session-abc
```

里面使用：

```text
repo = ai-idea
branch = dev
workspace = /workspace/abc
skills = [java, playwright]
```

这些东西如果每次都查 PostgreSQL，就没必要。

可以：

```text
Redis

session:abc
    ↓
{
  repo: "ai-idea",
  branch: "dev",
  workspace: "...",
  skills: [...]
}
```

用户下一句话：

> “继续。”

直接：

```text
GET session:abc
```

**命中 → 直接恢复 Session。**

---

### 6. Skill Cache 对你尤其重要

我们刚才讲了动态 Skill：

```text
用户请求
 ↓
Scene Resolver
 ↓
Skill Resolver
 ↓
加载 Skill
```

假设：

```text
frontend-development
```

经常需要：

```text
react
typescript
playwright
code-review
```

第一次：

```text
Skill Resolver
 ↓
读取 Skill Registry
 ↓
读取 SKILL.md
 ↓
解析 metadata
 ↓
检查 MCP dependency
 ↓
得到 Skill Set
```

可以缓存：

```text
scene:frontend-development:v5
          ↓
[
  react,
  typescript,
  playwright,
  code-review
]
```

下一次：

```text
frontend-development
 ↓
Cache
 ↓
HIT
 ↓
直接得到 Skill Set
```

这就省掉很多解析工作。

---

### 7. Project Cache 会非常重要

Codex 最贵的事情之一不是单纯“读文件”，而是**反复理解项目**。

例如每次 Agent 都重新理解：

```text
ai-idea

是什么项目？
 ↓
目录结构是什么？
 ↓
技术栈是什么？
 ↓
入口在哪里？
 ↓
模块关系是什么？
 ↓
测试怎么运行？
 ↓
Build 怎么执行？
```

其实很多信息变化并不频繁。

所以以后你完全可以有：

```text
Project Knowledge Cache
```

例如：

```text
project:ai-idea:commit:abc123
                │
                ▼
{
  language: "TypeScript",
  framework: "...",
  build_command: "...",
  test_command: "...",
  modules: [...],
  architecture: ...,
  dependency_graph: ...
}
```

下一次 Agent：

> “帮我修改登录模块。”

就不用完全从零理解。

---

### 8. 但是缓存有一个最大的问题：数据会过期

这是理解缓存最重要的一点。

假设缓存里：

```text
user-service.ts
version = v1
```

但是 Codex 修改了：

```text
user-service.ts
version = v2
```

缓存还保存：

```text
v1
```

下一次 Agent：

```text
读取 Cache
 ↓
HIT
 ↓
拿到了 v1
```

虽然：

> **缓存命中了。**

但拿到的是：

> **错误的旧数据。**

这叫：

**Stale Cache（陈旧缓存）。**

所以：

> Cache Hit ≠ 数据一定正确。

这也是缓存设计真正困难的地方。

---

### 9. 所以就出现了 Cache Invalidation

中文一般叫：

**缓存失效 / 缓存失效策略。**

例如 Codex 修改：

```text
src/auth.ts
```

Workspace Manager 可以立即：

```text
write src/auth.ts
       ↓
删除缓存

project:ai-idea:file:src/auth.ts
       ↓
INVALIDATE
```

下一次：

```text
read auth.ts
 ↓
Cache
 ↓
MISS
 ↓
读取最新文件
 ↓
重新 Cache
```

于是：

```text
修改数据
 ↓
让旧 Cache 失效
 ↓
下一次重新加载
```

这是非常经典的模式。

---

### 10. TTL 又是什么？

你以后会经常看到：

```text
TTL = 60s
TTL = 5min
TTL = 1h
```

TTL = **Time To Live**

也就是：

> 这份缓存最多活多久。

比如 GitHub Repo 信息：

```text
github:ai-idea:repo-info

TTL = 5 min
```

意味着：

```text
19:00 写入 Cache

19:01 → HIT
19:02 → HIT
19:04 → HIT

19:05 → 过期

19:06 → MISS
        ↓
重新请求 GitHub
        ↓
写入新 Cache
```

所以缓存系统通常有两种主要失效方式：

```text
主动失效
修改数据 → 删除 Cache

           +

被动过期
TTL 到期 → 自动删除
```

---

### 11. Redis 是干什么的？

你以后做 Agent Server，大概率会碰到 Redis。

Redis 本质上是一个非常快的内存数据存储系统，经常被拿来做缓存。

例如：

```text
PostgreSQL
    ↓
硬盘 / 持久化
    ↓
比较慢

Redis
    ↓
内存
    ↓
非常快
```

典型架构：

```text
Agent Server
     │
     ▼
    Redis
     │
  HIT│   │MISS
     │   ▼
     │ PostgreSQL
     │   │
     │   ▼
     │ 原始数据
     │   │
     └───┘
```

伪代码：

```python
session = redis.get(session_id)

if session:
    return session       # Cache Hit

session = database.get(session_id)

redis.set(session_id, session)

return session           # Cache Miss
```

---

### 12. 但是 Agent 领域还有一个更重要的“缓存”

这就是你以后经常看到的：

**Prompt Cache / Context Cache。**

假设 Codex 每次调用模型都带：

```text
System Prompt
+
AGENTS.md
+
Skill A
+
Skill B
+
Tool Definitions
+
Project Context
+
Conversation
+
当前问题
```

比如总共：

```text
50,000 tokens
```

但是前面的：

```text
40,000 tokens
```

连续很多次调用其实完全一样。

于是模型服务可以识别：

```text
第一次

AAAA BBBB CCCC DDDD XXXX
^^^^^^^^^^^^^^^^^^^^
没有缓存
```

第二次：

```text
AAAA BBBB CCCC DDDD YYYY
^^^^^^^^^^^^^^^^^^^^
相同 prefix
```

前面这部分可能：

**Prompt Cache Hit。**

于是不用完全按照“新的 40K token 前缀”重新做同样的处理。

---

### 13. 这对 Agentic Tool Loop 特别重要

还记得我们之前说的吗：

```text
LLM
 ↓
Tool
 ↓
Result
 ↓
LLM
 ↓
Tool
 ↓
Result
 ↓
LLM
```

例如：

```text
Round 1

System
+ Skills
+ Project Context
+ User
```

然后：

```text
Round 2

System
+ Skills
+ Project Context
+ User
+ Tool Call 1
+ Tool Result 1
```

Round 3：

```text
System
+ Skills
+ Project Context
+ User
+ Tool Call 1
+ Tool Result 1
+ Tool Call 2
+ Tool Result 2
```

你会发现：

**前面绝大部分 Context 一直没变。**

所以 Agent 特别适合 Prefix/Prompt Caching。

```text
┌─────────────────────────────┐
│ System                      │ ← Cache
│ AGENTS.md                   │ ← Cache
│ Skills                      │ ← Cache
│ Tool definitions            │ ← Cache
│ Project Context             │ ← Cache
│ Conversation                │
├─────────────────────────────┤
│ 新 Tool Result              │ ← 新内容
└─────────────────────────────┘
```

这也是为什么以后你看 Agent 的 Token Usage 时，经常不能只看：

```text
Input Tokens
Output Tokens
```

还要看：

```text
Cached Input Tokens
```

---

### 14. 这和你前面“动态 Skill”其实直接相关

假设你每次都改变 Skill 排序：

第一次：

```text
git
react
playwright
typescript
```

第二次：

```text
typescript
react
git
playwright
```

内容虽然差不多，但 Prompt Prefix 发生变化。

缓存可能就不好复用了。

所以成熟 Agent Runtime 会尽量：

```text
固定 System Prompt
        ↓
固定 Tool Definitions
        ↓
稳定 Skill Index
        ↓
稳定 Project Context
        ↓
动态 Conversation
        ↓
动态 Tool Results
```

可以理解为：

```text
██████████████████████████░░░░░

██████████████████████████ = 稳定区域
░░░░░ = 动态区域
```

稳定区域越容易复用，Prompt Cache 的价值通常越大。

---

### 15. 对你的云端 Codex，我会把缓存分成三类

这个分类你可以先记住：

```text
                 Cache

        ┌──────────┼──────────┐
        ▼          ▼          ▼

     数据缓存     Agent缓存    模型缓存

      Redis      Project      Prompt
      Session    Skill        Context
      GitHub     Index        Prefix
      MCP        Knowledge
```

#### 第一类：系统缓存

主要为了**性能**：

```text
Session
User
权限
GitHub metadata
MCP metadata
```

可以考虑 Redis。

#### 第二类：Agent Knowledge Cache

主要为了**减少重复理解**：

```text
Project Structure
Code Index
Dependency Graph
Skill Index
Project Summary
```

可以落数据库、文件、搜索索引等，不一定全放 Redis。

#### 第三类：Model / Prompt Cache

主要为了**减少重复模型计算和 Token 成本**：

```text
System Prompt
Tool Schema
Skill
Project Context
Conversation Prefix
```

这通常由模型/API/Codex Runtime的缓存机制参与处理。

---

### 最后，用你这个项目串起来

你的最终架构以后可能长这样：

```text
                    Client
                      │
                      ▼
               Agent Server
                      │
           ┌──────────┼──────────┐
           │          │          │
           ▼          ▼          ▼
        Session     Skill      Project
         Cache      Cache       Cache
           │          │          │
           └──────────┼──────────┘
                      ▼
               Control Plane
                      │
                      ▼
              Codex App Server
                      │
                Prompt Cache
                      │
                      ▼
               Agentic Tool Loop
                      │
             ┌────────┼────────┐
             ▼        ▼        ▼
           Shell     MCP      Git
             │        │        │
             └────────┼────────┘
                      ▼
                  Workspace
```

所以你现在可以把几个词彻底区分开：

**Cache**：以前的结果保存起来。

**Cache Hit**：这次正好找到了，可以复用。

**Cache Miss**：没找到，需要重新计算/读取。

**Hit Rate**：所有查询中有多少比例命中了。

**TTL**：缓存能活多久。

**Invalidation**：原始数据变化后，让旧缓存作废。

**Stale Cache**：缓存命中了，但内容已经旧了。

**Prompt Cache**：LLM 输入中重复的前缀/上下文被复用。

而对于你现在这个 **Codex App Server + 动态 Skill** 的方案，最后一个 **Prompt Cache** 尤其值得继续深入，因为它会直接影响你以后 Agent 的 **Token 消耗、响应速度以及 Skill 动态加载策略**。

---

<a id="chapter-11"></a>

## 11. 会话末尾的保存请求

**用户问题**

> 将以上内容保存到文件中，目录： /Users/yuwujian/Documents/ChatGPT/project/codex-server/

**完整说明**

已交给 Work 模式处理：会把上面的“缓存与缓存命中”内容整理成 Markdown，并保存到你指定的 `codex-server` 目录。
