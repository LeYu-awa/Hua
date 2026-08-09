# 花箴画布功能完整设计与实现方案（产品 × AI Agent 双视角）

> 日期：2026-08-09 ｜ 关联：`Docs/plans/2026-08-09-rust-orchestrator-agent-design.md`、`.trae/skills/floral-agent-mcp-dev/SKILL.md`
> 目标：从产品与 AI Agent 双视角给出画布功能的完整设计，所有方案对齐现有代码结构，可直接排期落地。

---

## 0. 现状基线（先盘家底，保证"可落地"）

所有设计均基于以下已落地代码，新增能力是对它们的扩展而非推倒重来。

### 0.1 数据模型（已具备）

`src-tauri/src/services/canvas.rs`：

| 结构 | 字段 | 说明 |
|---|---|---|
| `CanvasDocument` | `id` / `noteId` / `coWriteSessionId` / `nodes` / `edges` | `coWriteSessionId` 已为协作预留；`noteId` 建立画布↔笔记关联 |
| `CanvasNode` | `id` / `type`(text·card·resource·task) / `x` / `y` / `width` / `height` / `text` / `source?` | `source="agent"` 标记 AI 产出，前端 IPC 契约已用显式 `rename` 对齐（`node_type` ↔ `type`） |
| `CanvasEdge` | `id` / `fromNodeId` / `toNodeId` / `style`(solid·dashed) | 虚线=隐含连接建议 |

存储：`CanvasStore`（JSON 文件落盘，`base_dir/canvas/*.json`），IPC：`canvas_save/get/delete/list`。

### 0.2 Agent 触点（已具备）

| 层 | 能力 | 位置 |
|---|---|---|
| 前端分析器 | 隐含连接建议 / 语义空白区 / 共识分歧（规则引擎 + embedding + LLM） | `src/features/agent/connectionRecommendations.ts`、`semanticGap.ts`、`consensus.ts`，封装于 `useCanvasAgent.ts` |
| 前端上下文 | 画布节点摘要注入共笔 Prompt + 被引用节点溯源 | `src/features/agent/canvasContext.ts` |
| Rust 技能 | `canvas.writeup`（画布成文）、`canvas.organize`（网格排版） | `orchestrator.rs` 的 `SKILLS` 注册表 |
| MCP 工具 | `canvas_read` / `canvas_node_create`（source=agent） | `src-tauri/src/services/agent/mcp_server.rs` |
| 输出总线 | `agent.live2d` / `agent.canvas` / `agent.speech` / `agent.ui` | `output_bus.rs` |
| 基础设施 | OpenAI 兼容 LLM、Embedding(bge-m3/Qwen3)、sqlite-vec RAG、SearXNG、写操作确认机制（`required_confirm` + `agent_task_confirm`） | `services/agent/*` |

### 0.3 差距清单（GAP）

| 维度 | 现状 | 目标 | 缺口 |
|---|---|---|---|
| 基础绘图 | 节点增删/拖拽/连线/保存 | 全键盘化、缩放平移、撤销重做 | 大 |
| 图层管理 | 无 | 分组/层级/折叠 | 大 |
| 协作编辑 | 仅字段预留 | 实时共笔 + Agent 调度 | 最大 |
| 导出分享 | 仅 Agent 落 Markdown | 图片/PDF/Excel 模板 + 分享 | 中 |
| Agent 深度 | 3 个前端分析器 + 2 个 Rust 技能 | 生成/布局/上下文/多模态/调度五维 | 中 |

---

## 1. 产品视角

### 1.1 核心用户价值与产品定位

**目标用户**：个人知识工作者与创作者——用花箴做笔记沉淀、Live2D 陪伴表达、把碎片想法整理成结构。

**产品定位（一句话）**：
> 花箴画布是"把想法摊开、连起来、长成作品"的**结构化思维工作台**——个人笔记的连接器、AI Agent 的协作面板、Live2D 的表达舞台。

**核心用户价值（优先级排序）**：

1. **可视化整理**：把零散笔记/聊天碎片落到画布上，拖拽即可建立关系（隐性认知外显）。
2. **AI 减负**：Agent 自动连线、补空白、排版、成文——用户只做决策不搬砖。
3. **沉淀闭环**：画布 → 笔记（`canvas.writeup`）→ RAG 记忆 → 下次创作更聪明。
4. **表达陪伴**：画布成文后由 Live2D 角色朗读/演绎，形成"创作-表达"的情感闭环（差异化，市面上没有）。

### 1.2 功能矩阵（P0/P1/P2 分级）

#### 基础绘图（P0，1 期）
- 节点：四种类型（text/card/resource/task，已有）+ 富文本编辑、Markdown 渲染、颜色/图标标记
- 连线：拖拽连线（solid）、自动连线建议（dashed 预览，已有前端分析器）
- 视图：画布缩放（滚轮/快捷键）、平移、缩略图定位、键盘快捷操作（新建/删除/复制/全选）
- 撤销/重做：操作栈（至少 50 步），覆盖节点/边/布局/Agent 改动
- 自动保存 + 手动保存双轨（已有 `handleSave`，补 debounce 自动保存）

#### 图层与结构管理（P1，2 期）
- 分组：框选建组、组内折叠、组标题
- 层级：z 序调整（置顶/置底/上移/下移）
- 结构辅助：网格吸附、对齐线、等距分布（为 `canvas.organize` 的"语义排版"提供前置）
- 模板：思维导图/四象限/时间线/流程图起步模板，Agent 一键生成

#### 协作编辑（P1-P2，3 期起）
- 单机共笔：`coWriteSessionId` 关联同一画布多视图（聊天侧沉淀 + 画布侧浏览，已有雏形）
- 实时同步：局域网 P2P / 自托管同步（见 3.1 技术约束）
- 并发控制：CRDT 或基于事务的 last-write-wins + 冲突标记
- 权限：个人默认全权，分享视图只读/可编辑

#### 导出分享（P1，2 期）
- 导出：Markdown（已有 `note.export`）、PNG/SVG 图片、PDF（纸张模板保真，见 `floral-export-fidelity` skill）、Excel 表格（任务/资源节点结构化导出）
- 分享：导出文件落地本地导出目录 + 生成分享摘要卡片

#### Agent 增强（贯穿所有阶段，见第 2 章）

### 1.3 用户路径与交互逻辑

**主路径（创建 → 创作 → 沉淀）**：

```
新建画布（模板/空白） → 快速落点（双击/拖入笔记/聊天沉淀）
  → 结构调整（拖拽连线/分组/排版/Agent 一键整理）
  → Agent 深化（生成/总结/成文，写操作需确认）
  → 沉淀（canvas.writeup → 笔记 → RAG 索引）
  → 表达（Live2D 演绎成文）→ 导出分享
```

**关键交互设计原则**（对齐 `useCanvasAgent.ts` 头部注释，这套原则已是产品红线）：

- **可观察**：Agent 建议以覆盖层/虚线/高亮呈现，绝不静默改动。
- **可忽略**：每类建议可 dismiss，忽略后不再打扰（`dismissedPairs` 已实现）。
- **可追溯**：AI 产出节点带 `source="agent"`，可回看是"哪次任务/哪段输入"生成的。
- **可降级**：无 embedding/LLM 或失败时，全部能力静默为空，画布照常可用。
- **写操作必确认**：所有会改动画布/笔记/联网的 Agent 步骤走 `AwaitingConfirm`，用户一键确认/拒绝。

### 1.4 迭代 Roadmap

| 阶段 | 范围 | 退出标准 |
|---|---|---|
| **P0（1 期）** 画布 0.9 | 基础绘图完善（缩放/撤销/自动保存/键盘）+ 现有 Agent 分析器体验打磨 | 用户 10 分钟内能完成"建画布→打节点→Agent 排版→成文"闭环 |
| **P1（2 期）** 结构 + 导出 | 图层分组/模板 + Markdown/PNG/PDF/Excel 导出 | 导出保真验收通过；模板使用率 > 30% |
| **P2（3 期）** 协作 MVP | 共笔会话 + 局域网实时同步 + Agent 分工调度 | 双端同步延迟 < 500ms；协作场景渗透率见 §1.5 |
| **P3（4 期）** 多模态 + 智能 | 图片/手绘节点、语音命令、语义布局、协作智能体（调度/共识辅助） | Agent 生成内容采纳率 > 60% |

### 1.5 量化成功指标（北极星 + 分模块）

**北极星**：周活跃创作闭环数（完成"画布→成文→笔记"全链路的周用户数）。

| 模块 | 指标 | 目标（上线 90 天） | 埋点方式 |
|---|---|---|---|
| 留存 | 画布用户 7 日留存 / 30 日留存 | ≥ 35% / ≥ 20% | `agent_record_event` 事件流扩展 `canvas.session` |
| 功能使用率 | 画布月活占全应用 MAU | ≥ 50% | 前端进入画布计数 |
| 基础绘图 | 人均周建节点数 / 成画布数 | ≥ 15 节点 / ≥ 2 画布 | CanvasPage 操作埋点 |
| Agent 采纳 | 建议采纳率（连接/空白区/排版/成文） | ≥ 60% | dismiss vs apply 事件比 |
| 导出 | 周导出次数 / 导出保真满意度 | ≥ 30 次/周 / NPS ≥ 4 | export 事件 + 问卷 |
| 协作渗透率 | 使用协作会话的活跃用户占比 | 30 日 ≥ 20% | `coWriteSessionId` 活跃数 |
| 性能 | 千节点画布交互帧率 / 保存延迟 | ≥ 45fps / < 300ms | 前端 performance API + 埋点 |

---

## 2. AI Agent 视角

### 2.1 Agent 融入画布生态（五大能力）

#### 2.1.1 智能内容生成
- **节点级**：选中空白/半成品节点 → Agent 扩写、润色、结构化（复用 `llm.generate` 工具）。
- **画布级**：`canvas.writeup` 已有——画布 → 成文笔记（P0 已落地）。
- **反哺**：笔记/RAG 检索结果 → 生成"建议补充节点"（`rag.retrieve` → 节点草案，dashed 预览）。

#### 2.1.2 自动化布局优化
- **已有**：`canvas.organize` 网格排版（P0 已落地，`orchestrator.rs`）。
- **升级**：
  - **语义排版**：用 embedding 计算节点相似度 → 相近主题聚类布局（力导向/按簇分块）。
  - **关系布线**：基于 `findImplicitConnections` 建议，自动补 dashed 连线并走确认。
  - **关注点**：布局改动全部可撤销（进操作栈），避免"整理一次乱一次"。

#### 2.1.3 上下文理解辅助创作
- **已有**：`canvasContext.ts` 把画布节点摘要注入共笔 Prompt，并返回被引用节点（UI 可展示溯源）。
- **升级**：
  - **语义空白区**（已有 `semanticGap`）：分析器发现"节点 A 与 B 之间缺什么"，生成补白建议节点。
  - **会话记忆**：画布节点文本增量索引进 RAG（sqlite-vec），后续提问/创作可跨画布召回。

#### 2.1.4 多模态交互支持
- **Live2D 表达**：`output_bus` 的 `agent.live2d` 通道——成文/总结完成后由角色"说话"演绎。
- **语音**：`agent.speech` 通道，画布指令/朗读节点。
- **图片/手绘**（P3）：节点支持贴图；手绘区域 → Agent 识别为节点结构（图转思维导图）。
- **输入方式**：语音命令（"把这两个节点连起来"）→ 走 orchestrator 技能匹配（复用 `match_skill` 关键词检测）。

#### 2.1.5 实时协作中的智能调度
- **分工建议**：共笔会话中，Agent 按节点归属/文本主题建议任务切分（谁负责哪块）。
- **共识/分歧检测**：已有 `detectConsensus`（前端分析器）——多人在同一主题下的观点分歧，Agent 汇总成"共识卡片"。
- **冲突仲裁**：两人同时改同一节点 → Agent 生成合并建议（diff 展示，走确认）。
- **节奏调度**：Agent 在讨论停滞时主动提示"是否要我先把已共识的部分沉淀成文"。

### 2.2 技术对接方案

#### 2.2.1 API 设计（三层，全部已就位/可扩展）

```
┌─ 前端（React） ──────────────┐   ┌─ Rust 后端 ────────────────────────────┐
│ CanvasPage                    │   │ orchestrator（SKILLS 技能注册表）        │
│ useCanvasAgent(前端分析器)     │   │   ├─ execute_tool（工具分发）            │
│ canvasContext(上下文注入)      │invoke│   ├─ note.export / canvas.organize…  │
│ invoke → agent_task_*         ├───→│   ├─ agent_task_confirm（确认）         │
│ listen ← agent.step/awaiting  │events│   └─ MCP server（--mcp，7 工具）      │
└───────────────────────────────┘   │   CanvasStore（save/get/delete/list）  │
                                    └───────────────────────────────────────┘
```

- **画布读**：`canvas_get/list`（现有 IPC）+ MCP `canvas_read`。
- **画布写**：普通编辑走 `canvas_save`；**Agent 写一律**走 orchestrator 步骤（`canvas.node.create` / `canvas.organize`）+ `required_confirm`，保证可审计。
- **事件**：`agent.step`（进度）、`agent.awaiting_confirm`（确认请求）、`agent.export`（前端接管模板导出）、`output_bus`（live2d/speech/ui）。

#### 2.2.2 数据流转逻辑（以"画布成文"为例，验证闭环）

```
用户输入目标 → agent_task_create_and_run（IPC）
  → TaskRunner.run → plan 展开（canvas.writeup：canvas.read → llm.generate → note.create）
  → canvas.read：CanvasStore.get → 节点文本
  → llm.generate：{previousOutput} 注入 + 可选 RAG retrieve（记忆注入）
  → note.create（AwaitingConfirm → agent_task_confirm）
  → emit agent.ui / agent.live2d（表达）
  → 新增笔记自动 ragIndex → 下次创作可召回
```

#### 2.2.3 模型能力集成

| 能力 | 模型/服务 | 接入点（已落地） |
|---|---|---|
| 文本生成/规划 | OpenAI 兼容（Ollama/vLLM/DeepSeek） | `HttpLlmProvider`、`plan_with_llm` |
| 语义检索 | bge-m3 / Qwen3-Embedding | `HttpEmbeddingProvider` + sqlite-vec `VectorStore` |
| 记忆 | 自拼 RAG（分块→嵌入→top-k→拼 context） | `rag.rs` |
| Web 事实 | 自托管 SearXNG | `web_search.rs` |
| 建议分析（连接/空白/共识） | 前端规则引擎 + LLM 兜底 | `connectionRecommendations/semanticGap/consensus` |

### 2.3 Agent 技能矩阵（映射到 `SKILLS` 注册表）

| 场景 | 技能（新增=🔧） | 依赖工具 | 阶段 |
|---|---|---|---|
| 画布成文 | `canvas.writeup`（已有） | canvas.read, llm.generate, note.create | P0 ✅ |
| 画布排版 | `canvas.organize`（已有，网格） | canvas.read, canvas.organize | P0 ✅ |
| 节点扩写/润色 | `canvas.node.enhance` 🔧 | canvas.read, llm.generate, canvas.save | P1 |
| 建议补充节点 | `canvas.gap.fill` 🔧 | rag.retrieve, canvas.node.create | P2 |
| 语义聚类排版 | `canvas.organize.semantic` 🔧 | embed, canvas.organize | P2 |
| 协作共识卡片 | `collab.consensus.card` 🔧 | consensus, canvas.node.create | P3 |
| 语音指令 | `canvas.voice.command` 🔧 | match_skill + speech 输入 | P3 |

> 新增技能严格走 `.trae/skills/floral-agent-mcp-dev/SKILL.md` 四步链路：注册表 → execute_tool 分支 → MCP `#[tool]`（如需对外）→ SKILLS 注册 + 测试。

---

## 3. 技术约束 / 合规 / 体验保障 / 测试验证

### 3.1 技术约束（必须遵守）

1. **Tauri v2 + WebView2**：画布渲染在 WebView 内，验证铁律见 `.trae/skills/floral-tauri-verify/SKILL.md`（禁止浏览器验证 UI）。
2. **双 Pixi 栈**：画布若引入图形加速需确认路由（MOC3 v4→官方栈，v5→legacy），画布本身用 DOM/SVG 优先，避免引入第二套 Pixi。
3. **本地优先**：当前画布为 JSON 文件存储；协作/大容量时评估迁移 SQLite（rusqlite 已引入）。单画布 ≤ 5000 节点前保持 JSON，减少迁移成本。
4. **数据规模**：个人笔记+画布节点，量级几十万向量封顶——保持 sqlite-vec，不上 Qdrant/Chroma。
5. **IPC 契约**：Rust `node_type` ↔ 前端 `type` 的显式 `rename` 模式必须延续，新增字段同样处理，契约有测试兜底。
6. **性能预算**：千节点画布交互 ≥ 45fps；Agent 全链路（工具调用+LLM）单步 ≤ 15s（超时降级）。

### 3.2 合规与隐私要求

1. **数据不出本机**（默认）：全部笔记/画布/向量本地存储；LLM 调用默认指向本地 Ollama；云端模型需用户显式在设置中配置且 UI 明示。
2. **AI 产出可溯源**：`source="agent"` 节点 + 任务日志（task_store 持久化），任何 AI 内容可追溯到任务与输入。
3. **内容合规**：web.search 结果与 AI 生成文本默认不做不可控外发；导出分享前提示"含 AI 生成内容"。
4. **确认红线**：所有写操作（建/改/删/导出/联网）必须用户确认，这是不可妥协的产品规则。

### 3.3 用户体验保障

1. **四原则**：可观察 / 可忽略 / 可追溯 / 可降级（§1.3，已实现于 `useCanvasAgent`）。
2. **撤销重做**：覆盖手工与 Agent 改动（Agent 排版/连线撤销一次到位）。
3. **错误降级**：Agent 步骤失败重试 1 次 → 置 Failed（orchestrator Observer），UI 提示"可重跑"而非崩溃。
4. **空态与引导**：新画布空态给模板入口 + "让 Agent 帮你搭"一键。
5. **性能提示**：千节点以上提示"建议拆分画布"，避免静默卡顿。

### 3.4 测试验证方案

| 层 | 用例 | 工具/位置 |
|---|---|---|
| Rust 契约 | 前端形状 JSON ↔ Rust 反序列化（`type`/`nodeType`） | `canvas.rs` 已有 `deserializes_frontend_shaped_payload` |
| Rust 存储 | 节点/边落盘-重读、`source=agent` 持久化 | `canvas.rs` 已有 2 个场景测试 |
| Rust 技能 | `canvas.writeup` / `canvas.organize` 端到端（含 AwaitingConfirm 恢复） | `orchestrator.rs` tests（23 个） |
| MCP 端到端 | `--mcp` 子进程全链路（initialize→tools/list→tools/call） | `tests/mcp_stdio.rs` |
| 前端 | `canvasContext`（注入+溯源）、`useCanvasAgent`（降级）、分析器 | `canvasContext.test.ts`、`connectionRecommendations` 等 |
| 导出保真 | Excel/PDF 模板读回断言（纸张/列宽/分页） | `floral-export-fidelity` skill 清单 |
| 指标 | 画布会话/采纳率/协作渗透埋点 | `agent_record_event` 扩展 |
| 回归 | 全量 `cargo test --lib`（已知唯一失败为环境性桌面透明测试）+ `npx tsc --noEmit` | CI/本地 |

---

## 4. 落地路径（文档 → 代码改动清单）

按依赖排序，可与 Roadmap 对应：

1. **P0 收尾（画布 0.9）** ✅ 已落地
   - `CanvasPage`：缩放平移（滚轮锚点缩放/空白拖拽平移/快捷键 Ctrl+=/-/0）、撤销重做栈（≥50 步，拖拽整段合并为一步，覆盖节点/边/布局/Agent 改动）、自动保存（debounce 800ms，dirty 标记仅用户改动后触发）
   - 操作埋点：建节点/连线/删除/保存/Agent 采纳/归档打标（对接 `agent_record_event`，缺 `conversationId/userId` 时静默降级）
   - 测试：`CanvasPage.test.tsx` 新增 P0 用例（缩放/撤销重做/自动保存/埋点），全量 vitest 304 通过；顺带补齐 `SidebarChat.test.tsx` 的 tts mock 新导出
2. **P1（结构 + 导出）**
   - 数据模型扩展：`CanvasDocument.group` / `CanvasNode.zIndex`（契约测试先行）
   - `canvas.node.enhance` 技能（四步链路）+ 前端"扩写"入口
   - 导出：`note.export` 接 PNG/PDF（前端接管）+ 保真校验单测
3. **P2（Agent 深化 + 协作 MVP）**
   - `canvas.gap.fill` / `canvas.organize.semantic`（embedding 聚类）
   - 画布节点增量 RAG 索引；`coWriteSessionId` 会话 + 局域网同步
4. **P3（多模态 + 智能调度）**
   - 图片节点、语音指令、共识卡片、Live2D 表达全链路

> 每个阶段验收都跑 §3.4 测试矩阵 + §1.5 指标；写操作改动一律回归确认机制。

---

## 附录 A：与既有文档/技能的衔接

- 架构底座：`Docs/plans/2026-08-09-rust-orchestrator-agent-design.md`（Phase A-F 已落地）
- 开发规范：`.trae/skills/floral-agent-mcp-dev/SKILL.md`（新增技能四步链路）
- 导出规范：`.trae/skills/floral-export-fidelity/SKILL.md`（纸张模板保真）
- 验证铁律：`.trae/skills/floral-tauri-verify/SKILL.md`
- UI 规范：`.trae/skills/floral-ui-refine/SKILL.md`
