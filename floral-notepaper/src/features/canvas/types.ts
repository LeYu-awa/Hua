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
}

export interface CanvasEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  /** 虚线表示推荐/隐含，实线表示用户确认 */
  style: "solid" | "dashed";
}

export interface CanvasDocument {
  id: string;
  noteId?: string;
  coWriteSessionId?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
