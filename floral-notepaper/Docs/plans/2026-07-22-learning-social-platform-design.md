# 学习社交平台整体设计

日期：2026-07-22
项目：floral-notepaper
状态：已确认，待实施

## 一、架构总览

基于现有的 React + Tauri + Supabase + Pixi.js 技术栈，采用 **模块化领域架构**，将系统拆为三个独立领域模块：

```
floral-notepaper/src/
├── features/
│   ├── canvas/                    ← 已有：CanvasDocument 类型
│   ├── infinite-canvas/           ← 新增：无限画布系统
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── nodes/
│   │   ├── services/
│   │   └── types.ts
│   ├── garden/                    ← 新增：内容分类与空间系统
│   │   ├── components/
│   │   ├── pages/
│   │   ├── stores/
│   │   └── types.ts
│   ├── social/                    ← 新增：社交与个人主页
│   │   ├── components/
│   │   ├── pages/
│   │   ├── stores/
│   │   └── types.ts
│   ├── auth/                      ← 已有（扩展社交API）
│   ├── agent/                     ← 已有（复用AI能力）
│   ├── workflow/                  ← 已有（工作流节点嵌入画布）
│   └── collab/                    ← 已有（Yjs多人协作）
├── components/
│   ├── GardenLayout.tsx           ← 新增：花园布局框架
│   └── ...
└── App.tsx                        ← 修改：新增路由
```

### 技术选型

| 层 | 技术 | 说明 |
|---|---|---|
| 无限画布渲染 | Pixi.js v8 | WebGL 加速，已在项目依赖中 |
| 画布交互 | 自建交互系统 | 拖拽、缩放、多选、右键菜单 |
| 后端 | Tauri + Supabase | 本地文件系统 + 云端数据库 |
| 多人协作 | Yjs + Supabase | 复用现有 collab 模块 |
| AI 能力 | 现有 AgentSystem | 复用 agent 模块 |
| 工作流 | LiteGraph（嵌入节点） | 现有 LiteGraphWorkflow 作为画布的一个节点类型 |

## 二、领域一：InfiniteCanvas 无限画布系统

### 核心渲染

使用 Pixi.js Application 构建无限画布，包含：

- **CatalogCanvasViewport**：缩放/平移/无限滚动
- **GridRenderer**：网格背景绘制
- **SelectionManager**：多选/框选管理

### 节点系统

所有节点继承自统一接口 `CanvasNodeData`：

```typescript
interface CanvasNodeData {
  id: string;
  type: 'search_card' | 'article' | 'journal' | 'workflow' | 'note';
  x: number; y: number;
  width: number; height: number;
  zIndex: number;
  title: string;
  summary?: string;
  createdAt: number;
  updatedAt: number;
  authorId?: string;
  // 类型特有字段
  sourceUrl?: string;       // search_card
  content?: string;         // article / journal
  workflowId?: string;      // workflow
  tags?: string[];
  aiExpanded?: boolean;
}
```

### 关键交互流程

1. **知识点搜索 → 卡片挂载**：
   - 选中文字 → `SearchBridge` 调 Supabase/AI 搜索 → 创建 `SearchCardNode`
2. **灵感记录 → AI 扩写 → 文章发布**：
   - `JournalPanel` 记录 → Agent 扩写 → 生成为 `ArticleNode` → 发布到个人花园
3. **工作流嵌入**：
   - 添加 `WorkflowNode` → 内嵌 LiteGraph 画布 → 运行工作流

### 目录结构

```
src/features/infinite-canvas/
├── components/
│   ├── SearchBarWidget.tsx
│   ├── NodeContextMenu.tsx
│   ├── JournalPanel.tsx
│   └── WorkflowIntegration.tsx
├── hooks/
│   ├── useCanvasInteraction.ts
│   ├── useCanvasNodes.ts
│   └── useCanvasSearch.ts
├── nodes/
│   ├── BaseNode.ts
│   ├── SearchCardNode.ts
│   ├── ArticleNode.ts
│   ├── JournalNode.ts
│   ├── WorkflowNode.ts
│   └── NoteNode.ts
├── services/
│   ├── SearchBridge.ts
│   ├── JournalService.ts
│   ├── CollabSync.ts
│   └── NodeLayoutEngine.ts
└── types.ts
```

## 三、领域二：ContentSpace 内容分类与空间体系

### 双空间体系

#### 公共花园（PublicGarden）
- 全站内容聚合区，所有用户可浏览公开内容
- 支持按分类/热度/最新排序
- 展示所有 `isPublic: true` 的 GardenArticle

#### 个人花园（PersonalGarden）
- 用户私有创作空间
- 支持创建文件夹、新建/编辑项目
- 所有内容通过平台编辑器创作修改

### 数据模型

```typescript
interface Category {
  id: string; name: string; icon?: string;
  color?: string; userId: string;
  parentId?: string; articleCount: number;
  createdAt: number;
}

interface GardenArticle {
  id: string; title: string; summary: string;
  content: string; categoryId: string;
  tags: string[]; authorId: string;
  isPublic: boolean; coverImage?: string;
  viewCount: number; likeCount: number;
  createdAt: number; updatedAt: number;
}

interface GardenFolder {
  id: string; name: string; userId: string;
  parentId?: string; articleIds: string[];
  type: 'folder' | 'project';
}
```

### Supabase 表结构

参照设计阶段的 SQL 定义：
- `categories`：用户创建的分类标签
- `garden_articles`：公开/私有文章
- `garden_folders`：个人空间文件夹

### 目录结构

```
src/features/garden/
├── components/
│   ├── GardenLayout.tsx
│   ├── CategorySidebar.tsx
│   ├── ContentGrid.tsx
│   ├── CategoryCreator.tsx
│   └── SpaceSwitcher.tsx
├── pages/
│   ├── PublicGardenPage.tsx
│   └── PersonalGardenPage.tsx
├── stores/
│   └── useGardenStore.ts
└── types.ts
```

## 四、领域三：SocialProfile 个人主页重构

### 页面布局

采用小红书/网易云风格的大场景视觉：
- **顶部**：320px 大尺寸个人封面 Banner，渐变/图片/图案
- **头像区域**：96px 圆形头像带微光阴影，用户昵称/简介/编辑按钮
- **Tab 导航**：文章 / 喜欢 / 关注 / 粉丝 / 分类
- **内容区**：创作成果瀑布流 + 分类展示 + 社交统计数据

### 新增社交功能

在现有 `auth` 模块上扩展：

```
src/features/auth/
├── socialApi.ts    ← 新增：关注/取关/粉丝列表/获取统计
└── profileApi.ts   ← 新增：个人资料 CRUD / 封面上传
```

#### 新增 Supabase 表

- `follows`：关注关系表（follower_id, following_id, UNIQUE 约束）
- `user_stats`：用户统计数据（通过触发器更新）
- `user_profiles`：用户资料扩展（昵称/简介/头像/封面）

### 目录结构

```
src/features/social/
├── components/
│   ├── ProfileHeader.tsx
│   ├── ProfileTabs.tsx
│   ├── ProfileStats.tsx
│   ├── ProfileBanner.tsx
│   ├── CreationCard.tsx
│   ├── CategoryShowcase.tsx
│   └── SocialGraph.tsx
├── pages/
│   ├── MyProfilePage.tsx
│   └── UserProfilePage.tsx
├── stores/
│   └── useProfileStore.ts
└── types.ts
```

## 五、分阶段实施计划

### 第一阶段：基础设施搭建（预计主要工作量）
1. 在 Supabase 创建所有新表（categories, garden_articles, garden_folders, follows, user_stats, user_profiles）
2. 新增 `features/infinite-canvas/` 目录结构及基础类型
3. 新增 `features/garden/` 目录结构及基础类型
4. 新增 `features/social/` 目录结构及基础类型
5. 扩展 `features/auth/` 新增 socialApi 和 profileApi
6. 扩展 App.tsx 新增路由

### 第二阶段：无限画布核心
1. 搭建 Pixi.js 基础渲染框架（Viewport + Grid）
2. 实现节点系统（BaseNode + 各节点类型）
3. 实现拖拽/缩放/选择交互
4. 实现 SearchBridge 搜索集成
5. 实现 JournalPanel 灵感记录功能
6. 实现 AI 扩写接入（复用 Agent 模块）

### 第三阶段：内容空间
1. 实现公共花园页面（CategorySidebar + ContentGrid）
2. 实现个人花园页面（文件夹树 + 文件管理）
3. 实现文章发布/编辑流程
4. 实现分类标签创建与管理

### 第四阶段：个人主页与社交
1. 构建 ProfileHeader（大封面 + 用户信息）
2. 实现 Tab 导航与内容展示
3. 实现关注/粉丝系统
4. 实现统计数据展示
5. 实现编辑资料功能

### 第五阶段：集成与优化
1. 无限画布 ↔ 内容空间双向打通（画布中的文章可发布到花园）
2. 个人主页与画布/空间的数据联动
3. 多人协作集成测试
4. 性能优化与 bug 修复

## 六、暂缓项

- 文章评论系统
- 消息通知系统
- 内容推荐算法
- 移动端适配优化
- 国际化支持（现有 i18n 可后续扩展）
