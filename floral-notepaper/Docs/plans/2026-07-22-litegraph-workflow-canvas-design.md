# LiteGraph 工作流画布迁移设计

日期：2026-07-22
项目：floral-notepaper
状态：已确认，进入实施

## 背景

当前项目同时存在两套画布实现：

- `src/components/canvas/CanvasMode.tsx`：基于 tldraw，承载协作画布、文档拖入和 Agent 事件采集。
- `src/components/CanvasPage.tsx`：基于 SVG 自绘，承载旧版节点、连线、保存和 Agent 建议能力。

本次重构目标是统一为 ComfyUI 同源 LiteGraph 画布，并新增 Rust 工作流引擎，实现节点工作流的解析、校验、调度与 Agent 对接。

## 设计决策

1. 画布依赖使用 `@comfyorg/litegraph@0.17.2`，而非 `litegraph-esm`。
2. React 技术栈保留，禁止迁移到 ComfyUI 的 Vue 前端架构。
3. `CanvasMode` 与 `CanvasPage` 同步迁移，统一到一套 LiteGraph 工作流画布。
4. 第一版后置 Yjs/Supabase 实时协作，先完成本地创建、配置、保存、运行与 Agent 事件闭环。
5. 保留现有 `agent.rs` 核心逻辑，只添加工作流引擎桥接入口，不修改既有输入输出契约。

## 前端架构

前端拆为四层：

- `LiteGraphCanvas`：唯一直接持有 LiteGraph 实例、DOM canvas、节点注册、生命周期销毁与序列化逻辑。
- `NodeLibraryPanel`：负责节点分类、搜索与拖拽源数据，不直接操作 DOM canvas。
- `WorkflowInspectorPanel`：绑定当前选中 LiteGraph 节点，参数修改通过事件总线同步回画布实例。
- `WorkflowToolbar`：负责预览、保存、运行，运行前调用合法性校验。

React 只负责外层 UI、状态展示和跨模块同步；缩放、平移、连线、选择、右键菜单等画布原生交互交给 LiteGraph。

## 数据模型

新增前端工作流类型：

- `WorkflowDocument`：工作流持久化根对象。
- `WorkflowNode`：业务节点定义，包含 id、type、title、position、inputs、outputs、properties。
- `WorkflowLink`：节点连接定义，包含源节点/端口、目标节点/端口与端口类型。
- `WorkflowValidationResult`：前后端共用的校验结果形状。

现有 `CanvasDocument` 继续保留，提供双向迁移适配器：

- `CanvasDocument -> WorkflowDocument`：旧节点转为 LiteGraph 业务节点，旧 edge 转为 link。
- `WorkflowDocument -> CanvasDocument`：迁移期兼容旧保存接口、聊天沉淀和 Agent 旁路逻辑。

## 后端架构

新增 `src-tauri/src/services/workflow_engine` 模块：

- `types.rs`：定义 LiteGraph payload、Rust DAG、端口类型、执行队列与错误结构。
- `parser.rs`：将 LiteGraph JSON 反序列化为类型安全 DAG。
- `validation.rs`：完成循环依赖、端口类型、必填根/终止节点校验。
- `scheduler.rs`：拓扑排序并生成执行任务队列。
- `agent_bridge.rs`：将合法 DAG 交给 Agent 执行调度，保留现有 Agent 契约。

新增 Tauri 命令：

- `workflow_validate(workflow)`：返回结构化校验结果。
- `workflow_run(workflow)`：先校验，再生成 DAG，最后调用 Agent 桥接调度。

## 事件与状态同步

第一版采用本地事件总线：

- LiteGraph 变更事件同步到 React inspector 和 toolbar。
- 属性面板修改在 100ms 内写回 LiteGraph 节点 properties。
- 画布节点新增、更新、删除转换为现有 Agent 事件结构，继续复用 `recordAgentEvents`。

实时协作后续恢复时，在事件总线上增加 Yjs adapter，不侵入 LiteGraphCanvas 主体。

## 分阶段实施

### 阶段 1：基础设施

1. 安装并锁定 `@comfyorg/litegraph@0.17.2`。
2. 补充本地 TypeScript 类型声明和 Vite/tsconfig 兼容配置。
3. 新建工作流前端类型、适配器、事件总线和 API。

### 阶段 2：画布替换

1. 新建 `LiteGraphCanvas` 并注册 text/card/doc/agent 等节点。
2. 重构 `CanvasMode.tsx`，移除 tldraw 初始化、主题、store、全局拖拽兜底与 tldraw CSS。
3. 重构 `CanvasPage.tsx`，去除 SVG 自绘节点和连线，复用 LiteGraph 工作流画布。

### 阶段 3：后端工作流引擎

1. 新建 `workflow_engine` 模块。
2. 实现 LiteGraph JSON 到 Rust DAG 的解析。
3. 实现三层合法性校验。
4. 新增 `workflow_validate` 和 `workflow_run` Tauri 命令。

### 阶段 4：Agent 对接与验证

1. 将合法 DAG 转换为 Agent 可调度任务输入。
2. 添加节点执行状态事件回传。
3. 覆盖前端保存/运行、Rust parser/validator/scheduler 测试。
4. 执行 `npm run build`、`npm run lint`、`cargo clippy`。

## 验收标准

- `CanvasMode.tsx` 中无 tldraw 初始化、导入和样式依赖。
- `CanvasPage.tsx` 不再维护独立 SVG 画布逻辑。
- 旧 `CanvasDocument` 可迁移为 LiteGraph workflow 并正常保存。
- 工作流运行前可校验循环依赖、端口类型和根/终止节点完整性。
- Agent 事件采集逻辑保留，新增桥接代码最小化。
- 前端/Rust 构建和 lint/clippy 无新增错误。

## 暂缓项

- Yjs/Supabase 实时多人协作适配。
- 1000+ 节点性能专项优化。
- 与 ComfyUI 右键菜单完全等价的高级菜单扩展。
