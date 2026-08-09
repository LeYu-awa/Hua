import type { CanvasDocument, CanvasEdge, CanvasNode } from "../types";

/**
 * 场景化快速入门模板（ob-2）
 * 首次进入画布时在侧边栏悬浮展示，一键生成预设卡片组布局 + 对应场景操作教程。
 */

export type TemplateIconKey = "brainstorm" | "project" | "notes";

export interface CanvasTemplate {
  id: string;
  title: string;
  desc: string;
  /** 模板图标 key（渲染端映射为线性 SVG 图标，避免 emoji 风格不统一） */
  icon: TemplateIconKey;
  /** 生成到画布的文档内容（世界坐标） */
  document: CanvasDocument;
  /** 场景操作教程卡片（随模板一起展示） */
  tutorial: string[];
}

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function zone(x: number, y: number, label: string): CanvasNode {
  return {
    id: id("zone"),
    type: "text",
    x,
    y,
    width: 520,
    height: 56,
    text: `◆ ${label}`,
    source: "zone",
    zIndex: -1,
  };
}

function card(x: number, y: number, text: string, opts?: Partial<CanvasNode>): CanvasNode {
  return {
    id: id("card"),
    type: "card",
    x,
    y,
    width: 240,
    height: 120,
    text,
    ...opts,
  };
}

function note(x: number, y: number, text: string): CanvasNode {
  return { id: id("note"), type: "text", x, y, width: 220, height: 90, text };
}

function edge(from: CanvasNode, to: CanvasNode, style: "solid" | "dashed" = "solid"): CanvasEdge {
  return { id: id("edge"), fromNodeId: from.id, toNodeId: to.id, style };
}

/** 头脑风暴：中心议题 + 环绕灵感卡片 + 分区 */
function buildBrainstormingTemplate(): CanvasTemplate {
  const center = card(620, 400, "核心议题：\n（双击填写你的主题）");
  const ideas: CanvasNode[] = [];
  const labels = [
    "想法 1：\n（双击补充灵感）",
    "想法 2：\n（双击补充灵感）",
    "想法 3：\n（双击补充灵感）",
    "想法 4：\n（双击补充灵感）",
    "想法 5：\n（双击补充灵感）",
    "想法 6：\n（双击补充灵感）",
  ];
  const cx = 620 + 120;
  const cy = 400 + 60;
  const radius = 300;
  labels.forEach((text, index) => {
    const angle = (Math.PI * 2 * index) / labels.length - Math.PI / 2;
    ideas.push(card(cx + radius * Math.cos(angle) - 120, cy + radius * Math.sin(angle) - 60, text));
  });
  const zoneNode = zone(240, 120, "头脑风暴区");
  const edges = [
    edge(zoneNode, center, "dashed"),
    ...ideas.map((idea) => edge(center, idea, "dashed")),
  ];
  return {
    id: "brainstorming",
    title: "头脑风暴",
    desc: "中心议题 + 环绕想法卡片，快速收集灵感",
    icon: "brainstorm",
    document: { id: "", nodes: [zoneNode, center, ...ideas], edges },
    tutorial: [
      "双击任意卡片即可填写你的想法。",
      "按住卡片拖动可重新摆放位置；按住空白处拖动可平移画布。",
      "把相似的想法卡片拖到一起，再用「连线」把它们关联起来。",
    ],
  };
}

/** 项目规划：目标/任务/风险/里程碑四象限分区 */
function buildProjectPlanningTemplate(): CanvasTemplate {
  const zoneGoal = zone(80, 80, "目标与范围");
  const zoneTask = zone(640, 80, "任务分解");
  const zoneRisk = zone(80, 420, "风险与依赖");
  const zoneMile = zone(640, 420, "里程碑");
  const nodes: CanvasNode[] = [zoneGoal, zoneTask, zoneRisk, zoneMile];
  const edges: CanvasEdge[] = [
    edge(zoneGoal, zoneTask),
    edge(zoneTask, zoneRisk, "dashed"),
    edge(zoneRisk, zoneMile, "dashed"),
  ];
  nodes.push(card(80, 160, "目标 1：\n（双击填写）"));
  nodes.push(card(360, 160, "目标 2：\n（双击填写）"));
  nodes.push(card(640, 160, "任务 A：\n（双击填写）"));
  nodes.push(card(920, 160, "任务 B：\n（双击填写）"));
  nodes.push(card(80, 500, "风险：\n（双击填写）"));
  nodes.push(card(640, 500, "里程碑 1：\n（双击填写）"));
  return {
    id: "project-planning",
    title: "项目规划",
    desc: "四象限分区，从目标到里程碑一次铺开",
    icon: "project",
    document: { id: "", nodes, edges },
    tutorial: [
      "每个彩色横条是画布分区标记，帮助你按模块组织卡片。",
      "把任务卡片拖进对应分区下方，保持画布井井有条。",
      "点击卡片后使用「连线」标注任务间的依赖关系。",
    ],
  };
}

/** 笔记整理：日常笔记归类分区 */
function buildNotesTemplate(): CanvasTemplate {
  const zoneDaily = zone(80, 80, "日常笔记");
  const zoneIdea = zone(80, 380, "灵感收藏");
  const nodes: CanvasNode[] = [zoneDaily, zoneIdea];
  const edges: CanvasEdge[] = [edge(zoneDaily, zoneIdea, "dashed")];
  nodes.push(note(80, 160, "今天学到：\n把大任务拆成可执行的小卡片"));
  nodes.push(note(360, 160, "待读文章：\n无限画布工具的最佳实践"));
  nodes.push(card(80, 460, "灵感：\n用卡片流代替线性文档"));
  nodes.push(card(360, 460, "灵感：\n分区标记 + 拖拽 = 自由排版"));
  return {
    id: "notes",
    title: "笔记整理",
    desc: "把零散笔记收进分区，灵感随手成卡",
    icon: "notes",
    document: { id: "", nodes, edges },
    tutorial: [
      "用分区标记（横条）给画布划分笔记主题区域。",
      "灵感卡片可随时拖入对应分区，比文件夹更直观。",
      "需要回顾时用 Ctrl + 滚轮缩小视图，一眼看全画布。",
    ],
  };
}

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  buildBrainstormingTemplate(),
  buildProjectPlanningTemplate(),
  buildNotesTemplate(),
];

export function getTemplateById(templateId: string): CanvasTemplate | undefined {
  return CANVAS_TEMPLATES.find((template) => template.id === templateId);
}
