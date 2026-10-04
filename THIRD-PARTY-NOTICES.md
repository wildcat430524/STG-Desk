# STG Desk · 第三方声明

下列开源软件实际用于本框架。各依赖的完整 LICENSE 保留在分发包中的依赖目录或 `licenses/` 中；Electron 的 Chromium 声明保留为分发目录的 `LICENSES.chromium.html`。

| 组件 | 来源 | 许可 | 用途 |
| --- | --- | --- | --- |
| Electron | https://github.com/electron/electron | MIT 及随附 Chromium 声明 | Windows 桌面宿主 |
| CodeMirror 6 | https://codemirror.net/ | MIT | Markdown 编辑 |
| Tiptap（core、StarterKit、Markdown 与表格/图片/任务清单扩展） | https://github.com/ueberdosis/tiptap | MIT | 可视化编辑与 Markdown 序列化 |
| markdown-it | https://github.com/markdown-it/markdown-it | MIT | Markdown 渲染与题目结构识别 |
| chokidar | https://github.com/paulmillr/chokidar | MIT | 文件变化监测 |
| DOMPurify | https://github.com/cure53/DOMPurify | Apache-2.0 OR MPL-2.0 | HTML 净化 |
| KaTeX | https://github.com/KaTeX/KaTeX | MIT | 数学公式 |
| markdown-it-texmath | https://github.com/goessner/markdown-it-texmath | MIT | Markdown 公式语法 |
| markdown-it-task-lists | https://github.com/revin/markdown-it-task-lists | ISC | 只读任务清单 |
| highlight.js | https://github.com/highlightjs/highlight.js | BSD-3-Clause | 阅读区代码语法颜色 |
| js-yaml | https://github.com/nodeca/js-yaml | MIT | 本机 DSH 桌面连接授权配置读取 |
| ws | https://github.com/websockets/ws | MIT | DSH 原生会话实时同步 |

构建工具 Vite 与 electron-builder 不进入界面运行代码；其许可证保留在开发依赖中。完整版本由 `package-lock.json` 锁定。

Typedown、MarkText、SurveyJS 等下载的候选源码仅作调研，未搬入本软件代码或分发。调研克隆未随公开仓库分发。不能把本项目 MIT 许可延伸到不同许可的候选源码。

StepsToGreat 数据格式适配依据 https://github.com/wildcat430524/StepsToGreat 以及用户电脑上的同名工作区；软件不打包或更改其协议、模板、教学文档。用户导入的内容保留原作者和用户自己的许可。
