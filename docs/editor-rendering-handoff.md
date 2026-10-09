# Markdown 编辑器渲染与整合

本文件记录 2026-10-09 的最终整合状态；设计来源与复用边界见 [编辑器调研](editor-research.md)。

## 复用与模块边界

- `editor-highlight.mjs` 注册 18 个语言（含纯文本），编辑与文档预览共用 highlight.js 单例；语言别名返回规范 id。
- `editor-syntax.mjs` 复用 highlight.js 的 scope 命名，读取 emitter 中的原始文本位置。
- `editor-rich.js` 把语法高亮和代码工具条作为 ProseMirror decoration，不写进文档内容。组合输入期间映射已有标记，提交后更新高亮。
- `editor-syntax.css` 直接复用 Atom One Light / Dark 主题，保留作者信息，仅调整作用域和优先级。排除上游根规则，避免叠加背景和内边距。
- `editor-formula.mjs` 复用 KaTeX 渲染；混排识别直接复用 markdown-it 的 CommonMark 代码跨度规则，代码内的美元符号保持原样。
- `visual-editor.js` 提供行内 `mathInline` 与整块 `mathBlock`，记录 LaTeX 原文，并由原文账本保留未修改区块、CRLF、BOM、元数据和引用定义。
- `editor-design.css` 负责 Markdown 文档的纸面、排版、代码框、引用、表格、工具条和错误状态。选择器限定在文档区。
- `workbench.js` 提供公式插入、实时预览、取消/应用，编辑已有公式时以回调的 `display` 类型为准。

DSH 消息沿用原来的配色和高亮语言范围。应用其他区域的主题样式未改动。

## 接口

`createVisualEditor(element, source, onChange, options)` 支持：

| 参数 | 用途 |
| --- | --- |
| `renderer` / `renderMD` / `path` | 原文保留区块与本地资源渲染 |
| `highlight(code, language)` | 注入高亮结果，默认使用共享 highlight.js |
| `registry(language)` | 返回规范语言 id，保留未知语言 |
| `onCopyCode(text)` | 复制当前代码，返回是否成功；工作台接入 `copyText` |
| `onMath({source, display, apply})` | 打开公式窗口；`display` 区分行内与块级 |

DOM 钩子：`edh-code-tools`、`edh-code-language`、`edh-code-copy`、`visual-math`、`visual-math-block`、`edh-math-error`。代码工具条不可设成可编辑内容。错误显示保留原公式，用户可双击修正。

## 验证

最终整合后的逻辑测试 154 项通过。真实 Electron UI 验证覆盖 Java 高亮、选区、组合输入、复制 API 参数、语言切换/撤销、行内与块级公式编辑、数学与代码混排、错误显示、原文保存、深色与窄窗口。

复制测试使用拦截器验证传入 Clipboard API 的文本，保留用户系统剪贴板；旧式回退另由单元测试覆盖。

高亮的代码块上限为 20000 字符，超过仍可编辑并保留原文，但不着色。纯文本语言写为无语言围栏；MathML 使用与文档预览一致的 DOMPurify 规则，不手写不完整的标签白名单。
