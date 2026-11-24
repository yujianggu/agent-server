# Agent Server

> 项目正在重新设计。当前确认的约定见下方“当前设计”，旧方案和原型按历史资料查阅。

## 当前设计

- [专家与插件的定位及关系](docs/design/专家与插件.md)：已确认的专家定义、Codex 插件模式、技能职责、绑定关系及业务示例。

## 历史方案与资料

围绕 Codex App Server 构建持续会话的 Agent 服务，为自有客户端提供任务交互、会话与工作区管理、事件及审批往返。

**已确定采用 Codex App Server 作为执行引擎。** 访问链路为：

```text
用户端（Web/App）→ 网关（可选）→ Agent Server → Codex App Server
```

省略网关时，用户端直接连接 Agent Server。响应、事件与审批沿链路双向交互。当前已完成产品方案与可交互 Web 原型，尚未接入真实运行服务。

- [旧实施方案](codex-server-complete-plan.md#方案总览)：服务链路、职责边界、最小闭环与验收条件。
- [架构决策记录](docs/decisions/0001-codex-app-server.md)：历史选型与决策追溯。
- [Web 交互原型](https://agent-workspace-prototype-1123.gratefulcouch5.chatgpt.site)：私有预览，包含对话、插件管理、知识库管理。
- [原型源码与运行说明](web-prototype/README.md)：本地演示边界和启动方式。
- [Codex 知识库](codex/README.md)：按业务、架构、工程、运维组织的知识与源码研究。
- [方案中的历史讨论](codex-server-complete-plan.md#chapter-1)：原始讨论记录与方案演进。
- [缓存概念笔记](cache-and-cache-hit.md)：概念说明，具体实现以知识库的版本核验为准。

后续设计以“当前设计”中已确认的约定及项目负责人的新要求为依据。
