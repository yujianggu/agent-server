# 按需加载约定

本知识库根目录为 `codex/`，不是上层 Git 仓库目录。

1. 首次读取根 README.md 和 catalog.json，选择领域。
2. 沿选定的 `domains[].catalog` 和 `groups[].catalog` 下钻，按主题 `summary` 选择入口，不递归展开全库。
3. 读取主题卡片 `metadata` 指向的 topic.json，再读取 `entrypoints.detail`；正文必须包含概述与适用边界。
4. `examples`、`sources`、`assets` 按任务需要读取；`requires` 是必需依赖，`related` 不自动展开。按 ID 和路径去重，依赖循环必须修正。

所有 catalog.json 路径相对本知识库根目录；topic.json 的 entrypoints 路径相对该元数据目录，禁止越出本库。

空的 topics 表示尚未收录，不代表该分类没有相关能力。占位 README 不是知识正文，不能据其作出产品能力或版本结论。不提供独立摘要文件或 brief 入口。

后续使用知识须保留来源、版本、核验日期和适用边界。CLI、桌面应用、云端服务与模型能力应注明各自范围。正式跨项目复用固定 Git 提交，并记录实际读取的主题 ID、层级和文件；未提交改动需额外记录。
