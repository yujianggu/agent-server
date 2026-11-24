# 结构与内容维护

## 新增主题

在合适分类下建立独立主题目录，提供 `README.md` 正文和 `topic.json`。未填充分类仅保留空分类索引；有正文后再注册主题，不创建指向不存在文件的入口。

主题字段沿用 kb 约定：

- `id`：小写字母、数字、点、下划线或连字符，建议使用 `codex.` 前缀；发布后保持稳定。
- `title`、`summary`：标题和主题选择用途说明。
- `kind`：concept、method、template、example、reference。
- `scope`：general、industry、company。
- `status`：general、reference、example。reference 表示原义待核实，example 表示教学或设计示例；general 不代表科学认证或已完成复核。
- `entrypoints`：必须有 detail，可选 examples、sources、assets；值为相对元数据目录的路径或有序路径数组。
- `requires`、`related`：必需依赖和可选关联主题 ID，默认空数组。

正文开头注明概述、适用边界及内容状态；来源在正文或来源页维护，记录来源定位、产品范围、版本或提交、核验日期，并区分事实、推断和建议。补充内容前需核对对应版本，不能用历史版本材料证明当前行为。

在最近一层 catalog.json 的 topics 中登记 id、title、summary、kind、scope、status、metadata，与 topic.json 保持一致；更新分类 README 导航。catalog 中所有路径均相对本知识库根目录。kb.json 与根 catalog.json 的领域注册同步维护。

不新增独立摘要文件，不设置 brief 入口。来源、示例和资产只在实际需要时创建。来源修订后复核受影响主题；问答和运行经验经验证后才转为正式知识。

## 校验

检查 JSON 可解析，领域注册和索引一致，主题 ID 唯一，卡片与元数据一致，requires 和 related 均可解析，必需依赖无循环；检查目录入口、正文入口和 Markdown 相对链接存在且不越界。未填充的分类保持空 topics，不添加虚构知识或已验证声明。

本次只建立文件式知识库；后续是否采用自动检索、编译、图谱或行动执行，应按实际任务另行决定。
