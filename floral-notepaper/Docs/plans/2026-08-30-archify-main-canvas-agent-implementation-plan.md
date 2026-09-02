# Archify 主知识画布 Agent 对接实施计划

> 日期：2026-08-30  
> 设计依据：`Docs/plans/2026-08-30-archify-main-canvas-agent-design.md`

## 1. 实施目标

在不修改 LiteGraph 工作流画布的前提下，完成以下主链：

```text
系统笔记/本地文档
  → 解析与切片
  → Agent 生成 Architecture IR
  → 严格校验和有限修复
  → 转换、布局并预览 CanvasPatch
  → 用户确认
  → 以现有卡片节点一次性写入主知识画布
  → Undo/Redo、自动保存和重启恢复
```

## 2. 实施顺序

### 阶段 A：画布稳定底座

#### A1. 对齐 CanvasNode 前后端契约

修改：

- `src/features/canvas/types.ts`
- `src-tauri/src/services/canvas.rs`
- 相关 Rust 和前端测试

任务：

- Rust 补齐 `agentTaskId`、`agentStepId`、`agentStepStatus`、`agentStepKind`、`agentTool`。
- 复核 `fields`、`tags`、`group`、`color`、`dueDate`、`noteId`、`draftedBy` 等字段往返。
- 增加完整 CanvasDocument JSON round-trip 测试。
- 保持旧文档缺失字段可正常加载。

验收：Agent 字段保存、关闭、重新读取后完全一致。

#### A2. 建立版本化串行保存

修改：

- `src/components/CanvasPage.tsx`
- `src/features/canvas/api.ts`（仅在需要返回 revision 时）
- 相关测试

任务：

- 增加本地 document revision。
- 保存请求串行化。
- 只有保存成功的 revision 等于当前 revision 时才清除 dirty。
- 新修改发生时不得被旧保存响应覆盖。
- 保存失败保持 dirty 并显示错误。
- 切换画布与组件卸载前 flush 保存队列。

验收：乱序或延迟保存不会丢失最后修改。

#### A3. 修复历史、resize 与分组一致性

修改：

- `src/components/CanvasPage.tsx`
- `src/features/canvas/types.ts`（如需归一化类型）
- 相关测试

任务：

- resize 增量除以当前 scale。
- resize pointerup 作为一次历史提交。
- 删除节点同步清理边和 `groups[].nodeIds`。
- 集中实现分组归一化，避免 node.group 与 group.nodeIds 漂移。
- Agent 修改不再通过磁盘重载清空 Undo/Redo。

验收：resize、删除、分组和 Agent Patch 均可可靠撤销。

### 阶段 B：CanvasPatch 领域能力

#### B1. 定义 Patch 类型和校验器

新增或修改：

- `src/features/canvas/types.ts`
- 建议新增 `src/features/canvas/canvasPatch.ts`
- 对应测试

任务：

- 定义 `CanvasPatch`。
- 校验 canvasId、节点 ID、边端点、分组成员、尺寸和有限坐标。
- 拒绝与现有节点、边、分组 ID 冲突。
- 默认仅允许新增，不允许隐式覆盖或删除。

验收：非法 Patch 在修改文档前被拒绝。

#### B2. 实现一次性 Patch 应用

修改：

- `src/components/CanvasPage.tsx`
- `src/features/canvas/canvasCommands.ts`（如使用命令桥）
- 对应测试

任务：

- 将 Patch 合并为新 CanvasDocument。
- 只调用一次 `commitDocument`。
- 成功后自动选中和聚焦新增节点。
- 应用失败时保持原文档引用和历史栈不变。

验收：一次生成对应一个 Undo 步骤。

### 阶段 C：文档解析

#### C1. 统一文档来源 API

修改或新增：

- Rust 文档解析服务模块
- Tauri 命令注册
- 前端 Agent API 和类型

任务：

- 系统笔记读取适配。
- 用户文件选择与规范化路径检查。
- 定义统一 `ArchitectureDocumentSource`。
- 限制文件大小和格式。
- 首期支持 Markdown、TXT；随后接 DOCX、文本 PDF。

验收：不同来源均返回统一正文与元数据。

#### C2. 文本清洗与切片

新增：

- Rust 或共享 Agent 文档切片模块
- 单元测试样例

任务：

- 标题和段落识别。
- CJK 友好切片。
- chunk ID、顺序和来源范围。
- 大文档分片摘要与实体归并输入结构。
- 日志禁止记录完整正文。

验收：长文不会因直接截断破坏主要结构。

### 阶段 D：Archify Architecture 内核适配

#### D1. 引入最小 Architecture IR

新增或修改：

- Rust Agent 领域类型或 JSON Value 契约
- Architecture Schema 资源
- Schema 许可证与版权声明
- 校验测试

任务：

- 只引入 Architecture 与公共 Schema 所需字段。
- 保持 strict unknown-field 策略。
- 实现稳定 ID、引用完整性、唯一性校验。
- 将错误转换为 `subject/evidence/supportedFixes` 诊断。
- 不引入 Archify HTML Viewer 和模板。

验收：合法与非法 Architecture 样例可得到确定结果。

#### D2. 实现 Agent 生成和修复循环

修改：

- `src-tauri/src/services/agent/orchestrator.rs`
- 工具注册表与工具执行器
- Agent 类型与前端进度 UI
- 对应单元测试

任务：

- 注册 `canvas.architecture.generate` Skill。
- 增加 `document.parse`、`archify.validate`、`canvas.patch.build`、`canvas.patch.validate`、`canvas.patch.apply` 工具。
- 仅向模型提供 Architecture Schema、common 子集和一个示例。
- 实现最多两轮诊断驱动修复。
- 连续无改善时停止。
- 将 IR 与解析结果保存在有序 outputs 中，支持确认后恢复。

验收：任务可暂停确认、恢复并保留上游结果。

#### D3. IR 转 CanvasPatch

建议新增：

- `src/features/canvas/archifyAdapter.ts` 或 Rust 等价模块
- `src/features/canvas/architectureLayout.ts`
- 对应测试

任务：

- components → 现有卡片节点。
- connections → 现有边。
- boundaries → 现有分组。
- 节点添加 `source="agent"` 和来源 fields。
- 关系类型映射，未知关系降级并保留 label。
- 计算层级布局和空白区域偏移。
- 不移动已有节点。

验收：生成结果无重叠、无悬空边，且全部使用现有节点结构。

### 阶段 E：确认和产品入口

#### E1. Patch 预览确认

修改：

- `src/features/agent/TaskProgressPanel.tsx`
- Agent types/api
- 测试

任务：

- 展示来源、节点数、边数、分组数和标题列表。
- 展示校验诊断和降级映射警告。
- 确认后执行 Patch；拒绝后取消任务且不修改画布。

验收：用户可在落图前理解即将发生的变化。

#### E2. 画布工具栏入口

修改：

- `src/components/CanvasPage.tsx`
- 建议新增独立对话框组件
- 测试

任务：

- 选择系统笔记或本地文件。
- 选择画布上下文范围。
- 输入业务意图。
- 创建同一 Agent Task。

#### E3. 节点右键入口

修改：

- `src/components/CanvasPage.tsx`
- 测试

任务：

- 单选、多选节点生成架构。
- 创建任务时冻结 sourceNodeIds。
- 执行期间选择变化不影响输入。

#### E4. SidebarChat 入口

修改：

- `src/features/sidebarChat/agentTools.ts`
- `src/features/sidebarChat/agentLoop.ts`（仅必要改动）
- `src-tauri/src/services/assistant_tools.rs`
- 测试

任务：

- 增加 `canvas.architecture.generate` bridge tool。
- 工具只创建主编排任务并返回 taskId。
- 不在 SidebarChat 内重复执行 Schema、修复和写画布逻辑。

验收：四个入口最终进入同一 TaskRunner 链。

### 阶段 F：端到端与回归验证

#### F1. 单元和组件测试

重点：

- 数据契约 round-trip。
- 保存竞态和 flush。
- resize 与 Undo。
- 分组清理。
- Patch 校验和原子应用。
- 文档解析与切片。
- Architecture 校验与修复上限。
- IR 映射和布局。
- 四个入口。

#### F2. Rust 集成测试

重点：

- Agent Task 创建、确认、恢复。
- 文档路径安全。
- 工具注册表与执行器一致。
- 写确认策略。
- 任务状态和事件。

#### F3. E2E 验收场景

1. 系统笔记生成架构。
2. Markdown 文件生成架构。
3. Agent 和手动节点混合编辑。
4. 两类节点互相连线。
5. 整体 Undo/Redo。
6. 保存、关闭、重启恢复。
7. 无效模型输出经修复成功。
8. 两轮失败后不修改画布。
9. 用户拒绝确认后不修改画布。
10. 保存失败保持 dirty 并可重试。

## 3. 关键实现约束

- 不修改 `src/components/workflow/LiteGraphWorkflow.tsx` 和 WorkflowDocument 链路。
- 不创建 Archify HTML Viewer 节点。
- 不允许 LLM 直接输出 CanvasDocument。
- 不允许各入口复制 Agent 业务逻辑。
- 不允许 Patch 绕过 `commitDocument`。
- 不允许写盘成功前报告任务完成。
- 不允许自动修复无限循环。
- 不为后续五类图提前建立过度抽象；只保留必要的 Adapter 接口。

## 4. 推荐验证命令

根据项目现有脚本和模块逐步执行：

```powershell
npm test -- --run src/components/CanvasPage.test.tsx
npm test -- --run src/features/agent/TaskProgressPanel.test.tsx
npm test -- --run src/features/sidebarChat/agentLoop.test.ts
npx tsc --noEmit
cargo test --lib orchestrator
cargo test --lib canvas
cargo test --lib
```

最终再执行项目完整前端测试与构建。

## 5. 完成定义

只有同时满足以下条件，P0 才视为完成：

- 系统笔记和至少 Markdown/TXT 本地文档可生成 Architecture。
- 生成节点全部由现有卡片体系渲染。
- Agent 与手动节点可融合编辑和连线。
- Patch 可整体 Undo/Redo。
- 保存和重启后数据不丢失。
- 失败、取消和无效输出不会修改画布。
- 自动保存竞态已修复。
- 原主画布和原 Agent 能力无回归。
- LiteGraph 工作流画布无改动。
