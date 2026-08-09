# 方案 · Rust 主编排 Agent 架构（画布 + Live2D + 语音 + 组合/产出型工具）

日期：2026-08-09
项目：floral-notepaper
状态：架构已讨论确认，待实施
技术栈：Tauri v2（Rust 后端 + React TS 前端）+ LLM

## 1. 背景与目标

### 1.1 目标（用户愿景）

用户要的是**自主编排的 Agent**，不是 90 行对话循环：

- Agent 能自己规划（拆子任务）、自主执行（组合工具）、观察反馈（再规划），形成闭环。
- 大脑（编排核心）放 **Rust 后端**，复用现有 `services/agent/` 零件。
- Agent 的输入输出要联通 **画布 + Live2D + 语音** 三条通道。
- 工具要有**组合型**（多步流水线）与**产出型**（生成画布节点/文章/报告，而不只是读取）。

### 1.2 已确认的决策

| 决策 | 结论 |
|---|---|
| 编排大脑位置 | **Rust 主编排**（TS 只做 UI/流式渲染） |
| LLM 流式 | **B 混合模式**：任务/规划/工具/记忆在 Rust；LLM 对话与流式仍走前端 fetch（经 IPC 注册为 Rust 可用 provider） |
| 画布角色 | Agent 的产出空间 + 可视化工作台 + 输入源（见 §7） |
| 工具方向 | 组合型（流水线）+ 产出型（生成资产） |

### 1.3 非目标

- 不引入 ZaFlow / agent-framework-js 等外部 Agent 框架（已有循环 + 零件，避免重写）。
- 不改现有 SidebarChat 对话 UI 骨架；不替换 Live2D 渲染链路。
- 不接 VibeVoice-ASR（显存不足，见语音方案文档）。

## 2. 现状资产盘点

### 2.1 TS 前端体系（对话侧）

- `SidebarChat`：对话 + `requestModelAgent`（流式 + tools + 回退）+ `agentLoop`（function-calling 循环，4 轮上限、危险确认）。
- `assistantTools.ts`：9 个工具（note.list/read/search/create/update/moveCategory、web.search、openUrl、copyText）+ 写回审查。
- `agentOrchestrator.ts` + `signalQueue`：写作状态 → 情绪信号（焦虑关怀）。

### 2.2 Rust 后端体系（`services/agent/`，零件已建但未成编排）

- `llm_orchestrator.rs`：模板 → 提示词 → 结构化洞察；primary/fallback、限流、敏感过滤、成本统计。**无任务、无循环、无工具。**
- `insight_router.rs`：通道（UiRealtime / Live2DSignal / ReplayLibrary / ReviewReport）+ 健康 + 分发日志。
- `live2d_signal_queue.rs`：Live2D 状态机 + 信号队列（priority + payload）。
- `embedding_service.rs`：确定性 embedding + 缓存 + 相似检索（记忆层）。
- `canvas_indexer.rs`：画布节点索引（text/keywords/relations/position），可查询。
- `profile_store.rs`：用户画像；`rule_engine.rs`：规则触发；`event_store.rs`：事件存储。
- `notes.rs` / `canvas.rs`：笔记与画布的**真实数据层**（工具执行天然在 Rust）。

### 2.3 画布能力

- `CanvasStore`（`services/canvas.rs`）：画布文档 = nodes（`type/x/y/text/source`）+ edges，可关联 note_id / co_write_session_id，JSON 持久化。
- 节点类型（前端 `features/canvas/types.ts`）：`text | card | resource | task`。
- `canvas_indexer`：节点可被 Agent 检索（keyword/type/bounds）。

### 2.4 核心短板（本方案要解决的）

1. **无编排层**：agentLoop 是"手"，没有"大脑"（无规划/任务/状态）。
2. **双体系割裂**：TS 对话循环与 Rust 洞察体系（llm_orchestrator/insight_router）互不相通。
3. **记忆闲置**：embedding/profile/canvas_indexer 未接进对话。
4. **无输出总线**：Live2D/画布/语音各自为政。
5. **无任务生命周期**：一次对话 = 一次循环，结束即忘。
6. **工具是薄壳**：9 个只读/副作用工具，无组合、无产出。

## 3. 总体架构

```
┌─────────────── 前端（React TS / WebView2） ───────────────┐
│  SidebarChat 对话/流式（LLM 请求代理）   画布 UI / Live2D / 语音 │
└──────────────┬───────────────────────────────────────────┘
               │ IPC（invoke / emit 事件）
┌──────────────▼───────────────────────────────────────────┐
│                 Rust 编排核心（大脑）                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐   │
│  │ Planner │→│Executor │→│Observer │ │ Memory(记忆)   │   │
│  │ 规划子任务│ │ 执行步骤 │ │ 反馈重规划│ │ embedding/   │   │
│  │         │ │ 调工具   │ │ 状态更新 │ │ profile/索引  │   │
│  └─────────┘ └─────────┘ └─────────┘ └──────────────┘   │
│              Task 状态机（task_store 持久化）              │
│  工具层：notes / canvas / web / generate（组合+产出）      │
│  输出总线：AgentOutput → Live2D信号/画布/语音/UI 事件        │
└──────────────┬───────────────────────────────────────────┘
               │ IPC 回调（llm_complete → 前端 fetch 流式）
┌──────────────▼───────────────────────────────────────────┐
│                 LLM 供应商（DeepSeek 等）                   │
└──────────────────────────────────────────────────────────┘
```

## 4. 任务协议与状态机

### 4.1 Task 对象（`services/agent/orchestrator.rs` 新增）

```rust
pub struct Task {
    task_id: String,
    goal: String,               // 用户目标（原始意图）
    plan: Vec<Step>,            // 规划结果
    status: TaskStatus,         // 状态机
    context: TaskContext,       // 记忆/检索注入的上下文
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    logs: Vec<StepLog>,         // 步骤执行记录（供 UI 展示进度）
}

pub struct Step {
    step_id: String,
    kind: StepKind,             // Tool / Llm / Confirm / Output
    tool: Option<ToolName>,     // 组合/产出型工具名
    input: Value,               // 工具入参（由规划填充）
    output: Option<Value>,      // 执行结果
    status: StepStatus,         // Pending / Running / Done / Failed / Cancelled
    required_confirm: bool,     // 危险步骤需用户确认
}

pub enum TaskStatus { Planned, Running, AwaitingConfirm, Done, Failed, Cancelled }
```

### 4.2 状态机

```
Created → Planned（规划完成）
Planned → Running（开始执行）
Running → AwaitingConfirm（遇到危险/产出步骤，等用户确认）
AwaitingConfirm → Running（确认）| Cancelled（拒绝）
Running → Done | Failed
Failed → Running（Observer 重规划降级）| Failed（无法恢复）
```

### 4.3 任务持久化

新增 `task_store`（复用 `event_store` 的 SQLite/JSON 模式），支持任务恢复、历史查看。

## 5. 编排核心设计

### 5.1 Planner（规划）

- **主路径（LLM 规划）**：新增 `llm_orchestrator` 模板 `scene: "plan"`，输入 = goal + 可用工具清单 + 记忆摘要，输出 = `Vec<Step>`（JSON）。
- **兜底（规则规划）**：笔记/检索类目标走固定流水线（search → read → 汇总），无 LLM 也可跑（确定性、可测）。
- 规划结果先落 `Task.plan`，TS 侧展示计划并允许用户调整/确认后再执行（可选，默认自动执行只读步骤）。

### 5.2 Executor（执行）

- 执行 `Step`，按 `StepKind` 分发：
  - `Tool` → 调 Rust 工具函数（notes/canvas/web/generate）。
  - `Llm` → 通过混合模式的 provider 回调前端 fetch 流式（§10）。
  - `Confirm` → emit `agent.awaiting_confirm` → 前端弹确认 → invoke 回执。
  - `Output` → 走输出总线（§9）。
- 每步结果写 `StepLog`，emit `agent.step` 事件 → 前端展示进度 + Live2D 状态。

### 5.3 Observer（观察与再规划）

- 监听 `event_store` / 工具结果异常 / 用户中断。
- 规则（复用 `rule_engine`）：失败重试 1 次 → 降级简化 → 交给用户。
- 不引入自主无限循环：默认单轮规划执行，失败才触发再规划。

### 5.4 Memory（记忆）

- 对话/任务上下文注入：`embedding_service` 检索相关笔记/画布节点 + `profile_store` 用户偏好。
- 工具结果回写索引（`canvas_indexer` / 新 `note_indexer`），实现"写过就能被想起"。

## 6. 画布的角色定位（本次重点确认）

画布是 Agent 的**空间化工作台**，三种身份：

### 6.1 产出空间（Agent 把结果"放"到画布）

产出型工具落点之一：

| 场景 | 落成节点 |
|---|---|
| 文章大纲 / 灵感梳理 | `card`（想法卡，text=大纲，source=task_id） |
| 待办/下一步动作 | `task` 节点 |
| 检索到的相关笔记/资源 | `resource` 节点 + `edge` 关联 |
| Agent 计划的可视化 | 步骤节点 + 数据流边（text=step 摘要） |

### 6.2 输入源（Agent 从画布"读"）

- `canvas_indexer` 检索当前画布：用户画布上散落的想法 = Agent 可引用的素材。
- 组合工具 "canvas.read → 提炼 → 成文"：把画布草稿整理成文章（呼应写作导师方案）。

### 6.3 表演空间（Live2D 在画布上表达）

- Agent 信号 → `live2d_signal_queue` → Live2D 表情/动作/气泡。
- 气泡可指向画布（如"我刚在画布上加了三张灵感卡"）。
- 产出完成 → Live2D excited + 语音播报（TTS）。

### 6.4 边界

画布**不承担聊天**（聊天在 SidebarChat）；画布是"想法的陈列与组织"，聊天是"想法的生成与推演"。Agent 把聊天中产出的想法落成画布节点、把画布中的想法引入对话。

## 7. 组合型与产出型工具

### 7.1 组合型工具（Composite Tools）

把原子工具编排为流水线，两类来源：

- **模板流水线（Rust 模板机制）**：预定义工作流，如
  - `canvas_to_note`：canvas.read → llm.generate(大纲) → note.create
  - `note_summarize`：note.search → note.read → llm.generate(摘要) → note.create
  - `research_article`：web.search → note.read → llm.generate(初稿) → note.create
- **LLM 规划**：Planner 现场生成 `Vec<Step>`（可组合任意原子工具）。

组合工具 = 一个带名称/描述/参数 Schema 的"超级工具"，内部是 Steps 序列，可被单步执行也可被规划器直接选用。

### 7.2 产出型工具（Generative Tools）

| 工具 | 产出 |
|---|---|
| `canvas.node.create` | 画布节点（card/task/resource） |
| `canvas.doc.create` | 新画布文档 |
| `note.generate` | 新笔记（文章/大纲/摘要） |
| `review.report` | 复盘报告（复用 `agent_generate_review_report`） |
| `replay.marker` | 回放标记（复用已有） |
| `speech.speak` | 语音播报（TTS 通道） |

产出型工具一律**先预览/确认再落盘**（复用现有写回审查体验），避免 Agent 擅自生成资产。

### 7.3 工具注册表

新增 `services/agent/tools/`：每个工具实现统一 trait `AgentTool { name, description, parameters(JSON Schema), execute(input) -> Value }`。TS 侧工具定义（`agentTools.ts`）作为前端展示的镜像，真实执行全在 Rust。

## 8. 输出总线（AgentOutput）

```rust
pub enum AgentOutput {
    Live2D(Live2DSignal),        // 情绪/动作/气泡 → live2d_signal_queue
    Canvas(CanvasWrite),         // 画布节点/边写入
    Speech(SpeechRequest),       // 语音播报 → Tauri event → TS speakText
    Ui(UiEvent),                 // 面板进度/预览/确认
}
```

所有输出经统一总线分发，前端只消费事件，不感知 Rust 内部编排。

## 9. 混合 LLM 模式（决策 B）

- Rust 编排持有 `LlmProvider` trait（升级现有 `llm_orchestrator` 的接口）。
- 默认实现 `IpcLlmProvider`：Rust 调 `emit("llm.complete")` → 前端收到后走现有 `requestModelAgent`（流式 fetch + tools）→ 逐 token 展示 + invoke 回传聚合结果。
- 收益：流式体验零回归、前端 LLM 配置/回退逻辑复用；编排状态与记忆全在 Rust。
- 限制：LLM 调用变成"Rust → TS → 供应商"的桥接，属异步多跳；对非流式小任务可直接在 Rust 用 reqwest（二期，`HttpLlmProvider`）。

## 10. 模块与 IPC 接口清单

### 10.1 新增 Rust 模块

| 模块 | 职责 |
|---|---|
| `services/agent/orchestrator.rs` | Task/Step/状态机/Planner/Executor/Observer |
| `services/agent/task_store.rs` | 任务持久化 |
| `services/agent/tools/mod.rs` + `tools/*.rs` | AgentTool trait + 组合/产出型工具实现 |
| `services/agent/output_bus.rs` | AgentOutput 分发 |
| `services/agent/llm_provider.rs` | LlmProvider trait + HttpLlmProvider / HttpEmbeddingProvider |
| `services/agent/rag.rs` + `vector_store.rs` | 分块/嵌入/余弦 top-k 检索（sqlite-vec） |
| `services/agent/web_search.rs` | SearXNG JSON API 客户端 |
| `services/agent/mcp_server.rs` | MCP stdio 服务器（rmcp 官方 SDK，`--mcp` 模式） |

### 10.2 新增 IPC 命令

```text
agent_task_create(goal)                → Task（含 plan）
agent_task_list / agent_task_get(id)   → 任务查询
agent_task_confirm(id, step_id, ok)    → 确认/拒绝步骤
agent_task_cancel(id)
agent_task_step_result(id, step_id, output)  → 混合模式下 TS 回传 LLM/工具结果
agent_task_output_subscribe           → 事件流（或统一走 Tauri emit）
```

### 10.3 前端改动（最小）

- `SidebarChat`：对话入口改为"创建任务"（或保留纯对话模式，双轨）。
- 新增任务进度面板（消费 `agent.step` / `agent.awaiting_confirm` / `agent.output`）。
- LLM 桥：监听 `llm.complete` → 复用 `requestModelAgent` → 回传。
- Live2D / 画布 / 语音消费 AgentOutput 事件。

## 11. 实施阶段

| 阶段 | 内容 |
|---|---|
| Phase A | 任务协议 + `task_store` + 状态机骨架（Rust，纯数据层，可单测） ✅ |
| Phase B | Planner（规则兜底）+ Executor（note.search/read 原子工具）+ 进度事件 + 进度面板 → **最小闭环** ✅（orchestrator.rs，102 测试通过） |
| Phase C | 混合 LLM（IpcLlmProvider 桥）→ LLM 规划 + 生成类步骤流式 ✅（`HttpLlmProvider` + `plan_with_llm` + `parse_llm_plan` 容错，失败回退规则规划） |
| Phase D | 组合型工具（模板流水线）+ 产出型工具（canvas.node.create / note.generate）+ 预览确认 ✅（总结/画布成文/调研流水线；写操作 requiredConfirm → AwaitingConfirm 暂停；`agent_task_confirm` + 前端确认按钮闭环） |
| Phase E | 输出总线接通 Live2D 信号 + 语音播报 + 画布可视化 ✅（`output_bus`：`agent.live2d` / `agent.speech` / `agent.ui`，任务完成/失败自动播报） |
| Phase F | 记忆接入（embedding 检索 + profile 注入）、画布输入源、复盘/回放 ✅（llm 步骤 `input.retrieve` 触发 RAG 检索注入；canvas.read 输入源） |
| SearXNG | 自托管 Web 搜索落地 ✅（`web_search.rs` SearXNG JSON API + `web.search` 工具注册 + 单测） |
| MCP | 官方 Rust SDK（rmcp 0.16）stdio 服务器 ✅（`--mcp` 启动参数；7 个工具：note_search/read/create、canvas_read/node_create、web_search、llm_generate；5 单测 + 1 子进程端到端测试） |
| 产品技能 | 技能注册表落地 ✅（orchestrator `SKILLS` 静态注册表：canvas.writeup / note.summarize / research / **note.export** / **canvas.organize** / note.search；`agent_skill_list` IPC；`note.export` 落 Markdown + emit `agent.export` 事件、`canvas.organize` 网格排版；resume 上下文重建修复） |

> 产品技能与工具同源：`SKILLS`（目标关键词命中 + 流水线展开）→ 工具注册表（LLM 规划器选择）→ `#[tool]`（MCP 暴露）。新增技能的四步链路见 `.trae/skills/floral-agent-mcp-dev/SKILL.md`。开发协作 SKILL 沉淀于 `.trae/skills/`（tauri-verify / export-fidelity / agent-mcp-dev / ui-refine）。

> 混合 LLM 桥：Phase C 原计划的 IpcLlmProvider（Rust emit → TS 流式 → 回传）因前端已有完整 function-calling 循环（`requestModelAgent`/`agentLoop`，4 轮上限 + 危险工具确认），Rust 端直接采用 OpenAI 兼容 HTTP（`HttpLlmProvider`），省略双向桥。
> MCP 工具协议化：工具以纯函数暴露于 orchestrator（工具注册表 `tool_registry_json`），再包装 rmcp 官方 SDK 为 MCP server 工具。落地细节见 `services/agent/mcp_server.rs`：`floral-notepaper --mcp` 检测到参数后**跳过 Tauri 初始化**（`lib.rs run()` 短路），直接以 stdio 传输运行 `FloralMcp` 服务器；工具入参用 `#[tool]` 宏按字段生成 JSON Schema；`#[tool_handler]` 声明 tools 能力；数据目录走 `default_store()`（支持 `FLORAL_NOTEPAPER_DATA_DIR` 覆盖，便于隔离测试）。任何 MCP 客户端（Claude Desktop、Cursor、Cline 等）配置 `command: floral-notepaper, args: ["--mcp"]` 即可接入。

## 12. 风险与注意事项

1. **编排边界**：第一版默认"单轮规划 + 执行"，失败才再规划，避免自主无限循环与成本失控。
2. **异步桥接**：混合模式下 LLM 走 Rust→TS 桥，需处理超时/断开/重复回传。
3. **确认机制**：产出型与危险工具一律预览确认，不擅自落盘（沿用现有写回审查体验）。
4. **状态一致性**：任务状态以 Rust 为准，TS 只做镜像展示。
5. **性能**：编排调度本身不阻塞 UI；LLM 流式仍在 TS，Rust 只做轻量调度。
6. **组合工具的可测试性**：模板流水线做成纯数据（Steps 序列），可单测。
