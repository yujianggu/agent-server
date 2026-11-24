# 缓存与缓存命中：云端 Codex Agent 架构说明

> 整理自 ChatGPT 对话「实现常驻Codex服务」中关于缓存的完整回答。
> 本文保留原文示例、代码与 ASCII 架构图，仅统一标题层级并添加目录。示例中的耗时、Token 数量和架构用于概念说明，不代表实测指标或已实现的功能。

> 实现核对补充：本文是概念方案，Redis、Project Cache 等不代表 Codex 已有功能。基于 `rust-v0.171.0` 源码的机制说明见 [Codex 缓存策略与实现](codex/架构/运行机制/缓存策略与实现/README.md)，指标与排查见 [缓存诊断](codex/运维/监控与诊断/缓存诊断/README.md)。

来源：[实现常驻Codex服务](chatgpt-conversation://6aad2312-d71c-83ec-b481-13b82f4c0994)

## 目录

- 1. 先看一个最简单的例子
- 2. 为什么要缓存？
- 3. 缓存命中率是什么？
- 4. 缓存的核心其实是 Key → Value
- 5. 你的云端 Codex 会有很多层缓存
- 6. Skill Cache 对你尤其重要
- 7. Project Cache 会非常重要
- 8. 但是缓存有一个最大的问题：数据会过期
- 9. 所以就出现了 Cache Invalidation
- 10. TTL 又是什么？
- 11. Redis 是干什么的？
- 12. 但是 Agent 领域还有一个更重要的“缓存”
- 13. 这对 Agentic Tool Loop 特别重要
- 14. 这和你前面“动态 Skill”其实直接相关
- 15. 对你的云端 Codex，我会把缓存分成三类
- 16. 完整架构与关键概念速查

---

可以。结合我们刚才的 **云端 Codex Agent** 来讲，缓存会非常直观。

一句话先建立概念：

> **缓存（Cache）= 把以前计算过、读取过、生成过的结果临时保存起来，下次遇到相同或相似需求时直接复用。**
>
> **缓存命中（Cache Hit）= 这次需要的数据刚好已经在缓存里，所以不用重新做一遍。**

---

## 1. 先看一个最简单的例子

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

## 2. 为什么要缓存？

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

## 3. 缓存命中率是什么？

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

## 4. 缓存的核心其实是 Key → Value

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

## 5. 你的云端 Codex 会有很多层缓存

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

### Session Cache

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

## 6. Skill Cache 对你尤其重要

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

## 7. Project Cache 会非常重要

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

## 8. 但是缓存有一个最大的问题：数据会过期

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

## 9. 所以就出现了 Cache Invalidation

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

## 10. TTL 又是什么？

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

## 11. Redis 是干什么的？

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

## 12. 但是 Agent 领域还有一个更重要的“缓存”

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

## 13. 这对 Agentic Tool Loop 特别重要

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

## 14. 这和你前面“动态 Skill”其实直接相关

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

## 15. 对你的云端 Codex，我会把缓存分成三类

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

### 第一类：系统缓存

主要为了**性能**：

```text
Session
User
权限
GitHub metadata
MCP metadata
```

可以考虑 Redis。

### 第二类：Agent Knowledge Cache

主要为了**减少重复理解**：

```text
Project Structure
Code Index
Dependency Graph
Skill Index
Project Summary
```

可以落数据库、文件、搜索索引等，不一定全放 Redis。

### 第三类：Model / Prompt Cache

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

## 16. 完整架构与关键概念速查

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
