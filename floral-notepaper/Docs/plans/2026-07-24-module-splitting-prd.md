# Floral Notepaper 模块拆分 PRD

> 文档类型：产品需求文档 / 模块拆分 PRD  
> 项目：floral-notepaper  
> 日期：2026-07-24  
> 状态：待评审  
> 目标：将现有单体页面与混杂组件拆分为可独立开发、测试、上线的功能模块，为后续组件库、UI 库和可能的 monorepo 演进打基础。

---

## 1. 背景与问题定义

### 1.1 当前项目背景

Floral Notepaper 当前是一个基于 Vite + React + Tauri 的桌面创作应用，已有笔记、画布、共写、AI 助手、Live2D 伴侣、创作台、花园社区、设置中心、同步等功能。代码目录已经出现 `src/features/*` 的功能分层雏形，但核心页面仍大量集中在 `src/components/*` 下，导致页面职责过重。

当前扫描到的主要超大文件包括：

| 文件 | 行数 | 主要问题 |
| --- | ---: | --- |
| `src/components/MainWindow.tsx` | 2723 | 笔记列表、编辑器、预览、保存、设置、窗口事件、AI 情绪、图片粘贴、快捷键等职责混杂 |
| `src/components/SettingsPage.tsx` | 2501 | 设置页内部包含偏好、模型供应商、默认模型、快捷键、统计、关于、表单控件、弹窗等多个可独立模块 |
| `src/components/NotePad.tsx` | 862 | 独立小窗笔记编辑逻辑与主笔记编辑能力存在复用空间 |
| `src/components/workflow/LiteGraphWorkflow.tsx` | 844 | 工作流画布 UI、节点逻辑、事件桥接、样式与业务逻辑耦合 |
| `src/components/SettingsPanel.tsx` | 698 | 与 SettingsPage 存在设置职责重叠，需明确轻量面板与完整设置页边界 |
| `src/components/CanvasPage.tsx` | 600 | 画布文档、节点操作、AI 建议、存储逻辑集中在单组件 |
| `src/components/InkPlaybackPage.tsx` | 600 | 回放页面、分析视图、交互控制仍可拆分 |

### 1.2 核心痛点

1. **页面过大，变更风险高**：一个功能变更可能影响多个无关职责，难以安全重构。
2. **组件复用困难**：按钮、卡片、弹窗、输入框、设置行、侧栏、空状态等 UI 形态重复但没有统一抽象。
3. **测试粒度过粗**：巨型页面难以写单元测试，只能依赖整体集成测试。
4. **开发并行受阻**：多人同时修改同一巨型文件时冲突概率高。
5. **功能边界不清**：`components` 既放通用组件，也放页面级业务组件；`features` 已存在但未完全承接业务边界。
6. **monorepo 时机未成熟**：当前只有一个前端/桌面应用包，直接引入 monorepo 会增加工程复杂度；应先完成内部模块化。

### 1.3 本次拆分目标

本 PRD 目标不是立即迁移到 monorepo，而是先完成“单仓模块化拆分”：

- 将巨型页面拆分为独立业务模块。
- 建立清晰的 `features`、`shared/ui`、`shared/hooks`、`shared/lib` 边界。
- 使每个模块可以独立开发、测试、上线。
- 为后续升级到 `apps/* + packages/*` monorepo 保留路径。
- 在不改变现有用户功能的前提下，降低维护成本和迭代风险。

---

## 2. 拆分原则

### 2.1 产品原则

1. **用户体验不变优先**：第一阶段拆分不新增复杂功能，不改变主流程，只保证功能等价迁移。
2. **按用户任务拆分**：模块边界围绕用户任务定义，例如“写笔记”“配置模型”“查看统计”“管理创作素材”，而不是只按技术文件拆分。
3. **独立交付**：每个模块应具备独立验收标准，可独立测试、灰度和回滚。
4. **渐进式重构**：优先拆高风险大文件，避免一次性重构全项目。
5. **保留现有数据协议**：拆分过程中不主动变更 Supabase 表、Tauri API、配置结构和本地文件格式，除非模块明确需要。

### 2.2 工程原则

1. **Feature-first**：业务页面、业务 hooks、业务 store、业务 API 放入对应 `src/features/<domain>`。
2. **Shared 只放稳定通用能力**：跨两个及以上 feature 复用、且不含业务语义的内容才进入 `src/shared/*`。
3. **UI 与业务解耦**：`shared/ui` 不直接依赖 Tauri、Supabase、Zustand、具体业务类型。
4. **状态下沉到业务 hook/store**：页面组件只负责布局和组合，不直接承载复杂副作用。
5. **测试跟随模块移动**：每个拆分模块需配套对应测试或验收用例。
6. **禁止“伪组件库”膨胀**：只抽当前真实复用的组件，不为假想未来提前设计复杂主题系统。

### 2.3 推荐目录目标

```text
src/
  app/
    AppShell.tsx
    routeViews.tsx
  shared/
    ui/
      Button.tsx
      Card.tsx
      Dialog.tsx
      TextField.tsx
      ToggleRow.tsx
      EmptyState.tsx
    hooks/
    lib/
    types/
  features/
    notes/
      pages/
      components/
      hooks/
      services/
      api.ts
      types.ts
    settings/
      pages/
      components/
      dialogs/
      hooks/
      api.ts
      types.ts
    editor/
      components/
      hooks/
      commands/
    windows/
    canvas/
    workflow/
    agent/
    companion/
    auth/
    sync/
```

---

## 3. 拆分范围

### 3.1 本次纳入范围

- 应用壳层与路由视图拆分。
- 主笔记工作台 `MainWindow` 拆分。
- 编辑器与 Markdown 预览相关能力拆分。
- 设置中心 `SettingsPage` 拆分。
- 轻量共享 UI 层建设。
- 独立小窗笔记 `NotePad` 与主编辑能力复用梳理。
- 画布与工作流页面拆分边界梳理。
- AI、Live2D 伴侣、同步与账户模块的依赖边界梳理。
- 测试、验收、上线策略。

### 3.2 暂不纳入范围

- 不立即迁移为 monorepo。
- 不重写 Tauri 后端或 Supabase 表结构。
- 不替换 Tailwind、React、Zustand、i18next 等技术栈。
- 不重新设计完整视觉规范，仅沉淀已有 UI 模式。
- 不一次性重构所有 400 行以下组件。

---

## 4. 用户角色与使用场景

### 4.1 目标用户

| 用户 | 诉求 | 受影响模块 |
| --- | --- | --- |
| 创作者 | 快速写笔记、插入图片、预览 Markdown、保持沉浸体验 | 笔记工作台、编辑器、预览、图片模块 |
| 高级用户 | 配置模型供应商、快捷键、主题、统计、同步 | 设置中心、账户同步、AI 配置 |
| 多窗口用户 | 打开独立小窗、便签、Tile、不同视图 | 应用壳层、窗口模块、NotePad |
| AI 使用者 | 聊天、共写、写作报告、情绪/建议、Live2D 反馈 | AI、伴侣、写作辅助模块 |
| 开发者 | 独立开发一个 feature，降低冲突和回归 | 所有拆分模块 |

### 4.2 关键业务流程

1. 用户启动应用，应用壳层根据窗口路由进入主窗口、便签窗口或 Tile 窗口。
2. 主窗口加载全局配置、主题、语言、用户状态和同步状态。
3. 用户进入笔记工作台，查看分类、搜索笔记、选择笔记、编辑内容、自动保存、预览。
4. 用户在设置中心配置偏好、模型供应商、默认模型、快捷键、账户与统计。
5. 用户使用 AI/伴侣/共写能力时，模块读取笔记上下文、模型配置和用户设置，但不反向耦合主窗口 UI。
6. 用户打开画布、创作台、花园、个人主页等功能时，由路由视图统一加载对应 feature 页面。

---

## 5. 模块拆分总览

| 编号 | 模块 | 优先级 | 当前主要来源 | 目标位置 | 是否可独立上线 |
| --- | --- | --- | --- | --- | --- |
| M01 | 应用壳层与路由视图 | P0 | `App.tsx`、`WindowFrame`、`AppSidebar` | `src/app/*` | 是 |
| M02 | 主笔记工作台 | P0 | `MainWindow.tsx` | `features/notes/pages` + `features/notes/components` | 是 |
| M03 | 编辑器核心与格式工具栏 | P0 | `MainWindow.tsx` 内编辑器逻辑 | `features/editor/*` 或 `features/notes/editor/*` | 是 |
| M04 | 笔记数据与保存流程 | P0 | `features/notes/api.ts` + `MainWindow.tsx` 副作用 | `features/notes/hooks/services` | 是 |
| M05 | 设置中心 | P1 | `SettingsPage.tsx`、`SettingsPanel.tsx` | `features/settings/pages/components/dialogs` | 是 |
| M06 | 共享 UI 库 | P1 | `SettingsPage` 内 Card/Toggle/TextField 等、各页面重复样式 | `shared/ui` | 是 |
| M07 | 独立小窗笔记与窗口能力 | P1 | `NotePad.tsx`、`features/windows/*` | `features/windows` + `features/notes/windows` | 是 |
| M08 | 画布与无限画布 | P2 | `CanvasPage.tsx`、`features/infinite-canvas/*` | `features/canvas` / `features/infinite-canvas` | 是 |
| M09 | 工作流画布 | P2 | `LiteGraphWorkflow.tsx`、`features/workflow/*` | `features/workflow/components` | 是 |
| M10 | AI 写作与建议层 | P2 | `DeepSeekChat`、`WritingCompanion`、`features/agent/*` | `features/agent/components/hooks` | 是 |
| M11 | 伴侣与 Live2D | P3 | `features/companion/*`、`features/live2d/*` | 保持 feature，清理边界 | 是 |
| M12 | 账户、认证与同步 | P3 | `features/auth/*`、`features/sync/*`、`AccountPanel` | `features/auth` + `features/sync` | 是 |
| M13 | 文档与模块治理 | P0 | 无统一标准 | `Docs/plans` + 后续 ADR | 是 |

---

## 6. 待拆模块详细需求

### M01. 应用壳层与路由视图

#### 模块定位

应用壳层负责应用启动后的全局框架，不承载具体业务页面逻辑。它应该管理窗口类型、全局配置、主题、语言、用户登录态、侧边栏当前视图，并将具体页面渲染委托给路由视图模块。

#### 核心功能点

- 识别窗口启动路由：主窗口、便签窗口、Tile 窗口。
- 加载全局配置：主题、语言、模型供应商、同步配置。
- 渲染通用窗口框架：`ContextMenuProvider`、`WindowFrame`、`AppSidebar`。
- 根据 `AppView` 渲染具体业务页面。
- 监听全局配置变更事件并同步状态。
- 管理当前选中笔记 ID 与跨视图传递。

#### 具体开发内容

1. 新建 `src/app/AppShell.tsx`，承接现有 `App.tsx` 的壳层职责。
2. 新建 `src/app/routeViews.tsx`，将视图渲染 switch/条件渲染集中管理。
3. 将 notepad/tile 特殊窗口渲染拆为 `WindowRouteRenderer`。
4. 保留 `App.tsx` 为最薄入口，只组合 provider 与 shell。

#### 功能边界

- 包含：全局壳层、路由视图、全局配置读取、窗口类型判断。
- 不包含：笔记编辑细节、设置表单细节、AI 聊天细节、画布节点逻辑。

#### 业务流程

1. 应用启动。
2. 调用窗口路由识别能力。
3. 加载配置、主题、语言、登录态。
4. 根据窗口类型渲染对应壳层。
5. 主窗口中根据侧边栏视图渲染 feature 页面。

#### 交互要求

- 侧边栏切换时，主内容区域应保持当前视觉布局不变。
- 登录态缺失的页面仍显示现有“请先登录”提示。
- 特殊窗口不展示主侧边栏。

#### 非功能性需求

- 首屏行为与现有版本一致。
- 路由渲染函数应可单测。
- 不引入额外路由库，除非后续明确需要。

#### 验收标准

- `App.tsx` 行数明显下降，仅保留入口职责。
- 主窗口、notepad、tile 三种启动路径功能不变。
- 各侧边栏入口能正确渲染原页面。
- 构建、lint、现有路由相关测试通过。

#### 依赖关系

- 依赖 `features/windows/windowRoutes.ts`。
- 被 M02、M05、M08、M09、M10 等页面模块依赖。

---

### M02. 主笔记工作台

#### 模块定位

主笔记工作台是用户进行本地笔记管理、分类、搜索、编辑和预览的核心页面。当前职责集中在 `MainWindow.tsx`，需拆成页面容器、侧栏、编辑区域、预览区、状态栏和业务 hooks。

#### 核心功能点

- 笔记列表加载与刷新。
- 分类列表、分类创建、重命名、删除。
- 笔记创建、选择、删除、移动分类。
- 搜索与分类分组。
- 当前笔记元数据展示。
- 保存状态展示。
- 文件导入/导出入口。
- 与小窗、Tile、外部文件打开能力衔接。

#### 具体开发内容

建议拆分为：

```text
features/notes/
  pages/
    NotesWorkspacePage.tsx
  components/
    NotesSidebar.tsx
    NotesCategoryGroup.tsx
    NotesListItem.tsx
    NoteWorkspaceHeader.tsx
    NoteEditorPane.tsx
    NotePreviewPane.tsx
    NoteStatusBar.tsx
    NoteContextMenus.tsx
    EmptyNoteState.tsx
  hooks/
    useNotesWorkspace.ts
    useNoteSelection.ts
    useNoteMenus.ts
    useNoteSearch.ts
```

#### 功能边界

- 包含：笔记管理、分类管理、搜索、主工作台布局、笔记状态展示。
- 不包含：具体 Markdown 渲染实现、AI 聊天实现、设置详情、窗口底层 API。

#### 业务流程

1. 页面初始化后加载分类与笔记列表。
2. 用户搜索或切换分类，列表实时过滤。
3. 用户选择笔记后加载内容到编辑器。
4. 用户编辑内容后进入 dirty 状态。
5. 自动保存或手动保存成功后更新列表元数据。
6. 用户可切换预览、打开小窗或 Tile。

#### 交互要求

- 搜索、分类、笔记选择的视觉表现保持不变。
- 当前选中笔记应有明确高亮。
- 保存中、已保存、保存失败状态应可见。
- 无笔记、无搜索结果、未选中笔记均需有明确空状态。
- 右键菜单行为与现有体验一致。

#### 非功能性需求

- 页面容器不直接包含 500 行以上 JSX。
- 列表项组件可独立测试。
- 搜索与分组逻辑应在纯函数或 hook 中测试。
- 编辑状态变化不应导致整个侧栏频繁重渲染。

#### 验收标准

- 原 `MainWindow.tsx` 中笔记侧栏相关 JSX 被迁移到独立组件。
- 创建、选择、搜索、删除、分类移动等主流程通过手动验收。
- 现有笔记 API 测试通过。
- 工作台拆分后视觉与交互无明显回归。

#### 依赖关系

- 依赖 M03 编辑器核心。
- 依赖 M04 数据与保存流程。
- 依赖 M06 共享 UI。
- 调用 M07 窗口能力。
- 可向 M10 AI 模块提供当前笔记上下文。

---

### M03. 编辑器核心与格式工具栏

#### 模块定位

编辑器核心负责文本输入、Markdown 编辑、格式命令、颜色/高亮、快捷键、选区同步和预览联动。它不应该知道笔记列表、分类列表、设置页等业务。

#### 核心功能点

- 文本输入区域。
- Markdown 格式命令：标题、粗体、斜体、引用、列表等。
- 文本颜色与高亮颜色。
- undo/redo 命令。
- 选区读取与替换。
- 行数、字数、字节数统计输入。
- 图片粘贴入口。

#### 具体开发内容

建议拆分为：

```text
features/editor/
  components/
    MarkdownEditor.tsx
    EditorToolbar.tsx
    FormatButton.tsx
    ColorPalette.tsx
    EditorStatsBar.tsx
  hooks/
    useMarkdownCommands.ts
    useEditorSelection.ts
    useEditorHotkeys.ts
  commands/
    markdownFormatCommands.ts
```

如果暂不想新增 `features/editor`，也可先放在 `features/notes/editor`，等创作台与 NotePad 复用稳定后再上移。

#### 功能边界

- 包含：编辑器 UI、格式命令、选区处理、编辑快捷键。
- 不包含：笔记保存 API、笔记列表、AI 生成、Markdown 预览渲染内部实现。

#### 业务流程

1. 父级传入 `value`、`onChange`、`onSave`、`onSelectionChange`。
2. 用户输入或使用格式按钮。
3. 编辑器通过回调通知父级内容变化。
4. 父级决定保存、预览和上下文传递。

#### 交互要求

- 工具栏按钮 hover、active、disabled 状态清晰。
- 颜色/高亮面板打开后可关闭，不能遮挡主要输入。
- 快捷键行为与原有一致。
- 文本区域聚焦体验不变。

#### 非功能性需求

- 格式命令应是纯函数，便于单测。
- 编辑器组件不得直接依赖 Supabase/Tauri 配置存取。
- 支持在 MainWindow、NotePad、未来创作台中复用。

#### 验收标准

- 原有格式化按钮功能均可用。
- undo/redo 行为可用。
- 文本颜色、高亮、清除样式可用。
- 编辑器可在不加载笔记列表的 Story/测试环境下渲染。

#### 依赖关系

- 被 M02 主笔记工作台和 M07 NotePad 依赖。
- 可被 studio 的 TipTap 编辑器部分参考，但不强行合并。

---

### M04. 笔记数据与保存流程

#### 模块定位

该模块负责笔记数据的加载、保存、导入导出、外部文件、图片目录、脏状态、自动保存和错误归一化。它是笔记工作台的数据服务层。

#### 核心功能点

- 加载分类与笔记列表。
- 加载当前笔记内容。
- 保存当前笔记。
- 自动保存与防抖。
- 外部文件读取与保存。
- Markdown 导入/导出。
- 图片粘贴与未使用图片清理。
- 保存状态机：idle/dirty/saving/saved/error。

#### 具体开发内容

建议拆分为：

```text
features/notes/
  hooks/
    useNotesData.ts
    useCurrentNote.ts
    useNoteAutosave.ts
    useExternalNoteFile.ts
  services/
    noteSaveState.ts
    noteImportExportBridge.ts
```

#### 功能边界

- 包含：笔记数据流程、保存状态、导入导出桥接。
- 不包含：侧栏 UI、编辑器 UI、设置 UI。

#### 业务流程

1. 工作台请求初始化数据。
2. 数据 hook 返回笔记、分类、加载状态和操作方法。
3. 编辑器内容变化后设置 dirty。
4. 自动保存触发保存服务。
5. 保存成功后刷新元数据并更新保存状态。
6. 保存失败时暴露错误信息给 UI。

#### 交互要求

- 保存失败应保留用户输入，不得覆盖为旧内容。
- 外部文件保存失败需提示。
- 自动保存不应阻塞输入。

#### 非功能性需求

- 保存状态机必须可单测。
- 自动保存需防抖，避免频繁 I/O。
- API 错误统一转为可展示文案。

#### 验收标准

- 创建、更新、删除、导入、导出笔记流程可用。
- 自动保存和手动保存状态展示正确。
- 保存失败时 UI 进入 error 状态并保留草稿。
- `features/notes/api.test.ts` 通过，新增保存状态测试通过。

#### 依赖关系

- 依赖 `features/notes/api.ts`、`features/importExport/api.ts`、`features/images/*`。
- 被 M02、M03、M07 调用。

---

### M05. 设置中心

#### 模块定位

设置中心负责用户配置管理，包括偏好设置、模型供应商、默认模型、快捷键、账户、统计、关于。当前 `SettingsPage.tsx` 已经出现多个内部函数组件，应拆为独立模块。

#### 核心功能点

- 偏好设置：主题、语言、背景、视图模式、Tile 配色等。
- 模型供应商：新增、编辑、删除、协议模板、API 地址、模型列表。
- 默认模型：按用途选择默认模型。
- 快捷键：录制、校验、冲突提示。
- 账户：登录态、同步入口。
- 统计：使用数据、热力图、时间范围选择。
- 关于：版本信息、项目说明。

#### 具体开发内容

建议拆分为：

```text
features/settings/
  pages/
    SettingsPage.tsx
  components/
    SettingsLayout.tsx
    SettingsNav.tsx
    PreferencesPanel.tsx
    ProvidersPanel.tsx
    ProviderDetail.tsx
    DefaultModelsPanel.tsx
    HotkeysPanel.tsx
    StatsPanel.tsx
    AboutPanel.tsx
  dialogs/
    AddProviderDialog.tsx
    AddModelDialog.tsx
    CustomRangeDialog.tsx
  hooks/
    useSettingsDraft.ts
    useProviderEditor.ts
    useShortcutCheck.ts
```

#### 功能边界

- 包含：设置页布局、设置表单、模型供应商配置、快捷键校验、统计展示。
- 不包含：设置持久化底层 API 的重写、账户认证 API 实现、同步协议实现。

#### 业务流程

1. 父级传入当前配置和供应商列表。
2. 用户切换设置分区。
3. 用户修改配置，页面通过回调提交变更。
4. 涉及快捷键时先校验再保存。
5. 涉及供应商时在本地草稿中编辑，确认后提交。
6. 统计面板独立读取统计数据。

#### 交互要求

- 左侧导航和右侧内容区布局保持不变。
- 表单控件视觉风格统一。
- 弹窗确认/取消路径清晰。
- 快捷键录制期间需要有明确状态反馈。
- 删除供应商/模型前需要确认或保留现有安全交互。

#### 非功能性需求

- 每个 panel 控制在合理行数内，避免再次形成巨型组件。
- Provider 编辑逻辑可单测。
- 快捷键校验状态可单测。
- 设置页面拆分后不得引入不必要的全局 store。

#### 验收标准

- `SettingsPage.tsx` 拆分为布局容器，具体分区由独立组件承载。
- 原有设置项均可查看和修改。
- 新增/编辑/删除供应商和模型流程可用。
- 快捷键录制与校验可用。
- 统计页时间范围选择可用。

#### 依赖关系

- 依赖 M06 共享 UI。
- 依赖 `features/settings/api.ts`、`shortcutRecorder.ts`、`stats.ts`、`theme.ts`。
- 调用 M12 账户模块显示账户信息。

---

### M06. 共享 UI 库

#### 模块定位

共享 UI 库承接跨 feature 复用的基础交互组件，提供统一视觉和交互规范，但不承担业务逻辑。它是未来独立 `packages/ui` 的候选来源。

#### 核心功能点

- Button / IconButton。
- Card / SectionCard。
- Dialog / DialogButton。
- TextField / TextAreaField。
- ToggleRow / RangeRow。
- EmptyState。
- SidebarNav / NavItem。
- StatusBadge / SaveStateBadge。

#### 具体开发内容

建议先沉淀：

```text
shared/ui/
  Button.tsx
  IconButton.tsx
  Card.tsx
  Dialog.tsx
  TextField.tsx
  ToggleRow.tsx
  RangeRow.tsx
  EmptyState.tsx
  StatusBadge.tsx
```

#### 功能边界

- 包含：无业务语义的通用 UI。
- 不包含：笔记列表项、模型供应商表单、AI 聊天消息、Live2D 控制等业务组件。

#### 业务流程

共享 UI 不定义业务流程，只接受 props 并触发回调。

#### 交互要求

- 保持项目现有纸张、墨色、竹色等视觉语言。
- 支持 disabled、loading、active、danger 等常见状态。
- 保持键盘可访问性。

#### 非功能性需求

- 不依赖具体 feature。
- 不依赖 Tauri/Supabase。
- props 简洁，不设计复杂主题系统。
- 至少被两个模块复用后再稳定进入 shared。

#### 验收标准

- 设置中心与笔记工作台至少各复用一批 shared UI。
- shared UI 不导入 `features/*`。
- 视觉与原页面一致。
- 组件可独立渲染测试。

#### 依赖关系

- 被 M02、M05、M08、M09 等消费。
- 未来可迁移为 `packages/ui`。

---

### M07. 独立小窗笔记与窗口能力

#### 模块定位

该模块处理 Tauri 多窗口场景，包括 notepad、tile、窗口置顶、窗口关闭、文档编辑状态、窗口事件同步等。它应与主笔记编辑器复用底层编辑能力。

#### 核心功能点

- NotePad 独立窗口打开与初始化。
- Tile 窗口打开、关闭、取消固定状态同步。
- 当前文档编辑状态同步到窗口。
- 窗口间事件监听与解绑。
- 小窗编辑器与主编辑器复用。

#### 具体开发内容

```text
features/windows/
  components/
    WindowRouteRenderer.tsx
    TileWindowBridge.tsx
  hooks/
    useWindowRoute.ts
    useTileWindowSync.ts
    useDocumentEditedState.ts
features/notes/windows/
  NotePadPage.tsx
```

#### 功能边界

- 包含：窗口事件、窗口路由、notepad/tile 桥接。
- 不包含：主笔记列表、设置表单、AI 聊天实现。

#### 业务流程

1. 用户从主窗口打开笔记小窗或 Tile。
2. 窗口模块调用 Tauri API 创建/切换窗口。
3. 新窗口读取 route，加载对应 noteId。
4. 编辑状态变化同步给窗口控件。
5. 窗口关闭或取消固定时同步回主窗口状态。

#### 交互要求

- 小窗打开行为与原有一致。
- 窗口关闭后主窗口对应 pinned 状态更新。
- 小窗编辑保存状态可见。

#### 非功能性需求

- 事件监听必须正确解绑，避免内存泄漏。
- Tauri API 调用集中在窗口模块。
- 单元测试可 mock window route 和事件。

#### 验收标准

- notepad/tile 启动路径可用。
- 主窗口打开/关闭 Tile 后状态正确。
- 小窗编辑和保存不回归。
- 主编辑器与小窗编辑器至少复用 M03 的基础组件或 hook。

#### 依赖关系

- 依赖 M01 应用壳层。
- 依赖 M03 编辑器核心。
- 依赖 M04 笔记保存流程。

---

### M08. 画布与无限画布

#### 模块定位

画布模块承载节点编辑、连接、归档建议、AI 覆盖层等能力。当前普通 CanvasPage 与 infinite-canvas 目录并存，需要明确边界：普通 canvas 负责轻量节点文档，infinite-canvas 负责大型无限画布体验。

#### 核心功能点

- Canvas 文档加载和保存。
- 节点增删改、拖拽、选择、编辑。
- 边连接管理。
- 归档建议。
- AI 智能连接建议。
- 无限画布视口、节点、搜索、Workflow 嵌入。

#### 具体开发内容

```text
features/canvas/
  pages/
    CanvasPage.tsx
  components/
    CanvasToolbar.tsx
    CanvasViewport.tsx
    CanvasNodeView.tsx
    CanvasEdgeLayer.tsx
    ArchiveSuggestionPanel.tsx
  hooks/
    useCanvasDocument.ts
    useCanvasDrag.ts
    useCanvasSelection.ts
```

infinite-canvas 保持现有目录，但补充 README 或模块边界说明。

#### 功能边界

- 包含：画布文档和节点交互。
- 不包含：工作流引擎、AI agent 具体推理、笔记主编辑器。

#### 业务流程

1. 根据 noteId/canvasId 加载画布文档。
2. 用户创建或拖动节点。
3. 画布保存节点与边。
4. 用户查看 AI 建议并接受/忽略。

#### 交互要求

- 拖拽流畅，不影响输入。
- 选中节点状态明确。
- AI 建议不遮挡主要操作。

#### 非功能性需求

- 拖拽状态拆入 hook，降低组件复杂度。
- 大量节点时避免无意义重渲染。
- AI 建议层与画布基础层松耦合。

#### 验收标准

- CanvasPage 拆分后节点创建、拖拽、编辑、保存可用。
- 归档建议和隐含连接建议可用。
- hooks 可针对节点更新和边更新写测试。

#### 依赖关系

- 依赖 M10 AI 建议层。
- 可被 M09 workflow 嵌入或引用。

---

### M09. 工作流画布

#### 模块定位

工作流画布负责 LiteGraph 工作流编辑、节点事件、agent 事件桥接和可视化执行状态。当前 `LiteGraphWorkflow.tsx` 需拆分 UI、graph 初始化、节点注册和事件总线。

#### 核心功能点

- LiteGraph 画布渲染。
- 工作流节点注册。
- agent 事件展示。
- 执行状态、日志、错误状态展示。
- 与 infinite-canvas 的 WorkflowNodeEmbed 协作。

#### 具体开发内容

```text
features/workflow/
  components/
    LiteGraphWorkflow.tsx
    WorkflowToolbar.tsx
    WorkflowStatusPanel.tsx
    WorkflowEventLog.tsx
  hooks/
    useLiteGraphCanvas.ts
    useWorkflowEvents.ts
  services/
    workflowNodeRegistry.ts
```

#### 功能边界

- 包含：工作流画布 UI、节点注册、工作流事件展示。
- 不包含：通用画布拖拽、AI 模型调用细节、笔记编辑。

#### 业务流程

1. 页面加载后初始化 LiteGraph。
2. 注册项目内置节点。
3. 用户编辑节点和连接。
4. agent 或工作流事件通过 eventBus 更新 UI。
5. 用户查看执行状态。

#### 交互要求

- 工具栏、状态栏和日志面板布局稳定。
- 节点画布操作不被外围 UI 干扰。
- 错误状态清晰可见。

#### 非功能性需求

- LiteGraph 初始化与 React 生命周期隔离。
- 事件订阅必须正确清理。
- 节点注册应集中管理。

#### 验收标准

- 原工作流画布可正常打开和操作。
- 事件日志和状态展示不回归。
- 组件拆分后无重复初始化问题。

#### 依赖关系

- 依赖 `features/workflow/eventBus.ts`、`agentEvents.ts`。
- 可被 M08 infinite-canvas 嵌入。
- 可与 M10 agent 模块通信。

---

### M10. AI 写作与建议层

#### 模块定位

AI 模块包括聊天、共写、写作报告、隐含连接建议、语义空白、情绪识别、规则引擎等。它应作为服务与 UI 层，为笔记、画布、伴侣提供建议，不应与主窗口页面强耦合。

#### 核心功能点

- AI 聊天面板。
- 写作建议与连接建议。
- 写作报告生成。
- 情绪/焦虑检测。
- Agent 事件采集。
- 模型供应商配置读取。

#### 具体开发内容

```text
features/agent/
  components/
    AgentSuggestionToast.tsx
    AgentSuggestionPanel.tsx
    WritingInsightPanel.tsx
  hooks/
    useAgentSuggestions.ts
    useWritingMood.ts
    useAgentProviders.ts
  services/
    agentContextAdapter.ts
```

现有 `DeepSeekChat`、`WritingCompanion`、`WritingReportPage` 可逐步迁入 `features/agent/components/pages`，或先保持位置但减少对 MainWindow 的直接耦合。

#### 功能边界

- 包含：AI 上下文组织、建议生成、建议展示、写作报告、情绪状态。
- 不包含：笔记保存、设置表单、Live2D 渲染底层。

#### 业务流程

1. 业务页面提供当前上下文，如 noteId、content、providers。
2. AI hook 组织上下文并调用对应服务。
3. 服务返回建议、报告或聊天结果。
4. UI 以面板、toast、报告页等方式展示。
5. 用户接受建议后回调给业务页面执行。

#### 交互要求

- AI 建议不能阻断用户写作。
- 可关闭、可忽略建议。
- 错误状态不应污染主编辑内容。

#### 非功能性需求

- AI 服务与 UI 分离，便于 mock。
- 请求需要防抖或用户主动触发，避免过度调用。
- provider 缺失时给出明确提示。

#### 验收标准

- AI 聊天、写作报告、连接建议现有入口可用。
- MainWindow 不直接承载复杂 agent 状态机。
- AI hook 可在测试中 mock provider 和内容。

#### 依赖关系

- 依赖 M05 设置中心的 provider 配置。
- 被 M02、M08、M09、M11 调用。

---

### M11. 伴侣与 Live2D

#### 模块定位

伴侣模块负责 BongoCat、Live2D、事件桥、伴侣窗口和伴侣配置。当前已有 `features/companion` 与 `features/live2d`，本次重点是清理边界和减少跨模块直接引用。

#### 核心功能点

- Live2D 角色加载和渲染。
- BongoCat 动作控制。
- 伴侣设置。
- 伴侣窗口管理。
- 写作/AI/窗口事件桥接。

#### 具体开发内容

- 保持 `features/companion/components` 作为伴侣 UI 层。
- 保持 `features/live2d` 作为渲染与模型控制层。
- 新增 `features/companion/services/companionEventAdapter.ts` 聚合外部事件。
- 将伴侣设置依赖的 UI 控件逐步切到 M06 shared UI。

#### 功能边界

- 包含：伴侣展示、模型控制、事件响应。
- 不包含：AI 推理、笔记保存、设置中心整体布局。

#### 业务流程

1. 用户开启伴侣。
2. 模块加载配置与模型资源。
3. 外部事件通过 adapter 输入。
4. 伴侣根据事件播放动作、表情或提示。

#### 交互要求

- 伴侣显示、隐藏、设置入口不变。
- 资源加载失败需有降级提示。
- 伴侣不遮挡核心编辑区域。

#### 非功能性需求

- Live2D 渲染层不直接依赖笔记工作台。
- 大资源加载应避免阻塞主页面。
- 事件桥必须可解绑。

#### 验收标准

- 现有 Live2D/BongoCat 功能可用。
- 伴侣事件来源通过 adapter 管理。
- 设置页和伴侣模块之间依赖清晰。

#### 依赖关系

- 可消费 M10 AI/写作事件。
- 可消费 M05 设置。
- 依赖 M07 窗口能力。

---

### M12. 账户、认证与同步

#### 模块定位

账户、认证与同步模块负责用户登录态、Supabase 客户端、配置上传下载、账户面板和同步触发。它是跨页面基础能力，但不应散落在应用壳层和设置页中。

#### 核心功能点

- Supabase auth 状态读取。
- 当前用户 ID 管理。
- 配置上传/下载。
- 同步防抖。
- 账户面板展示。
- 需要登录页面的访问控制提示。

#### 具体开发内容

```text
features/auth/
  hooks/
    useAuthUser.ts
  components/
    LoginRequiredState.tsx
features/sync/
  hooks/
    useConfigSync.ts
  components/
    SyncStatusBadge.tsx
```

#### 功能边界

- 包含：认证状态、配置同步、登录提示。
- 不包含：设置表单细节、社区业务数据、studio 表结构变更。

#### 业务流程

1. 应用启动时读取 auth session。
2. 用户登录态变化后更新全局 userId。
3. 配置变化触发防抖同步。
4. 登录受限页面根据 userId 展示内容或登录提示。

#### 交互要求

- 未登录提示保持清晰。
- 同步失败不阻塞本地使用。
- 账户面板入口不变。

#### 非功能性需求

- 同步请求防抖。
- 认证 hook 可 mock。
- 不在多个页面重复实现登录态监听。

#### 验收标准

- 登录态页面判断正确。
- 设置变更后同步行为与现有一致。
- 账户面板可正常展示。

#### 依赖关系

- 被 M01 应用壳层使用。
- 被 M05 设置中心展示。
- 被 garden/studio/social 等需要 userId 的模块使用。

---

### M13. 文档与模块治理

#### 模块定位

为防止拆分后再次失控，需要建立轻量治理规则：模块边界说明、代码所有权、验收模板、重构任务拆分记录。

#### 核心功能点

- 每个核心 feature 有 README 或模块说明。
- 新增 shared UI 必须说明复用来源。
- 巨型文件阈值预警。
- 拆分任务有验收清单。

#### 具体开发内容

- 在 `Docs/plans` 保存本 PRD。
- 后续为重点模块补充 `README.md` 或 ADR。
- 建议在 lint 或 CI 中增加文件行数检查脚本，初期只 warning，不阻塞。

#### 功能边界

- 包含：文档、模块规则、验收模板。
- 不包含：自动化平台或复杂治理系统。

#### 验收标准

- 本 PRD 覆盖拆分背景、原则、模块、边界、依赖、验收、优先级、排期。
- 后续每个拆分 PR 至少引用对应模块编号。
- 新增 shared 组件有来源和复用说明。

#### 依赖关系

- 支撑所有模块。

---

## 7. 模块依赖关系

### 7.1 依赖矩阵

| 模块 | 依赖 | 被依赖方 |
| --- | --- | --- |
| M01 应用壳层 | M12 Auth/Sync、M07 Windows | 所有页面模块 |
| M02 主笔记工作台 | M03、M04、M06、M07、M10 | M01 |
| M03 编辑器核心 | M06 | M02、M07 |
| M04 笔记数据保存 | notes/importExport/images API | M02、M07、M10 |
| M05 设置中心 | M06、M12、settings API | M01、M10、M11 |
| M06 共享 UI | 无业务依赖 | M02、M03、M05、M08、M09、M11 |
| M07 窗口能力 | Tauri windows API、M03、M04 | M01、M02、M11 |
| M08 画布 | M10、canvas API | M01、M09 |
| M09 工作流 | workflow eventBus、M10 | M01、M08 |
| M10 AI 建议层 | M05 provider 配置、agent services | M02、M08、M09、M11 |
| M11 伴侣/Live2D | M07、M10、M05 | M01 |
| M12 账户同步 | Supabase、sync API | M01、M05、garden/studio/social |
| M13 文档治理 | 无 | 所有模块 |

### 7.2 推荐依赖方向

```text
app
  -> features/*
features/*
  -> shared/ui
  -> shared/hooks
  -> shared/lib
features/*
  -> 同 feature 内 api/services/types
shared/*
  -> 不依赖 features/*
```

禁止方向：

```text
shared/ui -> features/*
features/settings -> features/notes/components
features/notes -> components/MainWindow
features/* -> app/*
```

---

## 8. 优先级排序

### P0：必须优先拆分

1. **M13 文档与治理**：先建立共识和验收标准。
2. **M01 应用壳层与路由视图**：为后续页面迁移提供稳定入口。
3. **M02 主笔记工作台**：最大风险文件，用户核心路径。
4. **M03 编辑器核心**：主窗口、NotePad、未来创作台均可复用。
5. **M04 笔记数据与保存流程**：避免 UI 拆分时破坏保存链路。

### P1：紧随其后

6. **M05 设置中心**：第二大文件，天然可分区拆分。
7. **M06 共享 UI 库**：在 M02/M05 中边拆边沉淀，不独立空转。
8. **M07 独立小窗与窗口能力**：配合编辑器复用，降低多窗口风险。

### P2：中期优化

9. **M08 画布与无限画布**。
10. **M09 工作流画布**。
11. **M10 AI 写作与建议层**。

### P3：后续整理

12. **M11 伴侣与 Live2D**。
13. **M12 账户、认证与同步**。

---

## 9. 排期建议

> 排期按阶段表达，不给出人日承诺。每个阶段均应可独立合并、测试、上线。

### 阶段 0：准备与防护

**目标**：建立拆分共识与回归保护。

开发内容：

- 合并本 PRD。
- 确认目标目录结构。
- 为 MainWindow 和 SettingsPage 梳理关键手动验收用例。
- 保留现有测试，确保基线可运行。

验收：

- PRD 评审通过。
- 拆分路径和模块编号明确。
- 回归 checklist 可用于后续 PR。

### 阶段 1：应用壳层 + 主笔记工作台骨架

**目标**：降低 MainWindow 复杂度，但不改变功能。

开发内容：

- 拆 M01 AppShell/routeViews。
- 拆 M02 NotesWorkspacePage、NotesSidebar、NoteStatusBar、空状态。
- 保持原 API 和用户行为不变。

验收：

- 主窗口、notepad、tile 启动路径可用。
- 笔记列表、分类、选择、搜索可用。
- 视觉无明显回归。

### 阶段 2：编辑器核心 + 保存流程

**目标**：把编辑与保存从页面容器中独立出来。

开发内容：

- 拆 M03 MarkdownEditor、EditorToolbar、ColorPalette。
- 拆 M04 useCurrentNote、useNoteAutosave、保存状态机。
- 将 NotePad 接入可复用编辑能力。

验收：

- 编辑、格式化、预览、保存、自动保存可用。
- 保存失败状态可展示且不丢内容。
- NotePad 与主编辑体验保持一致。

### 阶段 3：设置中心 + Shared UI

**目标**：拆解第二大页面，并沉淀第一批真实复用 UI。

开发内容：

- 拆 M05 SettingsLayout、各 Settings Panel、dialogs。
- 抽 M06 Button/Card/Dialog/TextField/ToggleRow。
- 调整 SettingsPanel 与 SettingsPage 的职责边界。

验收：

- 偏好、供应商、默认模型、快捷键、账户、统计、关于均可使用。
- shared UI 无业务依赖。
- 设置页不再形成单文件巨型组件。

### 阶段 4：画布、工作流、AI 边界整理

**目标**：降低中大型交互页面复杂度。

开发内容：

- 拆 M08 CanvasPage 的 viewport/node/edge/hook。
- 拆 M09 LiteGraphWorkflow 的 canvas 初始化、toolbar、事件日志。
- 拆 M10 Agent hooks 与 UI 面板。

验收：

- 画布节点操作、保存、AI 建议可用。
- 工作流画布可初始化、事件展示可用。
- AI 建议不与主窗口强耦合。

### 阶段 5：伴侣、认证同步与 monorepo 评估

**目标**：完成剩余边界清理，并判断是否进入 monorepo。

开发内容：

- 清理 M11 companion/live2d 事件 adapter。
- 抽 M12 useAuthUser/useConfigSync。
- 评估是否存在多 app 或独立 package 发布需求。

验收：

- 伴侣功能与事件桥可用。
- 登录态和同步逻辑集中。
- 给出 monorepo 是否启动的技术决策记录。

---

## 10. 独立开发、测试与上线策略

### 10.1 独立开发要求

每个模块拆分 PR 应满足：

- 只修改目标模块及必要入口。
- 不混入视觉重设计、功能新增和无关重构。
- 至少包含一个可手动验收路径。
- 若抽 shared UI，必须有两个以上真实调用方或明确即将接入的第二调用方。

### 10.2 测试策略

| 测试类型 | 适用模块 | 要求 |
| --- | --- | --- |
| 纯函数单测 | M03、M04、M05、M08 | 格式命令、保存状态、provider 编辑、节点更新 |
| Hook 测试 | M02、M04、M07、M10、M12 | 数据加载、自动保存、窗口事件、认证同步 |
| 组件渲染测试 | M02、M05、M06 | 列表项、设置 panel、shared UI |
| 手动回归 | 所有页面模块 | 启动、主流程、异常路径 |

### 10.3 上线策略

1. **功能等价拆分优先上线**：第一批 PR 不改变用户可见功能。
2. **按模块合并**：每个模块独立 PR，避免一个 PR 横跨多个大模块。
3. **可回滚**：入口层保留清晰替换点，如 `NotesWorkspacePage` 可单独回退。
4. **先内部 dogfood**：拆 MainWindow、SettingsPage 后重点自测主流程。
5. **再进行功能迭代**：结构稳定后再做 UI 库增强或 monorepo 迁移。

---

## 11. 验收总清单

### 11.1 产品验收

- 用户可以正常启动主窗口、小窗、Tile 窗口。
- 用户可以创建、搜索、选择、编辑、保存、删除笔记。
- 用户可以管理分类。
- 用户可以打开 Markdown 预览。
- 用户可以使用原有格式化工具栏。
- 用户可以进入设置页并修改所有原有设置项。
- 用户可以配置模型供应商与默认模型。
- 用户可以使用快捷键录制与校验。
- 用户可以打开画布、创作台、花园、个人主页等现有入口。
- AI、伴侣、同步能力不因拆分出现明显回归。

### 11.2 工程验收

- `MainWindow.tsx` 不再承载所有笔记工作台逻辑。
- `SettingsPage.tsx` 不再承载所有设置 panel/dialog/form 逻辑。
- 新 shared UI 不依赖任何 `features/*`。
- feature 内部 pages/components/hooks/services 分层清晰。
- 没有新增循环依赖。
- 构建、lint、测试通过。
- 每个拆分模块有明确 owner 和验收路径。

### 11.3 非功能验收

- 输入、保存、拖拽等高频交互无明显卡顿。
- 自动保存不阻塞编辑。
- 多窗口事件监听无泄漏。
- 错误状态可见且不吞掉用户内容。
- 页面视觉与当前风格一致。

---

## 12. monorepo 演进判断

### 12.1 当前结论

当前不建议立即升级 monorepo。原因：

- 目前只有一个主要应用包。
- `pnpm-workspace.yaml` 尚未真正配置多个 workspace package。
- 主要问题是页面职责和组件边界，而不是包管理边界。
- 立即 monorepo 会增加构建、路径、发布和依赖管理复杂度。

### 12.2 触发 monorepo 的条件

满足以下任意两个条件后，再启动 monorepo 迁移 PRD：

1. 出现两个以上独立应用：如 `desktop`、`web`、`admin`、`miniapp`。
2. `shared/ui` 已被大量 feature 使用，并需要独立版本管理。
3. `features/agent`、`features/editor` 等需要跨应用复用。
4. Supabase schema、Tauri、Web 前端需要独立 CI/CD。
5. 团队多人并行开发，单包依赖冲突和构建时间明显影响效率。

### 12.3 未来目标结构

```text
apps/
  desktop/
  web/
packages/
  ui/
  editor/
  agent/
  shared/
  supabase/
```

---

## 13. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 拆分过程引入功能回归 | 高 | 每个阶段只做结构迁移，不混入功能变化 |
| shared UI 抽象过度 | 中 | 只抽真实复用组件，保持 props 简单 |
| 自动保存逻辑被拆断 | 高 | 优先为保存状态机补测试，手动验收失败路径 |
| 多窗口事件泄漏 | 中 | 窗口 hook 中集中注册/解绑事件 |
| AI/伴侣依赖主窗口状态 | 中 | 通过 context adapter 传入上下文，不直接引用页面组件 |
| 设置页拆分后状态同步混乱 | 中 | 使用 settings draft hook 管理局部草稿与提交 |
| 一次性重构过大 | 高 | 严格按阶段和模块编号拆 PR |

---

## 14. 后续行动建议

1. 评审并确认本 PRD 的模块边界。
2. 先创建阶段 0 的回归 checklist。
3. 从 M01 + M02 开始，拆 `App.tsx` 与 `MainWindow.tsx` 的页面骨架。
4. 在 M03/M04 完成后再接入 NotePad 复用。
5. M05/M06 拆设置中心时同步沉淀第一批 shared UI。
6. 阶段 4 后再评估 monorepo，不提前引入工程复杂度。

---

## 15. 附录：建议 PR 拆分方式

| PR | 内容 | 对应模块 | 验收重点 |
| --- | --- | --- | --- |
| PR-01 | AppShell 与 routeViews | M01 | 各入口页面可打开 |
| PR-02 | NotesWorkspacePage + NotesSidebar | M02 | 笔记列表、搜索、分类 |
| PR-03 | NoteEditorPane + NoteStatusBar | M02/M03 | 编辑、状态展示 |
| PR-04 | useNoteAutosave + 保存状态机 | M04 | 自动保存、失败状态 |
| PR-05 | NotePad 复用编辑器 | M03/M07 | 小窗编辑不回归 |
| PR-06 | SettingsLayout + SettingsNav | M05 | 设置页分区切换 |
| PR-07 | Providers/Models/Hotkeys panels | M05 | 模型和快捷键配置 |
| PR-08 | shared UI 第一批 | M06 | 不含业务依赖，复用成功 |
| PR-09 | CanvasPage 拆分 | M08 | 节点操作和保存 |
| PR-10 | LiteGraphWorkflow 拆分 | M09 | 工作流事件与画布 |
| PR-11 | Agent hooks/context adapter | M10 | AI 建议入口可用 |
| PR-12 | Auth/Sync hooks | M12 | 登录态与同步可用 |

---

## 16. 文档结论

本次拆分应以“先模块化单仓，后评估 monorepo”为主线。最优先处理 `MainWindow.tsx` 和 `SettingsPage.tsx` 两个巨型文件，同时沉淀最小可用的 shared UI。每个模块都应保持可独立开发、测试和上线，避免在拆分过程中混入功能重写或视觉重设计。完成 P0/P1 后，项目将具备更清晰的 feature 边界，并为未来组件库、UI 库和 monorepo 演进提供稳定基础。
