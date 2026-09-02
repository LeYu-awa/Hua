# Archify 能力接入 FL 主知识画布设计

> 日期：2026-08-30  
> 项目：floral-notepaper（FL）  
> 上游能力：Archify 2.16.0  
> 范围：仅 FL 主知识画布；不涉及 LiteGraph 工作流画布

## 1. 背景与目标

FL 主知识画布已经具备卡片节点、SVG 连线、分组、缩放平移、撤销重做、自动保存和基础 Agent 能力，但尚未形成稳定的“文档输入 → Agent 理解 → 架构节点生成 → 用户继续编辑 → 持久化产出”业务闭环。

本项目借鉴 Updream 的 AI Agent 交互模式，并迁移 Archify 中成熟的图表语义、严格数据约束、诊断修复和布局能力，使 FL 主知识画布成为业务能力优先的 AI 原生画布。

核心目标：

1. 支持解析用户上传的本地文档和系统内笔记。
2. 从文档中提取实体、职责、关系、流程和分组。
3. 自动生成与 FL 现有卡片完全兼容的架构节点。
4. Agent 节点和用户手动节点在同一画布中融合编辑。
5. 生成结果可继续拖拽、编辑、连线、分组、撤销和保存。
6. 使用 Archify 的严格 IR、校验和诊断机制提高生成稳定性。
7. 保持 FL 原有 React、TypeScript、Rust、Tauri 架构和代码风格。

## 2. 范围边界

### 2.1 本期包含

- FL 主知识画布。
- 系统笔记与本地文档输入。
- Architecture 首期完整闭环。
- Architecture、Dataflow、Lifecycle、Workflow、Sequence 五类语义的可扩展框架。
- Agent 结构化生成、校验、修复和画布 Patch 应用。
- FL 现有卡片节点兼容。
- Agent 节点与手动节点融合。
- 工具栏、节点右键、主 Agent、SidebarChat 四个入口。
- 数据持久化、Undo/Redo、错误恢复和兼容性测试。

### 2.2 本期不包含

- LiteGraph 工作流画布及 `WorkflowDocument`。
- 用 Archify Viewer 或 HTML 替换 FL 主画布。
- 将 Archify HTML 嵌入节点。
- 将 Archify Viewer 改造成编辑器。
- 主画布实时多人协作。
- Architecture Delta 对比。
- 真正的工作流执行引擎。

## 3. 设计原则

1. **唯一画布运行时**：FL 主知识画布是唯一编辑与交互载体。
2. **业务能力优先**：先完成文档解析、节点生成、融合编辑和稳定保存。
3. **统一节点体系**：Agent 与用户节点使用同一 `CanvasNode`、同一渲染组件和同一事件链。
4. **模型生成语义，不生成内部状态**：LLM 只生成严格 IR，不直接生成 FL 坐标、历史栈和持久化字段。
5. **先校验后落图**：无效生成不得修改当前画布。
6. **增量 Patch**：Agent 只添加或更新明确目标，不覆盖整张画布。
7. **一次提交**：一次生成作为一个 Undo/Redo 操作提交。
8. **失败不破坏已有内容**：生成、校验或保存失败均保留原画布。
9. **单一执行链**：四个入口必须复用同一个 Agent Task 和领域服务。
10. **渐进扩展**：先用 Architecture 打通闭环，再扩展其他图表语义。

## 4. 现有架构基线

### 4.1 主画布

当前主画布使用 React + SVG：

- 节点由 SVG `<g>`、`<rect>` 与 `foreignObject` 内现有卡片内容组成。
- 连线由 SVG 线条渲染。
- 坐标系统使用 world/screen 双向转换。
- 支持节点拖拽、尺寸调整、多选、框选、缩放、平移、分组和右键菜单。
- `CanvasDocument` 通过 Tauri IPC 保存到本地 JSON。
- 撤销重做采用最多 50 份完整文档快照。

本设计不改变上述基础渲染路线，也不引入第二套节点组件。

### 4.2 Agent

FL 已有 Rust `Task/Step` 主编排器、Skill 注册表、工具执行器、确认暂停与恢复、SQLite 任务存储和前端进度事件；另有 SidebarChat function-calling 链路。

本设计以 Rust 主编排器为唯一业务执行主链，SidebarChat 只负责创建同一类 Agent Task，不重复实现文档解析、IR 修复或画布写入。

### 4.3 Archify 可迁移能力

迁移：

- 五类 Typed IR 的语义设计。
- 严格 JSON Schema 与 unknown-field 拒绝策略。
- 稳定 ID 和关系引用规则。
- `subject / evidence / supportedFixes` 结构化诊断。
- 诊断驱动、有限轮次的局部修复策略。
- 自动端口、正交布局、避障和可读性检查思路。
- 验证成功后冻结候选的交付原则。

不直接迁移：

- 单文件 HTML Viewer。
- Viewer Runtime。
- HTML/SVG 成品作为主画布节点。
- 四个执行型 Node renderer 的页面输出链。

## 5. 目标架构

```text
工具栏 / 节点右键 / 主 Agent / SidebarChat
                       │
                       ▼
           ArchifyGenerateRequest
                       │
                       ▼
             FL Agent TaskRunner
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   文档读取与解析   上下文构建     图表类型路由
        └──────────────┼──────────────┘
                       ▼
              LLM 生成 Archify IR
                       ▼
            Schema + 语义引用校验
                       ▼
          诊断驱动局部修复（最多两轮）
                       ▼
             IR → CanvasPatch 转换
                       ▼
               Patch 业务规则校验
                       ▼
               用户预览与确认
                       ▼
        commitDocument 一次性写入画布
                       ▼
          Undo/Redo + 自动保存 + 事件
```

## 6. 统一卡片节点设计

### 6.1 节点载体

自动生成节点继续使用现有 `CanvasNode`，不得引入外部 HTML 页面或独立节点宿主。

```ts
interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  source?: "user" | "agent" | "cowrite" | "zone" | "plan";
  group?: string | null;
  color?: string | null;
  tags?: string[];
  fields?: Record<string, string>;
  agentTaskId?: string;
  agentStepId?: string;
  agentStepStatus?: CanvasAgentStepStatus;
  agentStepKind?: string;
  agentTool?: string | null;
}
```

不新增仅用于 Archify 的特殊 HTML 节点。需要表达架构语义时，优先使用现有节点类型和 `fields`：

```ts
fields: {
  architectureKind: "service",
  architectureRole: "API gateway",
  sourceDocumentId: "...",
  sourceChunkIds: "...",
  generatedBy: "archify-agent"
}
```

### 6.2 自动节点与手动节点一致性

两类节点必须共享：

- 渲染组件。
- 点击、框选和多选。
- 拖拽和尺寸调整。
- 文本编辑。
- 连线和关系菜单。
- 分组、颜色和标签。
- 删除和右键菜单。
- Undo/Redo。
- 自动保存。

`source="agent"` 只用于来源标识、审计和轻量徽标，不改变核心交互。

## 7. 数据模型

### 7.1 文档来源

```ts
type DocumentSourceKind = "system-note" | "local-file";

interface ArchitectureDocumentSource {
  id: string;
  kind: DocumentSourceKind;
  title: string;
  mimeType: string;
  content: string;
  path?: string;
  noteId?: string;
  updatedAt?: string;
}
```

文档读取属于系统边界：必须限制文件类型、文件大小和允许路径；解析后的统一正文才进入 Agent。

### 7.2 生成请求

```ts
type ArchifyDiagramType =
  | "architecture"
  | "workflow"
  | "sequence"
  | "dataflow"
  | "lifecycle";

interface ArchifyGenerateRequest {
  canvasId: string;
  diagramType: ArchifyDiagramType;
  sourceDocumentIds: string[];
  sourceNodeIds: string[];
  scope: "documents" | "selected" | "canvas";
  intent: string;
}
```

### 7.3 Canvas Patch

```ts
interface CanvasPatch {
  id: string;
  canvasId: string;
  diagramType: ArchifyDiagramType;
  sourceDocumentIds: string[];
  sourceNodeIds: string[];
  nodesToAdd: CanvasNode[];
  edgesToAdd: CanvasEdge[];
  groupsToAdd: CanvasGroup[];
  generatedAt: string;
}
```

Patch 不允许直接删除或覆盖现有节点。后续局部再生成必须显式列出允许更新的目标 ID，并采用独立的更新请求模型。

### 7.4 前后端字段契约

Rust `CanvasNode` 必须补齐前端已有 Agent 字段，避免序列化后丢失：

- `agent_task_id`
- `agent_step_id`
- `agent_step_status`
- `agent_step_kind`
- `agent_tool`

所有字段使用 Serde rename 与 TypeScript camelCase 对齐，并增加完整 JSON 往返测试。

## 8. 文档解析设计

### 8.1 支持来源

首期优先级：

1. FL 系统笔记。
2. TXT、Markdown。
3. DOCX。
4. PDF 文本层。

图片 OCR、扫描 PDF、复杂表格和演示文稿作为后续能力，不阻塞首期闭环。

### 8.2 解析流程

```text
来源鉴权与文件检查
  → 内容读取
  → 格式解析
  → 文本清洗
  → 标题与段落识别
  → 按标题/段落/长度切片
  → chunkId 与来源范围记录
  → Agent 上下文组装
```

切片必须保留来源信息，便于节点追溯：

```ts
interface DocumentChunk {
  id: string;
  documentId: string;
  heading?: string;
  content: string;
  order: number;
  startOffset?: number;
  endOffset?: number;
}
```

### 8.3 大文档策略

- 优先按标题和段落切片，不进行任意字符截断。
- 超出模型上下文时先分片提取局部实体和关系，再进行归并。
- 实体归并使用稳定业务键与别名集合。
- 最终 IR 只包含图表所需摘要，不复制整篇文档。
- 节点保留来源文档和 chunk 引用。

## 9. Archify IR 与 FL 模型映射

### 9.1 Architecture

| Archify | FL |
|---|---|
| `components` | `CanvasNode[]` |
| `connections` | `CanvasEdge[]` |
| `boundaries` | `CanvasGroup[]` |
| component type | 现有节点类型 + `fields.architectureKind` |
| connection label | `CanvasEdge.label` |
| connection variant | `style` 与 `relationType` |

### 9.2 其他四类

| 图类型 | 节点来源 | 边来源 | 容器来源 |
|---|---|---|---|
| Workflow | `nodes` | `edges` | `lanes/phases/groups` |
| Sequence | `participants` 或关键交互步骤 | `messages` | `segments` |
| Dataflow | `nodes` | `flows` | `stages` |
| Lifecycle | `states` | `transitions` | `lanes` |

首期实现 Architecture 的完整转换器；转换器接口提前统一，后续四类不得复制独立写画布逻辑。

### 9.3 关系适配

Archify 关系先映射到 FL 已有类型：

- `supports`
- `causality`
- `related`
- `contrast`
- `opposes`
- `cites`

无法准确映射时使用 `related`，同时保留原始语义到 `label` 和边扩展元数据。不得因映射不完整丢弃关系。

## 10. 布局设计

LLM 不生成 FL 坐标。布局由确定性布局服务完成。

首期 Architecture 布局：

1. 根据依赖关系计算层级。
2. 根据 boundary 形成分组区域。
3. 在组内按层级和节点类型排列。
4. 为新增内容选择当前画布空白区域。
5. 计算节点统一尺寸与间距。
6. 检查节点重叠和画布现有内容碰撞。
7. 必要时整体平移 Patch，而不是移动用户已有节点。

Archify 的自动端口与正交避障思想用于优化 FL SVG 连线；首期优先保证无重叠和关系可读，不以复杂路由阻塞业务闭环。

## 11. Agent 与 Skill 设计

### 11.1 新增 Skill

```text
canvas.architecture.generate
```

固定执行链：

```text
document.read / note.read / canvas.read
  → document.parse
  → llm.generate_archify_ir
  → archify.validate
  → archify.repair（0～2 次）
  → canvas.patch.build
  → canvas.patch.validate
  → confirm
  → canvas.patch.apply
```

### 11.2 迁移的 Archify Agent 规则

1. 先选择图表类型。
2. 只向模型提供对应 Schema、公共定义和一个示例。
3. 默认使用稳定 ID。
4. Workflow 后续实现时默认 Schema v2。
5. 首轮不要求模型输出复杂手工路由。
6. 验证失败只修改诊断 `subject` 指向内容。
7. 修复必须参考 `evidence` 和 `supportedFixes`。
8. 最多自动修复两轮。
9. 连续修复无改善时终止。
10. 校验通过后冻结 IR。
11. Patch 校验成功且用户确认后才能修改画布。
12. 自动校验不能标记为人工视觉验收。

### 11.3 工具

建议增加：

- `document.parse`
- `archify.validate`
- `canvas.patch.build`
- `canvas.patch.validate`
- `canvas.patch.apply`

权限：

- 读取、解析、校验无需写确认。
- `canvas.patch.apply` 必须确认。
- Patch 预览允许用户取消。

### 11.4 四个入口统一

工具栏、节点右键和自然语言入口均构造同一个 `ArchifyGenerateRequest`。

SidebarChat 只暴露：

```text
canvas.architecture.generate
```

工具调用返回 `taskId`，后续由主 Agent TaskRunner 处理，SidebarChat 不自行执行修复和画布写入。

## 12. 画布交互

### 12.1 工具栏

新增“AI 架构”入口：

- 选择系统笔记或上传文件。
- 选择当前选中节点或整张画布作为补充上下文。
- 输入业务意图。
- 查看 Agent 生成进度。
- 确认后将结果插入当前画布。

### 12.2 节点右键

单选或多选节点时提供：

- 基于选中内容生成架构。
- 扩展当前架构。
- 重新分析选中内容。

首期仅启用“基于选中内容生成架构”；局部覆盖和重新生成在更新模型明确后开放。

### 12.3 生成预览

确认界面至少展示：

- 将新增的节点、边和分组数量。
- 节点标题列表。
- 来源文档。
- 校验状态。
- 警告和被降级映射的关系。

确认后一次性调用 `canvas.patch.apply`。

### 12.4 手动继续编辑

生成后不锁定 Agent 节点。用户可以：

- 修改标题和正文。
- 移动与调整尺寸。
- 删除节点或关系。
- 添加手动节点。
- 在手动节点与 Agent 节点间连线。
- 修改关系类型。
- 移入或移出分组。

## 13. 稳定性前置改造

以下问题会直接影响批量生成，必须在 Agent 落图前修复：

1. TypeScript 与 Rust `CanvasNode` Agent 字段不一致。
2. 自动保存缺少 revision，旧请求可能清除新 dirty 状态。
3. 切换画布或卸载时未 flush 最后修改。
4. 删除节点后可能残留 `groups[].nodeIds`。
5. `CanvasNode.group` 与 `CanvasGroup.nodeIds` 双重事实可能漂移。
6. resize 未按缩放比例换算且不能撤销。
7. Agent 完成后重载磁盘会清空历史并可能覆盖本地修改。

改造原则：

- Patch 必须经过现有 `commitDocument` 写入历史。
- 保存请求串行化并携带 revision。
- 只有当前 revision 保存成功才能清除 dirty。
- 画布切换和卸载前 flush 保存队列。
- 分组关系集中归一化。
- Agent Patch 应直接更新内存文档并正常保存，不再通过“写盘后整图重载”同步。

## 14. 错误处理

### 14.1 错误分类

- 文档读取失败。
- 不支持的格式。
- 文档为空或无可提取内容。
- LLM 返回非 JSON。
- Schema 校验失败。
- 引用对象不存在。
- 两轮修复后仍失败。
- Patch ID 冲突。
- 布局失败或坐标非法。
- 用户取消确认。
- 画布保存失败。

### 14.2 失败语义

- 失败前不得修改 `CanvasDocument`。
- Patch 应用失败必须保留原画布快照。
- 保存失败时保留 dirty 状态并显示明确错误。
- Agent Task 保存结构化诊断，允许用户查看或重试。
- 重试复用冻结后的文档解析结果，避免来源变化造成不可预测结果。

## 15. 安全与隐私

- 本地文件只允许用户显式选择。
- Tauri 后端验证规范化路径，不接受前端任意路径穿越。
- 文档大小和解析时长设置上限。
- 外部模型调用前明确遵循当前供应商配置。
- 不在日志中记录完整文档正文或密钥。
- 任务记录只保存必要摘要、来源 ID 和诊断。
- 本期不使用 Archify Google Fonts、品牌图标或外部 Viewer，避免额外网络与商标风险。
- 迁移 Archify 实质代码时保留 MIT 与原版权声明。

## 16. 测试设计

### 16.1 数据契约

- TypeScript/Rust `CanvasNode` 全字段往返。
- Agent 字段保存、关闭和重启后不丢失。
- CanvasPatch 序列化与反序列化。
- 未知或非法字段被拒绝。

### 16.2 文档解析

- 系统笔记、Markdown、TXT。
- DOCX 和文本 PDF。
- 空文档、损坏文件、超大文件和不支持格式。
- CJK 标题、段落与长文切片。
- 来源 chunk 追溯。

### 16.3 Agent

- Architecture 意图识别。
- 严格 IR 生成。
- 引用完整性校验。
- 诊断驱动局部修复。
- 最多两轮停止。
- 无改善时停止。
- 用户拒绝后不落图。
- 任务恢复后保留上游 outputs。

### 16.4 转换与布局

- component、connection、boundary 完整映射。
- ID 去重。
- 未知关系降级但不丢失。
- 节点不重叠。
- Patch 不移动已有节点。
- 分组成员均存在。
- 所有边端点均存在。

### 16.5 画布兼容

- Agent 与手动节点混合选择、拖拽和编辑。
- 两类节点互相连线。
- 一次生成可整体 Undo/Redo。
- resize 在缩放状态下正确。
- 节点删除同步清边和分组。
- 自动保存竞态。
- 切换画布前 flush。
- 保存失败保持 dirty。

### 16.6 回归

- 原手动创建节点不受影响。
- 原画布加载、保存、删除和重命名正常。
- 原 Agent 扩写、自动分组、成文能力正常。
- 不修改 LiteGraph 工作流画布。

## 17. 验收标准

### P0 业务闭环

1. 用户可选择系统笔记或上传支持的本地文档。
2. Agent 能提取有效架构节点、关系和分组。
3. 所有生成节点使用 FL 现有卡片节点体系。
4. 自动节点和手动节点可融合编辑与连线。
5. 生成前有预览和确认。
6. 一次生成可整体撤销和重做。
7. 保存并重启后 Agent 字段、节点、边和分组不丢失。
8. 生成失败不修改当前画布。
9. 保存失败不会错误标记为已保存。
10. 原主画布功能无回归。

### 后续扩展

- 在同一 IR Adapter 和 Patch 管线下扩展 Dataflow、Lifecycle、Workflow、Sequence。
- 增加基于现有节点的局部增量生成。
- 增加来源证据查看和节点级重新分析。
- 优化正交路由、端口分配和大型画布布局。

## 18. 决策记录

- 采用 FL 主知识画布单一运行时。
- 不采用双层 Viewer 画布。
- 不使用 HTML 作为节点载体。
- Agent 和手动节点统一使用现有卡片组件。
- Archify 定位为语义、校验、诊断和布局内核。
- 首期 Architecture 优先，五类图采用统一可扩展接口。
- 所有入口复用 Rust 主 Agent TaskRunner。
- 业务闭环和数据稳定性优先于视觉与高级路由优化。
