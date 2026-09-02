export type AgentEventType =
  | "canvas_shape_added"
  | "canvas_shape_updated"
  | "canvas_shape_removed"
  | "canvas_binding_added"
  | "canvas_binding_removed"
  | "chat_message_sent"
  | "canvas_template_applied";

export interface ArchitectureDocumentSource {
  kind: "note" | "file";
  id: string;
  title: string;
  mimeType: "text/plain" | "text/markdown" | "text/x-markdown";
  path?: string;
}

export interface AgentDocumentChunk {
  id: string;
  documentId: string;
  heading?: string;
  content: string;
  order: number;
  startOffset: number;
  endOffset: number;
}

export interface ParsedAgentDocument {
  source: ArchitectureDocumentSource;
  content: string;
  chunks: AgentDocumentChunk[];
}

export interface AgentEventInput {
  conversationId: string;
  userId: string;
  eventType: AgentEventType;
  timestamp?: string;
  payload: Record<string, unknown>;
}

export interface AgentEvent extends AgentEventInput {
  id: string;
  timestamp: string;
}

export interface AgentCanvasNode {
  conversationId: string;
  nodeId: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export type AgentSuggestionStatus = "pending" | "dismissed" | "accepted";

export type AgentSuggestionType = "idle_prompt" | "chat_to_canvas_node" | "suggest_connection";

export interface AgentSuggestion {
  id: string;
  conversationId: string;
  suggestionType: AgentSuggestionType;
  title: string;
  message: string;
  status: AgentSuggestionStatus;
  priority: number;
  sourceEventIds: string[];
  relatedNodeIds: string[];
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type AgentReplayMarkerType = "handoff" | "conflict" | "flow" | "stuck" | "consensus";

export interface AgentReplayMarker {
  id: string;
  conversationId: string;
  time: number;
  markerType: AgentReplayMarkerType;
  title: string;
  summary: string;
  relatedEventIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
}

export interface AgentCollaborationSegment {
  id: string;
  conversationId: string;
  fromUserId: string;
  toUserId: string;
  startedAt: string;
  endedAt: string;
  eventCount: number;
  relatedEventIds: string[];
  relatedNodeIds: string[];
  summary: string;
  createdAt: string;
}

export interface AgentReviewReport {
  conversationId: string;
  title: string;
  summary: string;
  healthScore: number;
  markerCounts: Record<string, number>;
  highlights: string[];
  risks: string[];
  nextSteps: string[];
  generatedAt: string;
}

export interface AgentAnalysisResult {
  suggestions: AgentSuggestion[];
  replayMarkers: AgentReplayMarker[];
  collaborationSegments: AgentCollaborationSegment[];
}

export type AgentUICommand =
  | {
      type: "suggest_connection";
      nodeIds: [string, string];
      message: string;
      confidence: number;
    }
  | {
      type: "show_semantic_gap";
      areaHint: { x: number; y: number };
      items: string[];
      message: string;
    }
  | {
      type: "live2d_signal";
      mood: "happy" | "neutral" | "sleepy" | "excited" | "worried" | "curious";
      animation: string;
      bubbleText: string;
      priority: number;
    }
  | {
      type: "replay_marker";
      time: number;
      markerType: AgentReplayMarkerType;
      title: string;
      summary: string;
    };

// ── 主编排任务（Phase B：Rust 侧 orchestrator 全量状态镜像） ────────────────

export type AgentTaskStatus =
  | "Planned"
  | "Running"
  | "AwaitingConfirm"
  | "Done"
  | "Failed"
  | "Cancelled";

export type AgentStepStatus = "Pending" | "Running" | "Done" | "Failed" | "Cancelled";

export type AgentStepKind = "Tool" | "Llm" | "Confirm" | "Output";

export interface AgentStep {
  stepId: string;
  kind: AgentStepKind;
  tool?: string | null;
  input: Record<string, unknown>;
  output?: unknown | null;
  status: AgentStepStatus;
  requiredConfirm: boolean;
  confirmed: boolean;
}

export interface AgentStepLog {
  stepId: string;
  message: string;
  timestamp: string;
}

export interface AgentTask {
  taskId: string;
  goal: string;
  plan: AgentStep[];
  status: AgentTaskStatus;
  context?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  logs: AgentStepLog[];
}

/** 产品 Agent 技能（orchestrator 技能注册表 SKILLS 的一行） */
export interface AgentSkill {
  name: string;
  description: string;
}

/** 单步进度事件（agent.step）负载 */
export interface AgentStepEvent {
  taskId: string;
  stepId: string;
  tool?: string | null;
  status: AgentStepStatus;
  message: string;
}

/** 待确认步骤事件（agent.awaiting_confirm）负载 */
export interface AgentAwaitingConfirmEvent {
  taskId: string;
  stepId: string;
  tool?: string | null;
  input: Record<string, unknown>;
}

/** 导出事件（agent.export）负载：markdown 带 path，png/pdf 带完整内容由前端接管渲染 */
export interface AgentExportEvent {
  kind: "note";
  format: "markdown" | "png" | "pdf";
  title?: string;
  content?: string;
  path?: string;
}

/** RAG 检索命中块 */
export interface AgentRetrievedChunk {
  chunkId: string;
  sourceId: string;
  text: string;
  position: number;
  score: number;
}
