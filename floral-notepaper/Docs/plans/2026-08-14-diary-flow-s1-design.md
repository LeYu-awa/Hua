# 设计 · 写作日记流 S1（对话沉淀日记闭环）

日期：2026-08-14
项目：floral-notepaper
状态：设计已确认，待实施
关联文档：`2026-08-09-product-strategy.md`（留存主线 = 写作日记流）、`2026-08-09-live2d-writing-coach-design.md`

## 1. 背景与目标

产品战略已确认**写作日记流**为留存主线：用户每天与角色对话，内容自动沉淀为日记，角色持续"记得"。S1 是这条主线的第一块闭环：**对话 → 角色提议 → 用户确认 → 沉淀日记 → 日记页浏览/编辑/删除 → 跳回来源对话**。

### 1.1 需求决策（已与用户确认）

| 决策点       | 结论                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| 沉淀触发方式 | **半自动**：角色提议 + 用户确认（不产生垃圾条目，符合"可忽略、不打扰"原则） |
| 日记入口     | **侧边栏新入口 + 独立日记页**（按日分组时间线）                             |
| 本轮范围     | **S1 完整闭环**（不含 S2 记忆引用 / S3 周复盘 / S4 月回忆录）               |

### 1.2 非目标

- 不做对话事件入 `event_store` 的 Rust Agent 驱动链路（方案 B，留待后续）。
- 不做记忆引用（S2）、周复盘（S3）、月度回忆录（S4）。
- 不改动 `diary` Rust 服务与 Tauri 命令（已完备）。

## 2. 方案选型

**方案 A（选定）：前端主导的轻量闭环。**

- 全部落在前端现有体系内：`SidebarChat` 检测对话状态 → 提议卡 → 确认 → 调 `diary_create` → 新日记页。
- Rust 端零改动（`DiaryStore` + `diary_create/get/list/update/delete` 命令已就绪，见 `src-tauri/src/services/diary.rs`）。
- 日记条目天然带 `conversationId` / `sourceMessageIds`，为 S2 记忆引用预留接口。
- 风险控制：提议逻辑抽为独立 hook / 组件，避免继续膨胀 77KB 的 `SidebarChat.tsx`。

备选方案：

- 方案 B（Rust Agent 驱动）：对话事件入 event_store → orchestrator 检测 → 提议推送。架构对齐战略但本轮工作量大、性价比低。
- 方案 C（手动版）：只做日记页 + 手动"存为日记"按钮。最快但无陪伴感，日钩子不成立。

## 3. 架构与组件

### 3.1 新增文件

| 文件                                         | 职责                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/features/diary/diaryEvents.ts`          | 事件总线（复用 `src/features/canvas/canvasCommands.ts` 的 on/emit 范式）：`dispatchOpenChatTask(taskId)` / `onOpenChatTask`、`dispatchDiaryCreated()` / `onDiaryCreated` |
| `src/features/diary/useDiarySuggestion.ts`   | 提议检测 hook：监听当前对话任务，判定触发/冷却/忽略，管理提议状态                                                                                                        |
| `src/features/diary/DiarySuggestionCard.tsx` | 提议卡片：花灵口吻文案 + [存入日记] [稍后再说] [今天不提醒] + 整理中/成功状态                                                                                            |
| `src/features/diary/composeDiaryContent.ts`  | 内容生成：有 LLM 供应商 → 整理成文；无/失败 → 原文摘录回退                                                                                                               |
| `src/features/diary/DiaryPage.tsx`           | 日记时间线页（见 §5）                                                                                                                                                    |

### 3.2 修改文件

| 文件                                       | 改动                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `src/components/AppSidebar.tsx`            | `AppView` 增加 `"diary"` + 图标入口                                                           |
| `src/app/routeViews.tsx`                   | `sidebarView === "diary"` → `<DiaryPage />`                                                   |
| `src/features/sidebarChat/SidebarChat.tsx` | 消息流末尾渲染提议卡；监听 `onOpenChatTask` 激活对应任务；沉淀成功触发 `dispatchDiaryCreated` |
| `src/features/diary/api.ts`                | 零改动（CRUD 已完备）                                                                         |

## 4. 数据流（完整闭环）

```
用户在 SidebarChat 与角色对话
 → useDiarySuggestion 检测（触发条件见 §4.1）
 → DiarySuggestionCard 出现在消息流末尾（独立卡片，不污染对话历史）
 → 用户点 [存入日记]
 → composeDiaryContent：
     有 LLM 供应商 → 用 LLM 把最近对话整理成 Markdown 日记
     无供应商 / 调用失败 → 原文摘录回退（用户消息 + 角色回复按时间拼接，首条用户消息作标题）
 → diary_create({ title, content, entryDate: 今天, conversationId: taskId,
                  sourceMessageIds, mood/tags 可选 })
 → 卡片转成功态"已记下今天的记录"
 → 日记页点 [查看来源对话] → dispatchOpenChatTask(taskId) → SidebarChat 激活该任务
```

### 4.1 提议触发与防打扰规则

- 当前活跃任务新增 assistant 消息完成后检测：
  - 本任务用户消息 ≥ 2 条；
  - 今日（entryDate == 今天）该 `conversationId` 尚无日记条目；
  - 距上次提议（localStorage 记录）> 30 分钟；
  - 未被"今天不提醒"标记。
- 同任务每天只提议一次（沉淀成功后不再出现）。
- 全局冷却 30 分钟；当天可一键"今天不提醒"。
- 提议只出现在当前活跃任务，切换任务即消失。
- 对话不足 2 条不触发。

## 5. 日记页 UI（DiaryPage）

```
顶部统计条：今日 N 篇 · 本周 N 篇 · 累计 N 篇 · 累计 X 字
时间线：按 entryDate 倒序分组（今天 / 昨天 / 更早）
  ├─ 每条卡片：标题 · 预览(截断) · 时间 · 字数 · mood/tags 徽章
  ├─ 点击卡片 → 展开详情（Markdown 渲染，复用 MarkdownPreview）
  └─ 操作按钮：[编辑] [删除] [查看来源对话]
编辑模式：标题输入 + 内容 textarea + [保存](diary_update) [取消]
空状态："今天还没记录，去和花灵聊聊今天的想法吧" + [去对话]按钮(dispatchOpenChatTask)
```

- 复用现有深色主题 + Tailwind 体系；图标风格与 AppSidebar 其他项统一；不引第三方组件。

## 6. 错误处理

| 场景                              | 行为                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| 无 LLM 供应商                     | `composeDiaryContent` 直接走原文摘录，提议卡提示"将摘录对话内容" |
| LLM 调用失败/超时                 | 静默回退原文摘录，不阻塞沉淀                                     |
| `diary_create/update/delete` 失败 | toast 报错 + 保留用户输入，可重试                                |
| 对话任务被切换/清空               | 提议卡随任务切换消失，不残留状态                                 |
| 对话内容全为空                    | 不触发提议（触发条件已含"用户消息 ≥2 条"）                       |

## 7. 测试

| 文件                          | 覆盖                                                      |
| ----------------------------- | --------------------------------------------------------- |
| `composeDiaryContent.test.ts` | LLM prompt 组装、摘录回退边界（空对话/超长截断）          |
| `useDiarySuggestion.test.ts`  | 触发条件矩阵（消息数/当日已沉淀/冷却/忽略开关）、状态迁移 |
| `DiaryPage.test.tsx`          | 时间线渲染、编辑保存、删除确认、跳转事件派发              |
| `SidebarChat` 集成测试        | 提议卡出现条件与确认后调用 `diary_create`                 |

## 8. 后续（本轮不做）

- S2：角色主动问候 + 记忆引用（profile_store + embedding 检索注入对话，日记条目可被索引）。
- S3：周复盘报告（review.report 接 UI + 语音播报）。
- S4：月度回忆录（组卡成文复用）。
