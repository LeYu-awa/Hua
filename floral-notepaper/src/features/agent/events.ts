// Agent 事件标准化层
// 把编辑器事件（InkEvent）、画布节点/连线事件、协作事件归一成统一的
// AgentEvent，供规则引擎、Embedding、洞察分发等 Agent 模块消费。
// 所有 Agent 分析都依赖这条标准化事件流。

import type { InkEvent } from "../ink/types";
import type { CanvasEdge, CanvasNode } from "../canvas/types";

/** 统一事件类型 */
export type AgentEventKind =
  | "ink" // 编辑器输入/删除/光标等
  | "node_create" // 画布节点新建
  | "node_update" // 画布节点更新
  | "node_delete" // 画布节点删除
  | "edge_create" // 画布连线新建
  | "chat_message" // 协作聊天消息
  | "presence"; // 协作在线/光标状态

/**
 * 标准化 Agent 事件。
 * 不同来源的事件被折叠进同一结构，便于滑动窗口统计、聚类和回放。
 */
export interface AgentEvent {
  /** 事件唯一 ID */
  id: string;
  /** 事件种类 */
  kind: AgentEventKind;
  /** 触发用户 ID（协作场景），单机时可空 */
  userId?: string;
  /** 所属文档：笔记 / 画布 / 协作文档 ID */
  docId?: string;
  /** 关联画布节点 ID（若有） */
  nodeId?: string;
  /** 事件发生时间戳（ms，UTC） */
  timestamp: number;
  /** 原始载荷，按 kind 不同而不同 */
  payload: Record<string, unknown>;
}

/** 单调递增 + 随机后缀，避免依赖不可用的 Math.random-only 方案时碰撞 */
function makeId(prefix: string, seed: number): string {
  return `${prefix}-${seed}-${Math.round(seed % 1000)}`;
}

/** 把一条编辑器事件归一成 AgentEvent */
export function fromInkEvent(event: InkEvent): AgentEvent {
  return {
    id: event.id,
    kind: "ink",
    docId: event.noteId,
    timestamp: event.timestamp,
    payload: {
      type: event.type,
      source: event.source,
      index: event.index,
      text: event.text,
      length: event.length,
      selectionStart: event.selectionStart,
      selectionEnd: event.selectionEnd,
    },
  };
}

/** 批量归一编辑器事件 */
export function fromInkEvents(events: InkEvent[]): AgentEvent[] {
  return events.map(fromInkEvent);
}

/** 把画布节点新建/更新归一成 AgentEvent */
export function fromCanvasNode(
  node: CanvasNode,
  action: "create" | "update" | "delete",
  docId: string,
  timestamp: number,
  userId?: string,
): AgentEvent {
  const kind: AgentEventKind =
    action === "create" ? "node_create" : action === "update" ? "node_update" : "node_delete";
  return {
    id: makeId(`node-${action}`, timestamp),
    kind,
    userId,
    docId,
    nodeId: node.id,
    timestamp,
    payload: {
      nodeType: node.type,
      text: node.text,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      source: node.source,
    },
  };
}

/** 把画布连线归一成 AgentEvent */
export function fromCanvasEdge(
  edge: CanvasEdge,
  docId: string,
  timestamp: number,
  userId?: string,
): AgentEvent {
  return {
    id: makeId("edge-create", timestamp),
    kind: "edge_create",
    userId,
    docId,
    timestamp,
    payload: {
      edgeId: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      style: edge.style,
    },
  };
}

/** 把协作聊天消息归一成 AgentEvent */
export function fromChatMessage(msg: {
  id: string;
  docId: string;
  senderId: string;
  content: string;
  createdAt: number;
}): AgentEvent {
  return {
    id: msg.id,
    kind: "chat_message",
    userId: msg.senderId,
    docId: msg.docId,
    timestamp: msg.createdAt,
    payload: { content: msg.content },
  };
}

/** 取事件的文本内容（用于 Embedding / 语义分析），无文本时返回空串 */
export function eventText(event: AgentEvent): string {
  const p = event.payload;
  if (typeof p.text === "string") return p.text;
  if (typeof p.content === "string") return p.content;
  return "";
}

/**
 * 返回落在 [now - windowMs, now] 时间窗口内的事件。
 * 用于情绪推断、行为节奏等滑动窗口统计。
 */
export function eventsInWindow(events: AgentEvent[], windowMs: number, now: number): AgentEvent[] {
  const from = now - windowMs;
  return events.filter((e) => e.timestamp >= from && e.timestamp <= now);
}
