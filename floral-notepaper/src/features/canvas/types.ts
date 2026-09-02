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

/** Archify 三种图型（architecture / dataflow / lifecycle） */
export type DiagramType = "architecture" | "dataflow" | "lifecycle";

/** Archify Architecture 的最小、与画布无关的输入契约。 */
export interface ArchitectureIR {
  schema_version: 1;
  diagram_type: "architecture";
  meta: { title: string };
  components: ArchitectureComponent[];
  boundaries?: ArchitectureBoundary[];
  connections?: ArchitectureConnection[];
}

export type ArchitectureComponentType =
  | "frontend"
  | "backend"
  | "database"
  | "cloud"
  | "security"
  | "messagebus"
  | "external";

export interface ArchitectureComponent {
  id: string;
  type: ArchitectureComponentType;
  label: string;
  sublabel?: string;
  tag?: string;
  sources?: { path: string; line?: number; end_line?: number; label?: string }[];
  pos?: [number, number];
  size?: [number, number];
}

export interface ArchitectureBoundary {
  kind: "region" | "security-group";
  label: string;
  wraps: string[];
  pad?: number;
}

export interface ArchitectureConnection {
  id?: string;
  from: string;
  to: string;
  label?: string;
  variant?: "default" | "emphasis" | "security" | "dashed";
}

/** Archify Dataflow 输入契约（stages/nodes/flows 三段，与 dataflow.schema.json 最小子集一致）。 */
export interface DataflowIR {
  schema_version: 1;
  diagram_type: "dataflow";
  meta: { title: string };
  /** 2-5 个按序推进的阶段，作为画布分组 */
  stages: { label: string }[];
  /** 至少两个节点；stage/row 决定网格槽位 */
  nodes: {
    id: string;
    type: ArchitectureComponentType;
    label: string;
    sublabel?: string;
    tag?: string;
    stage: number;
    row: number;
    width?: number;
    height?: number;
  }[];
  /** 描述流经数据的连线，label 必填 */
  flows: {
    id?: string;
    from: string;
    to: string;
    label: string;
    variant?: "default" | "emphasis" | "security" | "dashed";
  }[];
}

export type LifecycleStateType =
  | "start"
  | "active"
  | "waiting"
  | "decision"
  | "success"
  | "failure"
  | "neutral"
  | "external";

/** Archify Lifecycle 输入契约（lanes/states/transitions，与 lifecycle.schema.json 最小子集一致）。 */
export interface LifecycleIR {
  schema_version: 1;
  diagram_type: "lifecycle";
  meta: { title: string };
  /** 1-4 条泳道，作为画布分组 */
  lanes: { id: string; label: string }[];
  /** 至少两个状态；col/lane 决定网格槽位 */
  states: {
    id: string;
    type: LifecycleStateType;
    label: string;
    sublabel?: string;
    tag?: string;
    lane: string;
    col: number;
    width?: number;
    height?: number;
  }[];
  /** 状态迁移；label 可选，取 label ?? note 作为边文案 */
  transitions: {
    id?: string;
    from: string;
    to: string;
    label?: string;
    note?: string;
    variant?: "default" | "emphasis" | "security" | "dashed";
  }[];
}

/** 三种 IR 的并集（LLM 输出按 diagram_type 分派） */
export type DiagramIR = ArchitectureIR | DataflowIR | LifecycleIR;

export interface ArchitectureDiagnostic {
  code: string;
  message: string;
  subject: { path: string; identity?: string };
  evidence: Record<string, unknown>;
  supportedFixes: string[];
}

export interface CanvasPatch {
  id: string;
  canvasId: string;
  diagramType: DiagramType;
  sourceDocumentIds: string[];
  sourceNodeIds: string[];
  nodesToAdd: CanvasNode[];
  edgesToAdd: CanvasEdge[];
  groupsToAdd: CanvasGroup[];
  generatedAt: string;
}
