import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentAnalysisResult,
  AgentAwaitingConfirmEvent,
  AgentCanvasNode,
  AgentCollaborationSegment,
  AgentEvent,
  AgentEventInput,
  AgentExportEvent,
  AgentReplayMarker,
  AgentRetrievedChunk,
  AgentReviewReport,
  AgentSkill,
  AgentStepEvent,
  AgentSuggestion,
  AgentSuggestionStatus,
  AgentTask,
  AgentTaskStatus,
} from "./types";

export function recordAgentEvent(event: AgentEventInput): Promise<AgentEvent> {
  return invoke("agent_record_event", { event });
}

export function recordAgentEvents(events: AgentEventInput[]): Promise<AgentEvent[]> {
  return invoke("agent_record_events", { events });
}

export function listAgentEvents(conversationId: string, limit?: number): Promise<AgentEvent[]> {
  return invoke("agent_list_events", { conversationId, limit });
}

export function listAgentCanvasNodes(conversationId: string): Promise<AgentCanvasNode[]> {
  return invoke("agent_list_canvas_nodes", { conversationId });
}

export function analyzeAgentConversation(conversationId: string): Promise<AgentAnalysisResult> {
  return invoke("agent_analyze_conversation", { conversationId });
}

export function listAgentSuggestions(
  conversationId: string,
  status: AgentSuggestionStatus | null = "pending",
): Promise<AgentSuggestion[]> {
  return invoke("agent_list_suggestions", { conversationId, status });
}

export function dismissAgentSuggestion(suggestionId: string): Promise<AgentSuggestion> {
  return invoke("agent_dismiss_suggestion", { suggestionId });
}

export function acceptAgentSuggestion(suggestionId: string): Promise<AgentSuggestion> {
  return invoke("agent_accept_suggestion", { suggestionId });
}

export function listAgentReplayMarkers(conversationId: string): Promise<AgentReplayMarker[]> {
  return invoke("agent_list_replay_markers", { conversationId });
}

export function listAgentCollaborationSegments(
  conversationId: string,
): Promise<AgentCollaborationSegment[]> {
  return invoke("agent_list_collaboration_segments", { conversationId });
}

export function generateAgentReviewReport(conversationId: string): Promise<AgentReviewReport> {
  return invoke("agent_generate_review_report", { conversationId });
}

export function recordAgentChatMessageEvent(params: {
  conversationId: string;
  messageId: string;
  userId: string;
  content: string;
  timestamp?: string;
}): Promise<AgentEvent> {
  return invoke("agent_record_chat_message_event", params);
}

// ── 主编排任务（Phase B） ─────────────────────────────────────────────────────

export function createAgentTask(goal: string): Promise<AgentTask> {
  return invoke("agent_task_create", { goal });
}

/** 最小闭环入口：TS 发目标 → Rust 规划执行 → 返回最终任务（含 plan/logs/context） */
export function createAndRunAgentTask(goal: string): Promise<AgentTask> {
  return invoke("agent_task_create_and_run", { goal });
}

export function runAgentTask(taskId: string): Promise<AgentTask> {
  return invoke("agent_task_run", { taskId });
}

export function getAgentTask(taskId: string): Promise<AgentTask | null> {
  return invoke("agent_task_get", { taskId });
}

export function listAgentTasks(
  limit?: number,
  status?: AgentTaskStatus | null,
): Promise<AgentTask[]> {
  return invoke("agent_task_list", { limit, status });
}

export function updateAgentTaskStatus(
  taskId: string,
  status: AgentTaskStatus,
): Promise<AgentTask | null> {
  return invoke("agent_task_update_status", { taskId, status });
}

export function deleteAgentTask(taskId: string): Promise<boolean> {
  return invoke("agent_task_delete", { taskId });
}

/** 确认/拒绝待确认步骤：ok=true 标记确认并恢复执行，ok=false 取消该步骤与任务。
 *  payload 可选：确认 note.create 步骤时可携带 { title?, content? } 覆盖落盘内容（产出预览编辑后落盘）。 */
export function confirmAgentTask(
  taskId: string,
  stepId: string,
  ok: boolean,
  payload?: { title?: string; content?: string },
): Promise<AgentTask> {
  return invoke("agent_task_confirm", { taskId, stepId, ok, payload });
}

/** 列出全部产品 Agent 技能（技能注册表，供技能面板/对话侧选择） */
export function listAgentSkills(): Promise<AgentSkill[]> {
  return invoke("agent_skill_list");
}

/** 订阅单步进度事件（agent.step） */
export function onAgentStep(callback: (event: AgentStepEvent) => void): Promise<UnlistenFn> {
  return listen<AgentStepEvent>("agent.step", (payload) => callback(payload.payload));
}

/** 订阅待确认步骤事件（agent.awaiting_confirm），用于弹出确认/拒绝操作 */
export function onAgentAwaitingConfirm(
  callback: (event: AgentAwaitingConfirmEvent) => void,
): Promise<UnlistenFn> {
  return listen<AgentAwaitingConfirmEvent>("agent.awaiting_confirm", (payload) =>
    callback(payload.payload),
  );
}

/** 订阅任务全量状态事件（agent.task） */
export function onAgentTask(callback: (task: AgentTask) => void): Promise<UnlistenFn> {
  return listen<AgentTask>("agent.task", (payload) => callback(payload.payload));
}

/** 订阅导出事件（agent.export）：png/pdf 前端接管渲染并保存 */
export function onAgentExport(callback: (event: AgentExportEvent) => void): Promise<UnlistenFn> {
  return listen<AgentExportEvent>("agent.export", (payload) => callback(payload.payload));
}

// ── RAG（向量检索） ────────────────────────────────────────────────────────────

export function embedAgentText(text: string): Promise<number[]> {
  return invoke("agent_embed_text", { text });
}

export function ragIndex(sourceId: string, text: string): Promise<string[]> {
  return invoke("agent_rag_index", { sourceId, text });
}

export function ragRetrieve(query: string, topK?: number): Promise<AgentRetrievedChunk[]> {
  return invoke("agent_rag_retrieve", { query, topK });
}

export function ragDeleteSource(sourceId: string): Promise<void> {
  return invoke("agent_rag_delete_source", { sourceId });
}
