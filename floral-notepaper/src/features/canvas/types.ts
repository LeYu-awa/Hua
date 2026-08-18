export type CanvasNodeType =
  | "knowledge"
  | "idea"
  | "opinion"
  | "resource"
  | "task"
  | "question"
  | "text" // 兼容别名：加载时归一化为 idea
  | "card"; // 兼容别名：加载时归一化为 knowledge

/** 连线关系类型（知识画布） */
export type CanvasRelationType =
  | "related"
  | "causality"
  | "contrast"
  | "supports"
  | "opposes"
  | "cites";

export const CANVAS_RELATION_TYPES: { value: CanvasRelationType; label: string }[] = [
  { value: "related", label: "相关" },
  { value: "causality", label: "因果" },
  { value: "contrast", label: "对比" },
  { value: "supports", label: "支持" },
  { value: "opposes", label: "反对" },
  { value: "cites", label: "引用来源" },
];

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
  /** 卡片颜色标记 */
  color?: string | null;
  /** 卡片标签 */
  tags?: string[];
  /** task 待办卡完成态 */
  done?: boolean | null;
  /** task 待办卡截止日期（YYYY-MM-DD） */
  dueDate?: string | null;
  /** resource 资源卡关联笔记 id（双击打开对应笔记） */
  noteId?: string | null;
  /** 成文留痕：参与组卡成文产出的笔记 id（溯源：哪些卡片 → 哪篇文章） */
  draftedBy?: string | null;
  /** 类型化字段（知识画布）：knowledge.url/title/confidence、opinion.source/stance 等 */
  fields?: Record<string, string>;
}

export interface CanvasEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  /** 虚线表示推荐/隐含，实线表示用户确认 */
  style: "solid" | "dashed";
  /** 关系类型（知识画布），默认 related */
  relationType?: CanvasRelationType | "";
  /** 自定义关系标签 */
  label?: string;
}

export interface CanvasGroup {
  id: string;
  title: string;
  nodeIds: string[];
}

export interface CanvasDocument {
  id: string;
  /** 画布标题（多画布工作台展示名）；旧数据无此字段时为空串 */
  title?: string;
  /** 主关联笔记 id（兼容旧单笔记绑定） */
  noteId?: string;
  /** 单画布多文件关联：挂载到本画布的全部笔记 id */
  noteIds?: string[];
  coWriteSessionId?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** 分组（P1 图层分组） */
  groups?: CanvasGroup[];
}
