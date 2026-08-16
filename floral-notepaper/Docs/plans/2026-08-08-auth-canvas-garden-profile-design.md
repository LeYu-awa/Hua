# Auth、画布、花园与个人页落地设计方案

日期：2026-08-08
项目：floral-notepaper
状态：已确认，进入设计文档落地

## 1. 背景与目标

当前项目已经具备 Supabase 登录、注册、用户信息读取、画布、Agent、花园和个人页等基础模块。本次需求按方案 A 推进：优先补齐最影响用户闭环的能力，并避免一次性大范围重构导致现有笔记、画布、Agent 与本地存储链路失稳。

本次设计确认三件事：

1. 登录模块不重复建设注册能力，改为补齐“忘记密码 / 重置密码”闭环。
2. 画布模块先落地核心实用能力，暂不集成 Live2D。
3. 花园模块与个人页先完成可开发的重构设计、高保真结构和交接说明，再进入代码实施。

## 2. 总体设计原则

- 保持现有 React + Tauri + Supabase 技术栈，不引入重型新框架。
- 优先复用现有模块：`features/auth`、`CanvasPage`、`CanvasMode`、`features/agent`、`features/garden`、`features/social`。
- 安全链路遵循 Supabase 官方 Auth 模型，密码重置不在前端保存敏感 token。
- 画布聚焦写作与创作组织能力，不扩展 Live2D 表演层。
- 花园与个人页使用同一套内容、用户、社交数据模型，减少重复状态源。
- 所有重构都保留可回退路径，避免影响已有本地笔记与用户内容。

## 3. 登录模块：忘记密码闭环

### 3.1 现状

现有登录与注册能力集中在：

- `src/features/auth/api.ts`
- `src/features/auth/supabase.ts`
- `src/components/AccountPanel.tsx`
- `src/app/AppShell.tsx`

当前 `AccountPanel` 已支持邮箱登录、注册、退出登录、头像上传和个人信息更新，但未提供忘记密码入口与新密码设置流程。

### 3.2 功能范围

新增能力：

1. 登录表单增加“忘记密码？”入口。
2. 用户输入邮箱后调用 Supabase 发送密码重置邮件。
3. 邮件链接回到应用指定 reset route 或当前 Web 容器可识别 URL。
4. 应用检测到 recovery session 后展示“设置新密码”表单。
5. 新密码通过强度校验后调用 Supabase 更新密码。
6. 修改成功后清理表单状态，并引导用户自动回到登录状态或已登录主页。

暂不做：

- 手机号短信找回。
- 自建验证码服务。
- 后端自定义密码重置 token。

### 3.3 交互流程

```text
登录页
  → 点击“忘记密码？”
  → 输入邮箱
  → 发送重置邮件
  → 展示“邮件已发送，请检查邮箱”
  → 用户点击邮件链接
  → 应用进入 recovery 状态
  → 输入新密码 + 确认新密码
  → 前端强度校验通过
  → supabase.auth.updateUser({ password })
  → 成功提示
  → 自动进入已登录状态或返回登录页
```

### 3.4 密码强度规则

第一版使用前端强校验：

- 长度至少 8 位。
- 至少包含 1 个字母。
- 至少包含 1 个数字。
- 至少包含 1 个特殊字符。
- 新密码与确认密码一致。

错误提示保持明确但不过度暴露安全细节，例如：“密码需至少 8 位，并包含字母、数字和特殊字符”。

### 3.5 API 设计

在 `features/auth/api.ts` 增加：

```ts
export async function resetPassword(email: string, redirectTo?: string): Promise<void>;
export async function updatePassword(password: string): Promise<void>;
```

实现分别映射：

- `supabase.auth.resetPasswordForEmail(email, { redirectTo })`
- `supabase.auth.updateUser({ password })`

### 3.6 UI 设计

`AccountPanel` 新增三个 mode：

- `login`
- `register`
- `forgotPassword`
- `resetPassword`

UI 保持现有纸张、竹色、低饱和样式。新增提示态：

- 邮箱格式错误。
- 邮件发送中。
- 邮件已发送。
- 链接失效或 session 缺失。
- 新密码强度不足。
- 密码修改成功。

## 4. 画布模块：核心实用能力优先

### 4.1 现状

项目内已有两类画布能力：

- `src/components/CanvasPage.tsx`：SVG 自绘节点、连线、保存、智能归档、Agent 建议。
- `src/components/canvas/CanvasMode.tsx`：LiteGraph 工作流画布承载入口，已接入 Agent 事件采集。
- `src/components/workflow/LiteGraphWorkflow.tsx`：工作流画布基础实现。
- `Docs/plans/2026-07-22-litegraph-workflow-canvas-design.md`：已有 LiteGraph 迁移设计。

本次不推翻既有设计，而是在其基础上补充“可用画布”的产品闭环与业务结合逻辑。

### 4.2 核心功能模块

第一优先级：

1. **节点管理**：文本节点、卡片节点、资料节点、任务节点。
2. **连线管理**：手动连线、Agent 推荐弱连线、确认后转实线。
3. **保存加载**：本地 Tauri `canvas_save` / `canvas_get` 为主，后续补云同步。
4. **与笔记关联**：画布 documentId 与当前 noteId 绑定，支持从笔记进入对应画布。
5. **智能归档**：复用 `generateArchiveSuggestions`，提供标签建议、节点分组建议。
6. **Agent 事件采集**：节点新增、编辑、移动、连线、运行全部转为 Agent 可读事件。
7. **运行/分析入口**：保留 LiteGraph 工作流执行与校验入口，不依赖 Live2D。

第二优先级：

1. 搜索节点、筛选节点、按类型折叠。
2. 节点模板库。
3. 画布快照与版本恢复。
4. 多人协作与 Yjs/Supabase 同步。

暂缓：

- Live2D 角色表演。
- 大规模 1000+ 节点性能专项。
- 完全复刻 ComfyUI 高级右键菜单。

### 4.3 数据交互流程

```text
用户打开笔记
  → AppShell 获取 currentNoteId
  → renderMainView 进入 CanvasPage
  → CanvasPage 使用 documentId = canvas-{noteId}
  → getCanvasDocument 加载画布
  → 用户编辑节点 / 连线
  → saveCanvasDocument 持久化
  → workflowToAgentEvents 采集画布变化
  → Agent 分析连接、空白视角、讨论分歧
  → 用户接受建议
  → 写回画布 document
```

### 4.4 权限控制规则

未登录：

- 允许使用本地画布。
- 允许本地保存。
- 不允许云同步、公开分享、多人协作。
- Agent 能力取决于本地 provider 配置。

已登录：

- 可绑定 userId。
- 可同步画布配置与未来云端画布。
- 可将画布沉淀为花园内容或个人主页展示内容。
- 可使用社交关系权限控制公开、私密、仅好友可见。

内容权限建议：

- `private`：仅自己可见。
- `unlisted`：持链接可见。
- `public`：进入公共花园。
- `friends`：仅关注/好友关系可见。

### 4.5 与其他模块对接

- **笔记模块**：当前笔记可一键生成画布节点，画布节点可回链原文片段。
- **共笔模块**：共笔段落可沉淀为卡片节点，保留 human/ai 来源。
- **花园模块**：画布可发布为文章、项目或灵感集合。
- **个人页**：展示用户精选画布、创作项目、公开文章和成长数据。
- **Agent 模块**：画布作为 Agent 的结构化上下文输入。
- **设置模块**：控制 Agent 开关、provider、联网搜索能力。

### 4.6 Agent 与联网搜索技术路径

Agent 接入采用三层结构：

1. **上下文采集层**：节点、连线、笔记片段、用户操作事件。
2. **推理编排层**：现有 `useCanvasAgent`、`agentOrchestrator`、`connectionRecommendations`。
3. **工具执行层**：后续增加 `webSearchTool`，输入查询词，返回结构化搜索摘要与来源。

联网搜索集成建议：

```text
画布节点 / 用户问题
  → Agent 判断是否需要外部信息
  → 生成 search query
  → 调用联网搜索工具
  → 返回 sources + snippets
  → Agent 生成“资料卡片”节点
  → 用户确认后写入画布
```

搜索结果节点必须标记来源：

- title
- url
- retrievedAt
- snippet
- trustLevel
- createdBy: `agent-search`

## 5. 花园模块重构设计

### 5.1 现状

现有花园模块包括：

- `GardenLayout`
- `PublicGardenPage`
- `PersonalGardenPage`
- `ContentGrid`
- `CategorySidebar`
- `useGardenStore`

当前信息架构偏“内容列表 + 分类”，还没有充分体现“写作花园”的成长感、项目感和个人陪伴感。

### 5.2 新信息架构

花园改为三层：

1. **公共花园**：发现公开作品、灵感集合、主题分类。
2. **我的花园**：我的项目、草稿、发布内容、成长状态。
3. **植物状态层**：把写作行为映射成温和的成长反馈。

### 5.3 页面结构

公共花园：

- 顶部：搜索、分类、排序。
- 中区：瀑布流 / 卡片网格。
- 侧边：主题分类、热门标签、推荐创作者。
- 卡片：标题、摘要、封面、作者、标签、阅读/收藏/评论。

我的花园：

- 顶部：今日写作状态、连续天数、近期产出。
- 左侧：项目/文件夹树。
- 中区：我的文章、画布、草稿、灵感卡片。
- 右侧：植物状态、目标进度、最近活动。

植物状态：

- 用低频、克制、长期反馈，不做强游戏化。
- 写作字数、连续天数、完成文章、回访旧稿影响植物状态。
- 状态表达为生长、开花、轻微低垂，不使用惩罚性文案。

### 5.4 视觉方向

- 保持东方纸感、竹色、低饱和自然色。
- 卡片更现代，减少 emoji 依赖。
- 使用更清晰的层级：标题、说明、状态、操作。
- 多端适配：桌面三栏、平板双栏、移动端单栏 + 底部 tab。

### 5.5 可开发路径

第一阶段：

- 重构 `GardenLayout` 顶部与空间切换。
- 强化 `PersonalGardenPage` 的“我的项目 + 成长状态”。
- `ContentGrid` 增加多类型卡片支持。

第二阶段：

- 增加植物状态组件 `GardenGrowthPanel`。
- 接入写作统计和文章发布数据。
- 支持从画布发布到花园。

第三阶段：

- 增加公开内容筛选、创作者推荐和社交互动增强。

## 6. 个人页重构设计

### 6.1 现状

现有个人页包括：

- `MyProfilePage`
- `UserProfilePage`
- `ProfileHeader`
- `ProfileTabs`
- `CreationCard`
- `CategoryShowcase`
- `SocialGraph`

当前个人页基础结构可用，但公开视角内容未完善，个人成果、创作习惯、花园状态之间的联系不够强。

### 6.2 新信息架构

个人页分为四区：

1. **身份区**：头像、昵称、简介、关注关系、编辑入口。
2. **创作概览**：文章数、画布数、连续写作、精选项目。
3. **内容陈列**：文章、画布、收藏、分类。
4. **关系与动态**：关注、粉丝、最近活动。

### 6.3 我的主页

我的主页强调管理与复盘：

- 编辑资料。
- 管理公开内容。
- 查看写作状态。
- 进入我的花园。
- 展示精选作品。

### 6.4 他人主页

他人主页强调浏览与关注：

- 查看公开作品。
- 关注 / 取消关注。
- 浏览分类与精选画布。
- 不展示隐私统计。

### 6.5 高保真原型结构

桌面布局：

```text
┌──────────────────────────────────────────────┐
│ Profile Hero：头像 / 昵称 / 简介 / 操作        │
├──────────────────────────────────────────────┤
│ Stats：文章 / 画布 / 连续写作 / 粉丝           │
├───────────────┬──────────────────────────────┤
│ Tabs          │ Content Grid                  │
│ - 文章        │ - Article Card                 │
│ - 画布        │ - Canvas Card                  │
│ - 分类        │ - Collection Card              │
│ - 动态        │                                │
└───────────────┴──────────────────────────────┘
```

移动端布局：

```text
Hero
Stats 横滑
Tabs sticky
Content 单列卡片
底部导航沿用主应用入口
```

### 6.6 可开发路径

第一阶段：

- 完善 `UserProfilePage` 的只读内容区。
- `MyProfilePage` 与 `UserProfilePage` 复用内容组件。
- 增加空状态、加载态、错误态。

第二阶段：

- 加入画布卡片与精选项目。
- 与花园内容模型打通。
- 增加公开/私密权限显示。

第三阶段：

- 增加最近动态、社交关系页和关注推荐。

## 7. 数据模型补充建议

### 7.1 Auth Profile

```ts
interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio?: string | null;
  created_at: string;
  updated_at: string;
}
```

### 7.2 Canvas Publish Target

```ts
interface CanvasPublishMeta {
  id: string;
  canvasId: string;
  userId: string;
  visibility: "private" | "unlisted" | "public" | "friends";
  title: string;
  summary: string;
  coverUrl?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

### 7.3 Garden Item

```ts
interface GardenItem {
  id: string;
  type: "article" | "canvas" | "draft" | "collection";
  ownerId: string;
  title: string;
  summary: string;
  visibility: "private" | "unlisted" | "public" | "friends";
  tags: string[];
  stats: {
    views: number;
    likes: number;
    comments: number;
  };
}
```

## 8. 验收标准

### 登录模块

- 登录页有忘记密码入口。
- 可发送 Supabase 密码重置邮件。
- recovery 链接进入新密码设置状态。
- 密码强度校验明确。
- 更新成功后无错误状态残留。

### 画布模块

- 画布可创建、编辑、删除节点。
- 画布可保存与重新加载。
- 节点可关联当前笔记。
- Agent 建议可被接受或忽略。
- 联网搜索能力有明确工具接口与数据落点。
- Live2D 不进入本阶段实现。

### 花园模块

- 公共花园与我的花园信息架构清晰。
- 我的花园体现项目、内容、成长状态。
- 卡片布局适配桌面、平板、移动端。
- 从画布发布到花园有清晰技术路径。

### 个人页

- 我的主页与他人主页视角分离。
- 用户资料、创作统计、内容列表完整。
- 公开权限与私密内容不混淆。
- 页面具备加载态、空状态、错误态。

## 9. 实施顺序建议

1. 补齐 Auth 忘记密码闭环。
2. 稳定画布保存、节点、连线、Agent 事件链路。
3. 写入画布与 Agent 联网搜索工具接口设计。
4. 重构花园信息架构与核心页面组件。
5. 重构个人页内容展示与只读公开视角。
6. 补充测试并验证构建。

## 10. 风险与处理

- Supabase 重置链接在 Tauri 桌面环境中可能需要额外 redirect URL 配置；第一版可使用 Web 回调或应用内 hash/query 检测。
- 画布存在 SVG 自绘与 LiteGraph 两套实现，需要避免继续扩大分叉；新增能力优先沉淀到可迁移的数据结构。
- 花园和个人页都引用文章、分类、用户资料，重构时需要先抽共享展示组件，避免重复请求与状态错乱。
- 联网搜索涉及外部数据来源，搜索结果必须保留来源、时间和可信度，不应直接覆盖用户内容。
