export type CanvasNodeType = "text" | "card" | "resource" | "task";

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** 来源：用户创建 / AI 推荐 / 共笔生成 */
  source?: "user" | "agent" | "cowrite";
  /** z 序（越大越靠前），P1 图层分层 */
  zIndex?: number;
}

export interface CanvasEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  /** 虚线表示推荐/隐含，实线表示用户确认 */
  style: "solid" | "dashed";
}

export interface CanvasGroup {
  id: string;
  title: string;
  nodeIds: string[];
}

export interface CanvasDocument {
  id: string;
  noteId?: string;
  coWriteSessionId?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** 分组（P1 图层分组） */
  groups?: CanvasGroup[];
}
