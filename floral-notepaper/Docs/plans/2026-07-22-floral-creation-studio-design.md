# 花箴·创作台 (Floral Creation Studio) 设计文档

> 定位：Notion + 小红书 ——「创作过程即内容」
> 日期：2026-07-22
> 状态：设计确认，待实现

---

## 1. 产品定位

一款以**块级编辑器为核心**、**创作过程为可沉淀内容**的创作者工具，无缝衔接从灵感收集 → 内容创作 → 多平台分发的全链路。编辑器本身既产出内容，也记录创作轨迹，实现「创作过程即内容」的核心定位。

### 目标用户

- 小红书内容创作者（图文/视频）
- 习惯 Notion 式块级编辑的知识工作者
- 重视创作过程记录与复用的深度用户

---

## 2. 技术选型

| 维度       | 选择                            | 理由                                     |
| ---------- | ------------------------------- | ---------------------------------------- |
| 编辑器引擎 | **TipTap** (ProseMirror)        | 块级编辑原生支持，Yjs 协作集成，社区活跃 |
| 编辑器入口 | **侧边栏新增「创作」** 独立页面 | 全屏深度创作体验，不与现有功能冲突       |
| 实时协作   | **Yjs + Supabase Realtime**     | CRDT 无冲突合并，复用现有 Supabase 通道  |
| 状态管理   | **Zustand** (项目已有)          | 轻量、TypeScript 友好                    |
| 持久化     | **Supabase** + IndexedDB 缓存   | 云端 + 离线草稿双保险                    |
| 样式       | **Tailwind CSS** (项目已有)     | 与全站风格一致                           |
| 国际化     | **react-i18next** (项目已有)    | 复用现有 i18n 配置                       |

---

## 3. 模块设计

### 3.1 模块1：块级编辑器核心

#### 架构分层

```
┌──────────────────────────────────────────────────────┐
│                     UI 组件层                          │
│  EditorToolbar  SlashMenu  BubbleMenu  DragHandle     │
│  BlockMenu (块类型选择面板)   CoverCropModal           │
├──────────────────────────────────────────────────────┤
│              TipTap 编辑器 (ProseMirror 引擎)          │
│  扩展插件:                                              │
│    @tiptap/extension-placeholder                       │
│    @tiptap/extension-drag-handle                       │
│    @tiptap/extension-collaboration (Yjs)               │
│    @tiptap/extension-character-count                   │
│    @tiptap/extension-image / video                     │
│    @tiptap/extension-task-list / task-item             │
│    @tiptap/extension-table / table-row / table-cell     │
├──────────────────────────────────────────────────────┤
│                 自定义块类型 (NodeView)                 │
│  ┌─────────────────────────────────────────────────┐  │
│  │  Text   Heading  Image  Video  Todo  Divider     │  │
│  │  Blockquote  CodeBlock  Callout                  │  │
│  │  TopicTag  EmojiPicker  CoverCrop  Database      │  │
│  └─────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────┤
│                    数据层                               │
│  Yjs Document ←→ Supabase Realtime ←→ garden_articles │
│  drafts (本地 IndexedDB + 云端)                        │
│  versions (版本快照表)                                  │
└──────────────────────────────────────────────────────┘
```

#### 编辑器入口与页面路由

侧边栏新增 `AppView` 值 `"studio"`，图标使用 ✦ 或自定义 SVG。
路由渲染：`<StudioEditorPage userId={userId} />`

`StudioEditorPage` 布局：

```
┌───── EditorSidebar ────┬────────── EditorCanvas ──────────┐
│  文章列表              │   TipTap 编辑器                   │
│  ├ 草稿箱              │   ┌─Toolbar──────────────────┐   │
│  ├ 灵感收集箱          │   │  H1 B I U ··· 话题标签 表情 │   │
│  ├ 今日创作            │   ├─Editor───────────────────┤   │
│  │                     │   │                           │   │
│  └─                    │   │   / 触发斜杠菜单           │   │
│                        │   │   拖拽排序 / 嵌套           │   │
│  右侧面板              │   │                           │   │
│  ├ 创作轨迹            │   └───────────────────────────┘   │
│  ├ 素材管理            └───────────────────────────────────┘
│  └ 分享工具
└──────────────────────────────────────────────────────────
```

#### 小红书专属工具

| 工具         | 实现方式                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| **话题标签** | 自定义 `TopicTag` 块，输入 `#` 触发自动补全（调用标签库 API），多标签组合渲染为小红书风格蓝色标签         |
| **表情库**   | 自定义 `EmojiPicker` 块或 BubbleMenu 按钮，弹出分类 emoji 面板（小红书高频表情分类：日常/心情/美食/旅行） |
| **字号美化** | 预设字号 CSS class：`.xh-title-lg` / `.xh-title-md` / `.xh-body` / `.xh-caption`，对应小红书正文排版规范  |
| **封面裁切** | 自定义 `CoverCrop` 块：拖拽选取 3:4 竖版区域（建议 1080×1440px），实时预览封面效果，支持多图封面轮播预览  |
| **画质压缩** | 图片上传管道中可选压缩级别（无损/高清/均衡），使用 `canvas.toBlob` 或 `browser-image-compression` 库      |

#### 实时自动存稿

- **触发条件**：编辑器内容变化（`onUpdate` 事件）
- **防抖**：2s debounce
- **存储目标**：Supabase `drafts` 表 + 本地 IndexedDB
- **恢复机制**：进入编辑器时优先加载本地草稿，再同步云端最新版
- **关闭保护**：`beforeunload` 事件强制 flush 未保存内容

#### 版本历史

```sql
-- versions 表设计
CREATE TABLE document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES garden_articles(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  content JSONB NOT NULL,          -- 完整块结构快照
  title TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  change_summary TEXT              -- 本次变更摘要 (自动生成)
);

CREATE INDEX idx_versions_article ON document_versions(article_id, version_number DESC);
```

#### 多人协同编辑

- **Yjs Document**：每个文章对应一个 Yjs Document
- **Awareness**：通过 Supabase Realtime 广播用户光标位置、选区颜色
- **冲突解决**：CRDT 自动合并，无需手动处理冲突
- **协作者列表**：在编辑器右上角显示在线用户头像

---

### 3.2 模块2：创作过程管理

#### 全链路记录系统

```
创作轨迹数据流：

[用户编辑] → [变更事件] → [写入 activity_log 表]
                               ↓
                         [创建灵感草稿] → [关联到文章]
                               ↓
                         [素材收集] → [关联到文章]
                               ↓
                         [批注/思路备注] → [可转正为段落]
                               ↓
                         [一键导出为片段]
```

**activity_log 表设计：**

```sql
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  article_id UUID REFERENCES garden_articles(id),
  action_type TEXT NOT NULL,        -- 'edit' | 'create_draft' | 'collect_material' | 'add_note' | 'export_segment'
  content JSONB,                   -- 变更内容快照
  metadata JSONB,                  -- { position, block_type, change_size }
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### 灵感草稿箱

- **快速录入**：Ctrl+Shift+N 或浮动按钮，弹出轻量级输入框
- **自动关联**：草稿可拖入编辑器正文，保留原始创作时间戳
- **升级路径**：草稿 → 正式文章（保留完整演化链）

#### 素材收集箱

- **导入方式**：
  - 浏览器插件/书签栏一键抓取当前页面
  - 微信文章分享到本应用（通过 URL Scheme 或剪贴板）
  - 手动拖拽/粘贴链接
- **自动解析**：提取标题、封面图、摘要、来源链接
- **素材管理**：按文章关联、按标签分类

#### 创作批注

- **触发**：选中文本 → BubbleMenu → 添加批注
- **可见性**：仅自己可见（私密批注）
- **转正**：批注可一键转为编辑器中的正式段落

#### 进度看板

看板视图采用类似 Trello 的列式布局：

| 列        | 内容                                   | 操作                          |
| --------- | -------------------------------------- | ----------------------------- |
| 📝 待创作 | 灵感草稿、素材收集箱中标记为任务的项目 | 拖入「创作中」开始写作        |
| ✏️ 创作中 | 正在编辑的草稿/文章（最近有编辑活动）  | 点击打开编辑器                |
| 🔍 待审核 | 标记为「待审核」的文章                 | 预览/审核/驳回/发布           |
| ✅ 已发布 | 已发布到小红书或导出到 Notion 的文章   | 查看已发布状态/编辑已发布版本 |

---

### 3.3 模块3：分享分发

#### 小红书分享链路

```
[编辑器内容] → [格式转换器] → [合规预检] → [生成发布包]
                                    ↓
                              [通过] → [一键复制/跳转小红书]
                              [未通过] → [显示具体问题]
```

**格式转换器规则：**

| 编辑器块类型 | 小红书格式                 |
| ------------ | -------------------------- |
| Heading 1    | 加粗大号文字 + 换行 × 2    |
| Heading 2    | 加粗中号文字 + 换行        |
| Paragraph    | 自然段，每段不超过 3 行    |
| Image (单张) | 封面图（独立上传）         |
| Image (多张) | 轮播图，自动排序           |
| TopicTag     | `#话题标签` 追加到正文末尾 |
| Emoji        | 保留原生 emoji             |
| Todo List    | 转换为带 ✅ 的纯文本列表   |

**合规预检清单：**

- [x] 敏感词检测（调用敏感词 API 或本地词库）
- [x] 封面尺寸校验（宽高比 3:4，建议 1080×1440）
- [x] 正文长度 ≤ 1000 字
- [x] 话题标签 ≤ 10 个
- [x] 图片数量 ≤ 9 张（小红书限制）

#### Notion 生态导出

**导出格式：**

- `.md` 文件（Notion 兼容的 Markdown + frontmatter 元数据）
- 包含：文章标题、正文、封面图链接、标签、时间戳
- 可选包含：创作轨迹、批注、素材记录

**一键分享：**

- 通过 Notion API（`POST /v1/pages`）在用户指定的 Notion 数据库中创建页面
- 或生成可下载的 `.md` 压缩包

---

## 4. 数据模型补充

### 新增表

```sql
-- 草稿表
CREATE TABLE drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  title TEXT,
  content JSONB NOT NULL DEFAULT '{}',
  blocks JSONB,                    -- TipTap 块结构快照
  source TEXT,                     -- 'manual' | 'import' | 'convert_from_note'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 创作轨迹日志 (同上 activity_log)
-- 灵感草稿
CREATE TABLE inspiration_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  article_id UUID REFERENCES garden_articles(id),
  content TEXT NOT NULL,
  source TEXT,                     -- 'quick_note' | 'clipboard' | 'wechat' | 'browser'
  source_url TEXT,
  is_task BOOLEAN DEFAULT false,   -- 是否标记为待创作任务
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 素材收集
CREATE TABLE collected_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  article_id UUID REFERENCES garden_articles(id),
  title TEXT,
  summary TEXT,
  cover_url TEXT,
  source_url TEXT NOT NULL,
  source_type TEXT,                -- 'wechat' | 'web' | 'manual'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 创作批注
CREATE TABLE creation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  article_id UUID REFERENCES garden_articles(id),
  block_id TEXT,                   -- TipTap 块 ID
  content TEXT NOT NULL,
  is_promoted BOOLEAN DEFAULT false, -- 是否已转正为正文
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 5. 文件结构规划

```
src/
├── features/
│   └── studio/                        # 创作台模块
│       ├── pages/
│       │   └── StudioEditorPage.tsx    # 编辑器主页面
│       ├── components/
│       │   ├── EditorCanvas.tsx        # TipTap 编辑器容器
│       │   ├── EditorToolbar.tsx       # 工具栏
│       │   ├── EditorSidebar.tsx       # 侧边栏（文章列表/草稿箱）
│       │   ├── SlashMenu.tsx           # 斜杠菜单
│       │   ├── NodeViews/
│       │   │   ├── TopicTagNode.tsx    # 话题标签块
│       │   │   ├── CoverCropNode.tsx   # 封面裁切块
│       │   │   └── EmojiPickerNode.tsx # 表情选择块
│       │   ├── KanbanBoard.tsx         # 进度看板
│       │   ├── InspirationCollector.tsx # 灵感收集箱
│       │   ├── MaterialCollector.tsx   # 素材收集箱
│       │   ├── ActivityTimeline.tsx    # 创作轨迹时间线
│       │   └── SharePanel.tsx          # 分享面板
│       ├── hooks/
│       │   ├── useStudioEditor.ts      # 编辑器状态与操作
│       │   ├── useAutoSave.ts          # 自动存稿
│       │   ├── useActivityLog.ts       # 创作轨迹记录
│       │   └── useShare.ts             # 分享逻辑
│       ├── services/
│       │   ├── xiaohongshu.ts          # 小红书格式转换
│       │   ├── complianceCheck.ts      # 合规预检
│       │   ├── notionExport.ts         # Notion 导出
│       │   ├── imageCompress.ts        # 图片压缩
│       │   └── materialParser.ts       # 素材解析
│       ├── stores/
│       │   └── useStudioStore.ts       # Zustand 状态管理
│       └── types.ts                    # 类型定义
```

---

## 6. 开发阶段规划

### Phase 1：编辑器基础设施

- 安装 TipTap 依赖 + 配置扩展
- StudioEditorPage 布局（侧边栏 + 编辑器区域）
- 基础块类型：文本、标题、图片、分隔线、引用、代码块
- 斜杠菜单（插入块）
- 自动存稿（防抖 + Supabase 持久化）

### Phase 2：小红书专属工具

- TopicTag 块 + 自动补全
- EmojiPicker 面板
- 图片上传管道（含画质压缩）
- CoverCrop 封面裁切

### Phase 3：创作过程管理

- activity_log 全链路记录
- 灵感草稿箱（快速录入 + 管理）
- 素材收集箱（链接导入 + 自动解析）
- 创作批注
- 进度看板

### Phase 4：分享分发

- 小红书格式转换器
- 合规预检工具
- Notion 导出 / API 发布
- 版本历史管理

### Phase 5：多人协同

- Yjs 集成 + Supabase Realtime 通道
- 光标/选区同步
- 协作者列表

---

## 7. 设计原则

1. **创作过程即内容**：每一次编辑、每一个灵感碎片都是可发布的内容资产，而非中间废料
2. **最小侵入**：编辑器侧边栏新增入口，不破坏现有 Notion/花园/画布等模块
3. **小红书原生感**：编辑器内预览体验接近小红书发布页，降低发布前的心智转换成本
4. **渐进增强**：先做单机完整功能，再做协同；先做核心编辑，再做分享分发

---

## 8. 参考与迁移

| 资源       | 路径                                                       |
| ---------- | ---------------------------------------------------------- |
| 设计文档   | `Docs/plans/2026-07-22-floral-creation-studio-design.md`   |
| 数据库迁移 | `supabase/migrations/011_studio_tables.sql`                |
| 编辑器入口 | `AppSidebar.tsx` → 新增 `"studio"` view，图标 ✦            |
| 主页面     | `src/features/studio/pages/StudioEditorPage.tsx`           |
| 编辑器核心 | `src/features/studio/components/EditorCanvas.tsx` (TipTap) |
| 状态管理   | `src/features/studio/stores/useStudioStore.ts` (Zustand)   |
| 小红书工具 | `src/features/studio/services/xiaohongshu.ts`              |
| 合规预检   | `src/features/studio/services/complianceCheck.ts`          |

### 迁移清单 (Supabase)

执行 `supabase/migrations/011_studio_tables.sql` 会创建以下新表：

- `document_versions` — 版本历史
- `drafts` — 自动存稿
- `activity_log` — 创作轨迹日志
- `inspiration_drafts` — 灵感草稿
- `collected_materials` — 素材收集
- `creation_notes` — 创作批注

同时对 `garden_articles` 表补充 `cover_crop` 和 `status` 字段。
