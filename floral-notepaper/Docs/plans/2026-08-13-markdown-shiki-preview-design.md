# Markdown 预览：Shiki 语法高亮 + GitHub 风格区块设计

日期：2026-08-13
状态：已确认（用户批准）

## 背景与目标

当前 `src/features/markdown/MarkdownPreview.tsx` 的代码高亮是自研正则分词（`CODE_KEYWORDS` + `tokenClass` + `md-token-*` CSS 类），并非 TextMate 语法标准，色彩为 `color-mix` 近似混合值，与编译器中 Shiki 的真实效果不一致。

目标：
1. 代码块呈现与编译器（VS Code / Shiki）完全一致的 TextMate 语法高亮，固定 `one-dark-pro` 主题。
2. 非代码区块（标题/段落/列表/引用/链接/表格/内联代码）采用 GitHub 风格彩色化 UI。
3. 整体避免 AI 化观感，符合本地开发工具原生质感，且不影响现有四类使用方。

## 使用方

`MarkdownPreview` 单一组件被以下 4 处共用，改动自动全局生效：
- `src/components/Tile.tsx`
- `src/features/editor/components/NoteEditorWorkspace.tsx`
- `src/features/diary/DiaryPage.tsx`
- `src/features/garden/pages/ArticleDetailPage.tsx`

## 方案

### 1. 代码高亮：Shiki（TextMate / oniguruma）

- 新增依赖 `shiki`（含 `shiki/wasm`，加载 oniguruma WASM 引擎，保证与 TextMate 严格一致）。
- 模块级单例 `createHighlighter({ themes: ["one-dark-pro"], langs: [常用约 25-30 种] })`，懒创建、`codeToTokens()` 取 TextMate 分词。
- `CodeBlock` 组件内按 token 渲染 `<span style={{ color }}>` 内联精确色值；保留现有外壳（语言标签 + 复制按钮 + 圆角边框）。
- 高亮器未就绪时先渲染纯文本，就绪后自动升级；未知语言回退 `plaintext`。
- 语言清单（预载，控制体积）：js、ts、jsx、tsx、json、md、css、scss、html、xml、python、go、rust、java、kotlin、swift、c、cpp、csharp、bash、powershell、yaml、toml、sql、diff。

### 2. 非代码区块：GitHub 风格彩色化（CSS）

重写 `src/features/markdown/markdown-preview-skins.css`：
- 标题：字号阶梯 + 加粗深色 + h1 底部细线；
- 链接：强调色 + 下划线，悬停实底；
- 引用：左侧色条 + 极浅底色；
- 列表：间距与 marker 配色；
- 表格：表头底色 + 行斑马纹 + 圆角边框；
- 内联代码：浅底 + 强调色文字；
- 保留 `--md-text/--md-heading/--md-muted/--md-accent` 变量体系，四套皮肤（ink/blossom/aurora）继续驱动文字与链接色，保证磁贴可读性与皮肤协调。

### 3. 兼容性

- 保留 props：`content`、`fontSize`、`renderHtml`、`imageBaseDir`、`colorVars`。
- 保留 remark/rehype 管线（GFM、Math/KaTeX、alert、slug、sanitize）。
- 移除旧的正则高亮代码（`CODE_KEYWORDS`、`tokenClass`、`highlightCode`、`md-token-*` 类）。

## 验证

- `npm run build`（tsc + vite）。
- 现有相关单测。
- 人工核对 TS/JS/JSON 片段 token 色值与 One Dark Pro 一致。
