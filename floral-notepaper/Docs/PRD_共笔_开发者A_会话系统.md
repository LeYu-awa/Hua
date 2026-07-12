# 共笔模式 PRD — 开发者 A：会话系统

## 你的职责

端到端负责共笔模式的**完整会话系统**：数据模型（前后端统一）、本地持久化（Rust）、会话 CRUD、共笔页面整体 UI 框架、作者分色渲染、写作统计、撤回、一键续写。

## 功能清单

| 功能                        | 状态      |
| --------------------------- | --------- |
| 会话 CRUD（新建/切换/删除） | ✅ 已实现 |
| AI 身份选择（5 种）         | ✅ 已实现 |
| 交替写作                    | ✅ 已实现 |
| 作者分色渲染                | ✅ 已实现 |
| 合并到笔记                  | ✅ 已实现 |
| 写作统计面板                | 🆕 待实现 |
| 撤回上一步                  | 🆕 待实现 |
| 一键续写模式                | 🆕 待实现 |

---

## 🆕 新增功能详情

### 功能 1：写作统计面板

在共笔页面的内容区顶部增加一个可折叠的统计栏，实时显示：

- **总段落数**：human 几段 + AI 几段
- **字数统计**：human 总字数 / AI 总字数
- **字数占比**：一个简单的条形图（bamboo 绿 = AI，墨色 = human）
- **会话时长**：从第一段到最后一段的时间跨度
- **最后活跃时间**：距上次编辑多久

UI 形态：一个可折叠的横条，默认折叠，点击展开。展开后占用内容区上方约 60px 高度。

需要新增类型：

```typescript
interface CoWriteStats {
  humanBlocks: number;
  aiBlocks: number;
  humanChars: number;
  aiChars: number;
  totalTurns: number;
  durationMs: number;
  lastActiveAt: number;
}
```

### 功能 2：撤回上一步

可以在 `handleUndo` 中发起撤回：

1. 用户点击"撤回"按钮
2. 弹出确认（"撤回 AI 的最后一段回复？"或"撤回你最后的输入？"）
3. 根据 `session.blocks` 的最后一条的 `author` 决定撤回内容描述
4. 调用 `cowrite_undo_last(sessionId)` → 后端移除 `blocks` 的最后一项并重新保存
5. 前端刷新 `activeSession`

涉及修改：

- `api.ts`：新增 `undoLastTurn(sessionId)`
- `cowrite.rs`：新增 `undo_last_turn(session_id)` 方法
- `lib.rs`：新增 `cowrite_undo_last` Tauri 命令
- `CoWritePage.tsx`：在输入区旁加撤回按钮

### 功能 3：一键续写模式

在输入区上方增加一个开关按钮：

- 默认关闭，按钮文案"手动模式"
- 点击开启，变为"自动续写"，按钮高亮（bamboo 绿底）
- 开启后：用户提交 human 文字 → 自动立刻触发 AI 续写（不需要再点"轮到 AI"）
- AI 返回后 → human 可以继续写下一段
- 关闭后恢复手动模式

状态：`const [autoTurn, setAutoTurn] = useState(false);`

在 `handleHumanSubmit` 中增加逻辑：提交成功后如果 `autoTurn` 为 true，自动调 `handleAITurn()`。

---

## 需要你维护的文件

### 新建（已完成）

| 文件                                   | 说明           | 状态      |
| -------------------------------------- | -------------- | --------- |
| `src/features/cowrite/types.ts`        | 数据模型定义   | ✅        |
| `src/features/cowrite/api.ts`          | Tauri 命令封装 | 需更新 🆕 |
| `src/features/cowrite/coWriteUtils.ts` | 工具函数       | 需更新 🆕 |
| `src/components/CoWritePage.tsx`       | 共笔主页面     | 需更新 🆕 |
| `src-tauri/src/services/cowrite.rs`    | Rust 后端存储  | 需更新 🆕 |

### 修改（已完成）

| 文件                            | 改动                  | 状态      |
| ------------------------------- | --------------------- | --------- |
| `src-tauri/src/services/mod.rs` | 加 `pub mod cowrite;` | ✅        |
| `src-tauri/src/lib.rs`          | Tauri 命令注册        | 需更新 🆕 |

---

## 新增 Tauri 命令

在原有 7 个命令基础上新增 1 个：

```
cowrite_undo_last(sessionId) → CoWriteSession
```

## 接口约定

### 数据模型

```typescript
type CoWriteIdentity = "continuator" | "questioner" | "opposer" | "poetic" | "custom";

interface AuthorBlock {
  author: "human" | "ai";
  text: string;
  timestamp: number;
}

interface CoWriteSession {
  id: string;
  noteId: string;
  identity: CoWriteIdentity;
  customPrompt?: string;
  blocks: AuthorBlock[];
  createdAt: string;
  updatedAt: string;
}

interface CoWriteStats {
  humanBlocks: number;
  aiBlocks: number;
  humanChars: number;
  aiChars: number;
  totalTurns: number;
  durationMs: number;
  lastActiveAt: number;
}
```

### 组件接口

```typescript
interface CoWritePageProps {
  providers: ProviderConfig[];
  noteId: string;
  noteContent: string;
}
```

---

## 验收标准

- [ ] 用户可以从侧边栏进入"共笔"页面
- [ ] 用户可以创建新共笔会话，选择 AI 身份（5 种可选）
- [ ] 用户可以写一段文字并提交，显示为 human 样式
- [ ] 用户点"轮到 AI"后，AI 内容以不同颜色显示
- [ ] 会话数据关闭后重新打开仍然存在
- [ ] 用户可以删除会话
- [ ] 用户可以选中段落并合并到原笔记
- [ ] 页面样式和现有应用风格一致（bamboo 绿 + paper 色系）
- [ ] 🆕 统计面板可折叠展开，实时显示 human/AI 字数占比
- [ ] 🆕 撤回按钮可撤回最近一步（human 或 AI），带确认提示
- [ ] 🆕 一键续写模式开启后 human 提交自动触发 AI 续写
