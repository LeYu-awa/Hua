# 设计 · 画布组卡成文闭环（可产出 Agent）

日期：2026-08-14
项目：floral-notepaper
状态：设计已确认，待实施
关联文档：`2026-08-09-canvas-product-design.md`（画布=灵感花园+文章产出）、`2026-08-09-rust-orchestrator-agent-design.md`（Rust 编排架构）、`2026-08-14-diary-flow-s1-design.md`（日记闭环，共用记忆层）

## 1. 背景与目标

### 1.1 产品定位（已与用户确认）

**画布 = "从想法到作品"的中转站（灵感花园 + 文章产出）**：

```
散想法 → 画布组织（摊开/连接/补空白）→ 一键成文（框选卡片 → Agent 整理 → 预览确认 → 落成笔记）
  → 沉淀进笔记库（可被 RAG 再次想起）→ 下次创作更聪明
```

与日记流主线共存：日记是每日沉淀，画布是结构化产出，两者共用 RAG 记忆层。

### 1.2 现状诊断

- Rust 任务引擎（Planner/Executor/Observer/状态机/确认恢复/输出总线/RAG 注入）Phase A-F 已全部落地。
- **`canvas.writeup` 技能残缺**：读全画布 → LLM 生成 → note.create 但 **content 为空**（LLM 输出未流入落盘）；无选中卡片、无 RAG 注入、无产出预览。
- 前端任务确认是"通用 JSON 确认框"，看不到生成内容，违反"产出先预览后落盘"铁律。

### 1.3 本轮范围（已确认）

**组卡成文完整闭环**（方案 1：复用任务引擎 + 最小扩展）：

- 框选卡片 → "整理成文" → 类型选择（大纲/初稿/总结/设定集）+ 可选意图
- Rust 任务：canvas.read(选中) → RAG 检索注入 → LLM 按类型生成 → 预览确认（可编辑）→ 落成新笔记
- 落盘成功 → 横幅 + 打开笔记

不含：角色主动提议（P0-3）、画布分组/泳道（P0-1）、已成文留痕 drafted_by（P1，降级为落盘横幅）。

## 2. 目标协议（前端 → Rust）

```
goal = "整理成文：<类型>；意图：<可选描述>；卡片：<id1>,<id2>,…"
类型 ∈ {大纲, 初稿, 总结, 设定集}
```

新解析函数 `parse_writeup_goal(goal) -> WriteupRequest { node_ids, kind, intent }`：
- 解析失败（无"卡片："段）→ node_ids 为空 → 回退读全画布（兼容旧入口）。
- 类型缺省 → 初稿。

## 3. Rust 侧改动（4 处）

### 3.1 canvas.writeup plan 重写

```
w1: canvas.read   { canvasId: "first", nodeIds: [ids] }   ← execute_tool 按 nodeIds 过滤节点
w2: llm           { retrieve: "<卡片文本摘要/意图>",      ← RAG 记忆注入（引擎已支持 input.retrieve）
                    prompt: "<类型模板>：\n{previousOutput}" }
w3: note.create   (required_confirm) { title, content: "{previousOutput}", category: "AI 生成" }
```

类型 → 提示词模板（四套）：
- 大纲：结构化要点提纲（层级标题）
- 初稿：成段成文的完整文章
- 总结：凝练概括
- 设定集：条目化设定整理（人物/世界观/规则）

### 3.2 canvas.read 支持 nodeIds 过滤

`execute_tool` 的 `canvas.read` 分支：`input.nodeIds` 存在时只返回对应节点（未传则读全部，兼容旧调用）。

### 3.3 工具输入模板解析（修复空内容 bug）

`execute_tool` 开头：解析入参字符串值中的 `{previousOutput}` → 上游步骤输出文本（与 execute_llm 同款逻辑）。**修复现有 writeup 落盘空笔记问题**。

### 3.4 agent_task_confirm 支持 payload 覆盖

签名增加可选 `payload: Option<Value>`：确认 note.create 步骤时携带 `{ title?, content? }` → 覆盖该步骤 input 后继续执行。前端预览面板"编辑后落盘"依赖此能力。

### 3.5 Rust 测试

- `parse_writeup_goal` 解析矩阵（类型/意图/卡片；缺失容错）
- writeup plan 断言（nodeIds / retrieve / content 模板 / required_confirm）
- note.create `{previousOutput}` 模板解析
- confirm payload 覆盖落盘内容

## 4. 前端改动（4 处）

### 4.1 画布工具栏"整理成文"按钮

- 与"AI 扩写"同工具栏区域；`selectedNodeIds.length >= 2` 可用，否则置灰（提示"框选 2 张以上卡片"）。
- 点击 → 打开 WriteupDialog。

### 4.2 WriteupDialog（类型选择弹窗）

- 四个产出类型卡片（大纲/初稿/总结/设定集）
- 可选意图输入框
- 显示"将整理 N 张卡片"
- [开始整理] → `createAndRunAgentTask(goal)`（goal 按 §2 编码）→ 任务进度面板自动出现

### 4.3 TaskProgressPanel 产出预览确认

`confirmStep.tool === "note.create"` 且上游存在 llm 步骤（output.text）时，用产出预览替换通用确认框：

- 标题输入（预填）/ 正文 textarea（预填生成文章，可编辑）
- [确认落盘] → `confirmAgentTask(taskId, stepId, true, { title, content })`
- [重新生成]：创建新任务（换类型/意图）——本轮做简单版
- [取消]
- 其他工具确认（note.export 等）保留通用确认框

### 4.4 落盘成功反馈

- 任务 Done 且 goal 为整理成文 → 横幅"已生成笔记《标题》" + [打开笔记] [关闭]
- 新增 `dispatchOpenNote(noteId)` 事件（复用 diary 事件总线模式）→ AppShell 监听：切"笔记"视图 + 打开该笔记
- noteId 从 note.create 步骤的 output 解析

### 4.5 前端测试

- WriteupDialog：类型/意图/goal 编码
- TaskProgressPanel 预览：llm 输出渲染、编辑、payload 携带
- CanvasPage 按钮置灰逻辑

## 5. 验收口径

- 框选 ≥2 卡片 → 类型选择 → 任务进度 → 预览（可编辑）→ 确认 → 新笔记落盘成功 → 横幅可打开笔记
- 无 LLM 供应商时：任务明确报错提示配置（现有机制）
- 全量测试通过、tsc/build/lint/fmt 干净
