# 云端常驻 Codex 服务：完整会话方案整理

来源：[实现常驻Codex服务](chatgpt-conversation://6aad2312-d71c-83ec-b481-13b82f4c0994)  
整理日期：2026-09-19  
范围：该会话从最初的常驻服务请求到最后的保存请求，共 11 轮。

> 阅读说明：开头为整段会话的方案归纳；正文保留全部问题与回答、示例、代码和 ASCII 架构图，仅整理标题层级与引用标记。原会话中的产品状态、套餐和接口描述属于历史讨论记录。原始引用中无法从会话读取结果还原链接的标记，显示为「〔原会话引用 N〕」；原文已有的链接照常保留。

## 目录

- [方案总览](#overview)
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

<a id="overview"></a>

## 方案总览

本节依据整段会话归纳；后续章节按讨论顺序保留每轮问题和完整回答。

### 目标与最后收敛的方向

目标是把 Codex 的执行环境放在云端，通过手机、Mac 或 Web 持续访问同一个项目和会话，具备读写代码、运行命令、查看 diff、测试和继续任务的能力。

会话最终收敛到：以 **Codex App Server 作为执行引擎**，在外层按需添加自己的 **Agent Server**，管理 Session、Workspace、动态 Skill/MCP 和客户端连接。第一版面向个人使用，不必把 Gateway 和 Control Plane 拆成独立服务。

```text
             iPhone / Mac / Web
                      │
               HTTPS/WSS 或 VPN
                      │
                      ▼
                 Agent Server
        ┌─────────────┼─────────────┐
        │ API / Auth  │ Session     │
        │ Skill/MCP   │ Workspace   │
        │ Codex Adapter             │
        └─────────────┬─────────────┘
                      │
                      ▼
               Codex App Server
                      │
               Agentic Tool Loop
                      │
             ┌────────┼────────┐
             ▼        ▼        ▼
           Shell     MCP      Git
             └────────┼────────┘
                      ▼
                  Workspace
                      │
                      ▼
                    GitHub
```

### 为什么会话前后出现不同架构

| 讨论阶段 | 当时讨论的方案 | 在完整方案中的位置 |
|---|---|---|
| 最初询问常驻服务 | API → Queue → Codex Worker → Sandbox | 通用任务服务的起点 |
| 明确要 Codex App 式体验 | 长生命周期 Session + 持久化 Workspace + 按需 Worker | 明确连续对话与状态恢复的需求 |
| 明确想直接把 Codex 搬到云端 | 复用 Codex App Server 与其 Agent 能力 | 后续实现方向 |
| 讨论动态 Skill | Registry + Resolver + 场景装配 + MCP 依赖 | 自有管理层的扩展能力设计 |
| 讨论 Gateway 是否必需 | 单个 Agent Server 合并 API 与管理职责 | 个人版 MVP 的简化方案 |
| 讨论缓存 | 系统缓存、项目知识缓存、模型前缀缓存 | 性能与上下文管理的后续设计 |

因此，前面“自建 Runtime / Queue / Worker”的图保留为方案演进背景。后面复用 Codex App Server 的方案，并不要求第一版同时实现前文所有组件。

### 关键职责

| 对象或组件 | 会话中的职责 |
|---|---|
| Client | 对话、任务状态、事件、审批、diff 等交互 |
| Agent Server | 自有服务入口和管理层；个人版可放在一个服务中 |
| Gateway | 鉴权、请求入口、路由、事件转发等逻辑职责 |
| Control Plane | 管理用户、Agent、Session、Workspace、权限与能力选择 |
| Codex App Server | 复用 Codex 的 Agent 执行与会话交互能力 |
| Session | 连接连续对话、任务状态和工作区 |
| Workspace | 保存仓库、分支、worktree、代码与执行产物 |
| Skill Registry / Resolver | 保存技能描述，按 Agent、项目、场景和任务选择技能 |
| MCP | 提供可调用的外部工具与资源 |
| Cache | 复用已有数据、项目知识或模型输入处理结果 |

### 会话提出的分阶段路线

1. **个人版基础闭环**：云服务器上的 Codex App Server + 项目 Workspace + 远程连接，跑通继续会话、修改代码和验证结果。
2. **自己的 Agent Server**：增加 Session/Workspace 映射、客户端交互、事件处理、断线恢复，以及按场景选择 Skill/MCP。
3. **按需要优化缓存**：区分 Session、Skill、Project 与 Prompt Cache，并处理版本、TTL 和主动失效。
4. **多人、多 Agent 或多节点扩展**：再考虑独立 Gateway、Worker Pool、隔离、调度、额度预算及独立计费。

认证与套餐部分保留了原会话提出的个人 ChatGPT 登录和 API Key 两条路线；动态 Skill 的 Registry、Resolver、依赖声明和加载函数属于方案设计。原文中的命令、接口、套餐倍数和实验状态均作为当时讨论记录保留，本次整理未重新验证其当前可用性。


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
