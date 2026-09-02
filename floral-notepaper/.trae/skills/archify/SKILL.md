---
name: archify
description: 架构/流程/时序/数据流/生命周期（五类图）的生成与校验契约，本体为 vendor/archify 技能包。当需要在花箴主知识画布中把选中卡片/笔记/文档解析成架构图卡片与连线、扩展五类图新图型、调整 Archify IR schema 校验与修复循环、或对接 renderers/validate/deliver CLI 时使用。agent 先读 vendor/archify/SKILL.md 权威契约再动手，所有画布改动必须走既有的 IR→CanvasPatch 管线（可撤销预览确认），不得绕过。
---

# Archify（花箴业务内置技能）

Archify 是一个"JSON IR → 图"的声明式技能包：先让模型产出严格类型化 IR JSON，再做 schema + 引用校验，最后确定性排版。本仓库把它精简后内置于 `vendor/archify`，并按花箴业务深度集成到**主知识画布**（不作为独立 viewer/画布）。

## 权威契约

开工前必须先读 `vendor/archify/SKILL.md`（这是唯一事实源），并按需读 `schemas/*.schema.json`、`examples/*.json`、`renderers/`。本文件只描述"如何在本项目里用它做画布集成"，不替代本体契约。

自检命令（在 `vendor/archify` 目录下执行）：

```bash
node bin/archify.mjs doctor
```

要求全部 `[ok]`、退出码 0 才算就绪。五类图：`architecture` / `workflow` / `sequence` / `dataflow` / `lifecycle`。

## 业务深度集成代码地图

产品内 Agent（Rust orchestrator）已把 Archify 的"IR 生成 + 修复循环"接进主知识画布，前端经 `CanvasPatch` 落盘，全部可撤销。

- 生成入口（四种都要走同一个弹窗/预览管线）：
  - 工具栏按钮 → [CanvasPage.tsx](file:///d:/花箴/floral-notepaper/src/components/CanvasPage.tsx)
  - 卡片右键菜单 → 同上（`handleArchitectureRequest`）
  - 主 Agent DSL → [canvasCommands.ts](file:///d:/花箴/floral-notepaper/src/features/canvas/canvasCommands.ts)（`CANVAS_COMMAND_EVENT` / `parseCommandDsl` / `dispatchCanvasCommand`）
  - SidebarChat Agent 工具 `canvas.architecture.generate` → [agentTools.ts](file:///d:/花箴/floral-notepaper/src/features/sidebarChat/agentTools.ts)
- 前端 IR→Patch 适配：`src/features/canvas/archifyAdapter.ts`（`validateArchitecture` / `buildArchitecturePatch` / `applyCanvasPatch`，确定性 layout、stable id）
- Agent 调用：`src/features/agent/api.ts` 的 `generateArchitecture(...)` → Tauri `invoke("agent_architecture_generate", ...)`
- Rust 侧：`src-tauri/src/services/agent/orchestrator.rs`（`agent_architecture_generate`、plan：`canvas.read` → `architecture.build`，strict IR 解析与最多两轮修复）；IR 结构/校验在 `architecture.rs`
- 架构弹窗接收 notes/选中节点来源（`architectureSource: "nodes" | "notes"`）

## 业务红线（根据花箴需求）

1. 生成结果必须落到**主知识画布**上用**现有卡片组件**渲染（SVG `g`/`rect`/`foreignObject` 卡片），禁止另起 HTML viewer / 独立画布 / HTML-native 节点。
2. 产物形态是 `CanvasPatch`（`nodesToAdd`/`edgesToAdd`/`groupsToAdd`）→ 用户预览确认 → `commitDoc` 单次可撤销提交。不可直接写文档状态。
3. 当前只接通 `architecture` 一类并跑通；扩展 dataflow/lifecycle/workflow/sequence 时复用同一 `architecture.build` 管线与 `archifyAdapter` 映射，一次一类、先稳定再扩。
4. 节点/连线与现有卡片混合共存：Agent 生成节点、手动自由绘制节点可并存，不得破坏现有画布机制（缩放、拖动、保存序列化、revision guard、flush-before-switch）。
5. 校验契约：`architecture.build` 严格按 Archify schema 校验 IR；修复循环最多两轮、只改诊断 subject；IR 字段缺失/引用错导致校验不过时如实报告，不伪造成功。

## 验证

- 前端类型：`npx tsc --noEmit`
- 前端单测：`npx vitest run src/features/sidebarChat src/features/canvas`（agentTools / canvasCommands / archifyAdapter 相关）
- Rust：`cargo test --lib`（orchestrator 含 `agent_architecture_generate` 计划/执行测试）；已知唯一失败 `desktop::tests::makes_note_surfaces_transparent` 为环境问题，非回归
- Archify 包自检：`vendor/archify` 下 `node bin/archify.mjs doctor` 全绿

## 扩展流程（新图型落地步骤）

1. 读对应 `schemas/<type>.schema.json` + `examples/<type>*.json`，明确字段与校验。
2. 在 Rust `architecture.rs` 侧扩展 strict IR 解析 / 校验区分；`orchestrator.rs` 里补充生成 plan 上下文（若需读画布/笔记）。
3. 在 `archifyAdapter.ts` 增加该类型 IR→`CanvasPatch` 映射（节点=组件/状态/参与者、边=连线、boundary/lane=group），复用 layout 引擎。
4. 前端把类型透传到生成请求与预览文案，弹窗/工具描述同步。
5. 用 `node bin/archify.mjs validate <type> <candidate.json> --json` 校验候选 IR，再走画布预览确认。
