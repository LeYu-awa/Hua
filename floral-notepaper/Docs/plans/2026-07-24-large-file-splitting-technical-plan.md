# Floral Notepaper 大文件拆分技术方案

> 日期：2026-07-24  
> 关联 PRD：`Docs/plans/2026-07-24-module-splitting-prd.md`  
> 目标：识别并拆分单文件超过 2000 行的模块，降低页面组件耦合，形成可持续拆分的目录、通信和测试规范。

## 1. 扫描结论

当前 `src` 下已无超过 2000 行的代码文件。本轮治理前的超限文件如下：

| 文件 | 治理前行数 | 治理后行数 | 类型 | 状态 |
| --- | ---: | ---: | --- | --- |
| `src/components/MainWindow.tsx` | 2723 | 1759 | 核心笔记工作台页面 | 已拆分至阈值以下 |
| `src/components/SettingsPage.tsx` | 2501 | 1817 | 设置中心页面 | 已拆分至阈值以下 |

其他接近高复杂度的文件包括 `NotePad.tsx`、`LiteGraphWorkflow.tsx`、`SettingsPanel.tsx`、`StatsPanel.tsx`、`CanvasPage.tsx`、`InkPlaybackPage.tsx`，但暂未超过 2000 行，应在 P0/P1 拆分稳定后按功能域继续治理。

## 2. 拆分原则

1. **行为等价优先**：第一轮拆分只迁移结构，不改用户可见业务流程。
2. **先抽纯逻辑，再抽 UI**：优先提取纯函数、命令、状态机和 hooks，降低 JSX 拆分风险。
3. **按 feature 收口**：业务代码进入 `src/features/<domain>`，通用 UI 才进入 `src/shared/ui`。
4. **页面只做组合**：页面容器负责布局、数据装配和事件分发，不承载复杂业务算法。
5. **模块间单向通信**：子模块通过 props、回调、hook 返回值通信，禁止跨 feature 直接操作内部状态。
6. **每次拆分可验证**：每个拆分单元至少补一类测试：纯函数单测、hook 测试或组件渲染测试。

## 3. `MainWindow.tsx` 技术拆分方案

### 3.1 当前职责

`MainWindow.tsx` 当前混合了以下职责：

- 笔记列表、分类、搜索、右键菜单。
- 当前笔记加载、编辑、保存、外部文件保存、自动保存。
- Markdown 编辑工具栏、格式命令、颜色/高亮命令。
- Markdown 预览、分栏拖拽、视图模式切换。
- 图片粘贴、图片拖放、未使用图片清理。
- Tile/NotePad 多窗口交互。
- AI 聊天、写作伴侣、连接建议、写作情绪。
- 状态栏、统计、保存状态、窗口 document edited 状态。

### 3.2 拆分后的子模块

| 子模块 | 目标路径 | 职责 | 状态 |
| --- | --- | --- | --- |
| Markdown 命令 | `src/features/editor/commands/markdownCommands.ts` | 粗体、斜体、标题、列表、引用、代码、公式、颜色常量、撤销/重做命令 | 已完成 |
| 编辑器工作区 | `src/features/editor/components/NoteEditorWorkspace.tsx` | 顶部编辑操作栏、标题区、编辑/预览/分栏、图片粘贴、状态栏、AI 入口 | 已完成 |
| 笔记工作台页面 | `src/features/notes/pages/NotesWorkspacePage.tsx` | 主页面组合与笔记上下文装配 | 后续 |
| 笔记侧栏 | `src/features/notes/components/NotesSidebar.tsx` | 搜索、分类、笔记列表、右键菜单入口 | 后续 |
| 保存流程 | `src/features/notes/hooks/useNoteAutosave.ts` | dirty/saving/saved/error 状态机和保存防抖 | 后续 |
| 多窗口桥接 | `src/features/windows/hooks/usePinnedTiles.ts` | Tile 打开、关闭、取消固定状态同步 | 后续 |
| AI 扩展区 | `src/features/agent/components/*` | DeepSeekChat、连接建议、情绪指示器的页面级装配 | 后续 |

### 3.3 已执行拆分

本轮已先完成最低风险拆分：

- 新增 `src/features/editor/commands/markdownCommands.ts`。
- 将 Markdown 格式命令、颜色常量、`runEditorCommand`、`pinTileButtonTitle` 从 `MainWindow.tsx` 中移出。
- 新增 `src/features/editor/commands/markdownCommands.test.ts` 覆盖核心命令。
- 新增 `src/features/editor/components/NoteEditorWorkspace.tsx`。
- 将右侧编辑工作区、标题区、编辑/预览/分栏、图片粘贴、状态栏、AI 入口从 `MainWindow.tsx` 中移出。
- `MainWindow.tsx` 现在主要负责笔记数据、保存流程、侧栏/菜单、窗口桥接和工作区装配。

### 3.4 数据流

```text
NotesWorkspacePage
  -> useNotesData / useCurrentNote
  -> NoteEditorPane
  -> MarkdownEditor
  -> markdownCommands
  -> onChange / markDirty
  -> useNoteAutosave
  -> notes/api.ts
```

AI 和窗口能力只消费当前笔记上下文：

```text
NoteEditorPane -> currentNoteContext -> AgentPanel / ConnectionSuggestions
NotesWorkspacePage -> selectedNoteId -> usePinnedTiles
```

### 3.5 通信规范

- 编辑器只通过 `value`、`disabled`、`onChange`、`onSave`、`onSelectionChange` 和命令 props 与父级通信。
- 保存流程只暴露 `saveState`、`markDirty`、`saveNow`、`lastSavedAt`。
- 窗口模块只接收 `noteId` 与 `isPinned`，不读取编辑器内部状态。
- AI 模块只接收 `noteId`、`title`、`content`、`providers`、`enabled`。

## 4. `SettingsPage.tsx` 技术拆分方案

### 4.1 当前职责

`SettingsPage.tsx` 当前包含：

- 设置页布局与左侧导航。
- 偏好设置、主题、语言、背景、字号、默认视图。
- 模型供应商列表、详情、添加供应商弹窗、添加模型弹窗。
- 默认模型、快捷键、统计、关于、账户入口。
- 多个通用表单控件：Card、ToggleRow、RangeRow、TextField、ModelRow、ScrollFrame。

### 4.2 拆分后的子模块

| 子模块 | 目标路径 | 职责 |
| --- | --- | --- |
| 设置页容器 | `src/features/settings/pages/SettingsPage.tsx` | 左侧导航、当前 section、右侧内容装配 |
| 偏好面板 | `src/features/settings/components/PreferencesPanel.tsx` | 主题、语言、背景、字号、默认视图 |
| 供应商面板 | `src/features/settings/components/ProvidersPanel.tsx` | 供应商列表与详情切换 |
| 供应商弹窗 | `src/features/settings/dialogs/AddProviderDialog.tsx` | 新增供应商 |
| 模型弹窗 | `src/features/settings/dialogs/AddModelDialog.tsx` | 新增模型 |
| 快捷键面板 | `src/features/settings/components/HotkeysPanel.tsx` | 快捷键录制与校验 |
| 统计面板 | `src/features/settings/components/StatsPanel.tsx` | 统计和热力图 |
| 账户面板 | `src/components/AccountPanel.tsx` → 后续迁移 `src/features/auth/components/AccountPanel.tsx` | 登录、注册、个人信息、同步 |
| 表单 UI | `src/shared/ui/*` | Card、ToggleRow、RangeRow、TextField、Dialog |

### 4.3 数据流

```text
SettingsPage
  -> SectionContent
  -> Panel(config/providers)
  -> onConfigChange / onProvidersChange
  -> settings/api.ts saveConfig
  -> AppShell scheduleSync
```

账户模块独立处理认证和同步：

```text
AccountPanel
  -> auth/api.ts / supabase
  -> sync/api.ts
  -> onConfigChange(remoteConfig)
```

### 4.4 通信规范

- 设置 panel 不直接保存配置，只调用 `onChange(nextConfig)`。
- 供应商模块只通过 `providers` 和 `onProvidersChange(nextProviders)` 通信。
- 快捷键录制逻辑留在 settings feature 内，不进入 shared UI。
- shared UI 不依赖 `AppConfig`、`ProviderConfig` 或 Supabase。

## 5. 目录调整目标

```text
src/
  app/
    AppShell.tsx
    routeViews.tsx
  features/
    editor/
      commands/
        markdownCommands.ts
      components/
      hooks/
    notes/
      pages/
      components/
      hooks/
      services/
    settings/
      pages/
      components/
      dialogs/
    auth/
      components/
      hooks/
    social/
      components/
      pages/
      stores/
  shared/
    ui/
    hooks/
    lib/
```

## 6. 测试策略

| 模块 | 测试类型 | 核心覆盖 |
| --- | --- | --- |
| `markdownCommands` | 纯函数单测 | 包裹选区、多行列表/引用、标题循环、代码块、公式、Tile 文案 |
| `AppShell/routeViews` | 组件渲染测试 | 特殊窗口、主视图切换、登录受限视图 |
| 未来 `useNoteAutosave` | Hook/状态机测试 | dirty、saving、saved、error、防抖保存 |
| 未来 Settings panels | 组件测试 | 配置变更回调、供应商编辑、快捷键校验 |

## 7. 后续拆分顺序

1. 已完成：PR-01 `AppShell` 与 `routeViews`。
2. 已完成：`MainWindow` Markdown 命令抽离。
3. 已完成：`MainWindow` 右侧 `NoteEditorWorkspace` 抽离。
4. 已完成：`SettingsPage` 统计面板 `StatsPanel` 抽离。
5. 后续：抽 `NotesSidebar` 和右键菜单。
6. 后续：抽 `useNoteAutosave` 保存状态机。
7. 后续：迁移 `SettingsPage` 剩余 panel/dialog 到 `features/settings`。

## 8. 验收标准

- 超过 2000 行文件被纳入拆分计划，职责和数据流明确。
- 新增模块可以独立测试和编译。
- 现有业务入口不变。
- `npm test` 覆盖新增拆分单元。
- `npm run build` 无引用错误。
- 后续每次拆分只围绕一个模块，避免跨域大重构。
