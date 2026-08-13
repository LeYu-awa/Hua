export type CanvasNodeType = "text" | "card" | "resource" | "task";

export type CanvasAgentStepStatus = "Pending" | "Running" | "Done" | "Failed" | "Cancelled";

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** 来源：用户创建 / AI 推荐 / 共笔生成 */
  /** 节点来源：user=用户 / agent=AI 生成 / cowrite=协作 / zone=画布分区标记 / plan=AI 规划占位标记 */
  source?: "user" | "agent" | "cowrite" | "zone" | "plan";
  /** z 序（越大越靠前），P1 图层分层 */
  zIndex?: number;
  /** Agent 任务编排绑定：任务步骤拖到画布后写入，用于状态映射与参数同步 */
  agentTaskId?: string;
  agentStepId?: string;
  agentStepStatus?: CanvasAgentStepStatus;
  agentStepKind?: string;
  agentTool?: string | null;
  /** 所属分组 id（分组/泳道） */
  group?: string | null;
  /** 卡片颜色标记（card 灵感卡） */
  color?: string | null;
  /** 卡片标签（card 灵感卡） */
  tags?: string[];
  /** task 待办卡完成态 */
  done?: boolean | null;
  /** task 待办卡截止日期（YYYY-MM-DD） */
  dueDate?: string | null;
  /** resource 资源卡关联笔记 id（双击打开对应笔记） */
  noteId?: string | null;
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
