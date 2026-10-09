# Markdown 编辑器调研与设计取舍

本次研究覆盖 10 个代表性产品/项目，并核对 Typedown、MarkText 的本地源码，以及其余项目的官方仓库或文档。范围不等于穷尽所有 Markdown 编辑器。表格里的「采用方式」是结合 STG Desk 的设计判断。

用户最终要求：有自己的设计感，以 Typedown 的舒适度作参考；颜色变化仅发生在 Markdown 编辑器中；优先复用成熟开源实现。

| 项目与来源 | 值得借鉴的优点 | 在 STG Desk 的采用方式 |
| --- | --- | --- |
| [Typedown](https://github.com/byxiaozhi/Typedown) | 中性纸面、鲜明标题、轻量代码框、克制的引用线 | 参考颜色分布、字号梯度与间距；保留本项目结构 |
| [MarkText](https://github.com/marktext/marktext) | 文档元素分别配置主题、即时编辑、公式渲染 | 用文档专属主题变量统一浅色与深色，完善公式节点 |
| [Milkdown](https://github.com/Milkdown/milkdown) | ProseMirror 组件化、代码块的语言与编辑体验 | 参考组件边界，复用现有 Tiptap 与 highlight.js，保留原文与选区 |
| [Vditor](https://github.com/Vanessa219/vditor) | 即时渲染、语言提示、代码与公式工具 | 增强已有单栏编辑体验，避免另加多组工具栏 |
| [TOAST UI Editor](https://github.com/nhn/tui.editor) | 文档内容样式与编辑控件分离、清晰表格与代码层次 | 采用内容样式隔离思路；本次不引入其编辑引擎 |
| [Zettlr](https://docs.zettlr.com/en/scientific-technical/math) | 面向学术写作的 KaTeX 公式体验 | 区分行内/块级公式，直接编辑 TeX，保留 Markdown 分隔符 |
| [VNote](https://github.com/vnotex/vnote) | Markdown 预览管线与主题分离、笔记组织 | 保留已有工作区组织，统一预览与编辑的文档样式 |
| [ghostwriter](https://github.com/KDE/ghostwriter) | 专注写作、清爽界面、阅读统计 | 保留现有专注与底部统计，减少文档里的装饰 |
| [Typora](https://support.typora.io/Markdown-Reference/) | 所见即所得、公式、表格和代码自然融入正文 | 参考公开功能与交互，保留 Tiptap 编辑内核 |
| [Obsidian](https://obsidian.md/help) | 丰富 Markdown 内容、可定制主题、文档工作流 | 借鉴按内容元素设定主题，保留本地文件与学习流程 |

## 实际复用

- 继续使用 Tiptap / ProseMirror 的编辑、选区、撤销、表格与清单能力。
- 继续使用 KaTeX 的公式排版和错误检查，以及 markdown-it / texmath 的 Markdown 解析。
- 直接复用 highlight.js 的 Atom One Light / Atom One Dark 主题规则，保留原始配色与作者信息。仅调整选择器作用域和优先级，限制在 Markdown 文档区域。来源见 `node_modules/highlight.js/styles/atom-one-light.css` 与 `atom-one-dark.css`；许可 BSD-3-Clause，项目已有声明及完整 LICENSE。
- 图标沿用本项目现有 24×24 描边体系，新增图标源码集中在 `src/editor-icons.js`。
- 其余产品的内容排版与交互优点用于设计参考，不引入第二个编辑引擎。

## 独立复核纠正

原始 DSH 报告认为「代码无颜色仅因少一个主题 import」，这一点不准确：修改前 `src/mono-detail.css:116` 和 `src/app-theme.css:20` 已有高亮配色；真正缺口是 Tiptap 的代码节点未生成高亮 token，且预览未注册 Java 等语言。修复必须同时连接高亮与样式。

GPL / LGPL 不是禁止复制。复用须履行相应许可条款；本次采用现有依赖的 BSD-3-Clause 主题和自有集成代码，不从这些项目直接移植代码。闭源产品只研究公开文档与交互。

本文保留整合后的设计取舍与复核结论；功能与验证说明见 [渲染与整合](editor-rendering-handoff.md)。
