# Codex UI replica

独立的界面交互原型，浏览器打开 index.html 即可使用，无需安装依赖。
也可在本目录运行 `python3 -m http.server 8765 --bind 127.0.0.1`。

已实现：创建会话、消息和历史持久化、打开历史会话、搜索、项目名称修改、侧栏折叠、浅深色主题、设置/技能/自动化占位页、模型与强度选择、附件文件名、Enter 发送及 Shift+Enter 换行。
回复为本地模拟；模型选择不触发推理，附件不读取或上传文件内容，未连接编辑器或执行服务。

## 分析证据与范围

目标：/Applications/Codex.app/Contents/Resources/app.asar
package.json 标识 openai-codex-electron，版本 26.1120.41243，入口 .vite/build/early-bootstrap.js。
普通 Python 文件读取提取了 HTML/CSS 清单、package.json、webview/index.html 及其六个脚本资源，保存在 evidence/。这是普通文件工具的观察，不是 REA 分析结论。

REA 首次检测到一个 unpacked 原生模块的 declared digest 与本机文件不一致。record-and-continue 的全包分析随后超过约 549 MB 的证据表示容量，未保留可用结果。
缩小到已提取的六个脚本、仅选择 883398.12d9a6e686.js 后完成静态分析，结果见 evidence/rea-analysis.json。解析 7112 字节和 2217 AST 节点，无解析错误；其他五个脚本未分析，语义 unknown 达到所设 1000 上限，覆盖不完整。
父 Evidence：ev_c1933db8bec485e6fddc4f45f5b96dc5f982a3195dca38204f10b953649e9a0f。
该脚本分析不能证明具体侧栏布局、运行行为或视觉相似度。

本机 CUA 服务启动失败，无法取得原版截图或检查浏览器渲染。因此当前布局是人工重写的近似原型，未声称像素级复刻。下一步应在界面观察服务可用时逐屏比对尺寸、间距与状态。

## 验证

node --check app.js 通过。结构检查确认脚本查询的静态 ID 存在且无重复 ID。
未完成实际浏览器交互及截图验证。
