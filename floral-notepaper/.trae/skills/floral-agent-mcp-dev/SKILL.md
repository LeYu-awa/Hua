---
name: "floral-agent-mcp-dev"
description: "花箴 Agent/技能/MCP 开发规范：新工具接入四步（注册表→执行分支→MCP#[tool]→技能注册）、--mcp 冒烟测试流程、orchestrator 确认机制。新增 agent 工具、MCP 工具、产品技能时调用。"
---

# 花箴 Agent / 技能 / MCP 开发规范

Agent 能力是分层的：**产品技能（skill）→ orchestrator 工具（tool）→ MCP 协议化**。三处共享同一批能力语义，改一处必须同步其余。

## 新增一个工具的完整链路（四步）

以新增工具 `foo.bar` 为例：

1. **工具注册表**：`src-tauri\src\services\agent\orchestrator.rs` 的 `tool_registry_json()` 加描述（name/description/input），供 LLM 规划器选择。
2. **执行分支**：`TaskRunner::execute_tool` 加 `Some("foo.bar")` 分支。写操作（新建/修改/删除/导出/联网）必须在流水线里走 `tool_step_confirm`（required_confirm=true），执行器会暂停等 `agent_task_confirm`。
3. **MCP 暴露**（可选）：`mcp_server.rs` 的 `#[tool_router]` impl 加同名 `#[tool(description = ...)]` 工具。工具名用下划线（`foo_bar`，`#[tool]` 默认取函数名），入参 struct derive `Debug, Deserialize, schemars::JsonSchema`，字段带 doc 注释。
4. **技能注册**（可选）：`SKILLS` 静态数组加 `Skill { name, description, matches: fn, plan: fn }`，`matches` 用关键词命中用户目标，`plan` 展开流水线。加完更新 `skill_registry` 测试数量断言。

## 工具上下文（outputs）规则

- 步骤输出按 `step_id` 存入 `outputs` HashMap；`note.read` 的 `"top"` 哨兵、`note.export` 的取笔记都依赖它。
- **Resume 恢复**：`run()` 开头会把已 `Done` 步骤的 output 装回 `outputs`——新增依赖上下文的工具时，确保执行分支从 `outputs` 读，且单测覆盖"暂停确认后恢复继续"场景。

## 验证

- 单测：`cargo test --lib orchestrator`（现有 23+ 个），新工具必须带端到端 runner 测试。
- MCP 冒烟：`cargo test --test mcp_stdio`（真实子进程 `--mcp`，走 initialize → tools/list → tools/call 全链路）。临时数据目录用 `FLORAL_NOTEPAPER_DATA_DIR` 隔离。
- 全量：`cargo test --lib` + `npx tsc --noEmit`。已知唯一失败 `desktop::tests::makes_note_surfaces_transparent` 为环境问题，非回归。

## 确认机制

- `TaskStatus::AwaitingConfirm`：遇到 `required_confirm` 且未 `confirmed` 的步骤暂停，emit `agent.awaiting_confirm`；前端 `agent_task_confirm(taskId, stepId, ok)` 恢复执行（ok=false → 步骤 Cancelled）。
- 写操作一律需确认，这是产品红线。
