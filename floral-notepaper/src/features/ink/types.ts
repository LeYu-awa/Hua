// Ink / Agent 事件流类型定义
// 前后端通过 Tauri IPC 传递，字段名保持一致（camelCase）

export type InkEventType = "insert" | "delete" | "cursor" | "paste" | "select" | "snapshot";

export type InkSessionSource = "main" | "notepad" | "canvas";

export type BehaviorType =
  | "流畅创作"
  | "纠结修改"
  | "结构调整"
  | "大量重写"
  | "润色优化"
  | "停顿思考";

/** 单条编辑/写作事件 */
export interface InkEvent {
  /** 事件唯一 ID */
  id: string;
  /** 所属 session */
  sessionId: string;
  /** 所属笔记/画布 ID */
  noteId: string;
  /** 事件来源：主编辑器 / 便签 / 画布 */
  source: InkSessionSource;
  /** 事件类型 */
  type: InkEventType;
  /** 操作起始位置（字符索引） */
  index: number;
  /** 插入/粘贴的文本内容（insert / paste） */
  text?: string;
  /** 删除的字符长度（delete） */
  length?: number;
  /** 光标起始位置 */
  selectionStart?: number;
  /** 光标结束位置 */
  selectionEnd?: number;
  /** 事件发生时间戳（ms，UTC） */
  timestamp: number;
}

/** 一次连续写作的 session 摘要 */
export interface InkSessionSummary {
  id: string;
  noteId: string;
  source: InkSessionSource;
  startedAt: number;
  endedAt?: number;
  eventCount: number;
}

/** 一次 session 的完整数据 */
export interface InkSession extends InkSessionSummary {
  events: InkEvent[];
}

/** 行为区间，用于回放和复盘 */
export interface BehaviorInterval {
  startMs: number;
  endMs: number;
  type: BehaviorType;
}

/** 关键帧，用于回放时间轴标记 */
export interface InkKeyPoint {
  timeMs: number;
  type: "paste" | "delete" | "move" | "newParagraph" | "undo" | "pause" | "flow";
  description: string;
}

/** Agent 信号，统一发送给 UI / Live2D / 画布 */
export interface AgentSignal {
  type: "flow" | "pause" | "hesitate" | "rest" | "connection" | "archive";
  /** 0-1，信号强度 */
  intensity: number;
  /** 建议显示的文案 */
  message?: string;
  /** 关联节点/笔记 ID */
  relatedIds?: string[];
}

/** 向后端追加事件的请求 */
export interface AppendInkEventsRequest {
  noteId: string;
  sessionId: string;
  source: InkSessionSource;
  events: InkEvent[];
}
