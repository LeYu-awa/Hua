/**
 * 组卡成文目标协议（diary/agent 产出闭环）
 *
 * 画布"整理成文"入口把选中卡片 + 产出类型 + 用户意图编码为 goal，
 * 由 Rust canvas.writeup 技能解析执行（见 orchestrator.rs parse_writeup_goal）。
 * 类型 ∈ {大纲, 初稿, 总结, 设定集}；goal 含"画布/卡片"关键词以命中技能注册表。
 */

export type WriteupKind =
  | "大纲"
  | "初稿"
  | "总结"
  | "设定集"
  | "图文贴"
  | "主题总结"
  | "要点清单";

export interface WriteupKindOption {
  kind: WriteupKind;
  description: string;
}

export const WRITEUP_KINDS: WriteupKindOption[] = [
  { kind: "大纲", description: "结构 + 要点提纲" },
  { kind: "初稿", description: "成段成文的完整文章" },
  { kind: "总结", description: "凝练概括卡片内容" },
  { kind: "设定集", description: "条目化设定整理（人物/世界观/规则）" },
  { kind: "图文贴", description: "小红书/朋友圈图文贴（标题+正文+标签）" },
  { kind: "主题总结", description: "主题知识总结（分点+来源+小结）" },
  { kind: "要点清单", description: "3-8 条可直接引用的要点" },
];

/** 组装组卡成文 goal（与 Rust parse_writeup_goal 的解析格式对齐） */
export function buildWriteupGoal(nodeIds: string[], kind: WriteupKind, intent: string): string {
  const cards = nodeIds.join(",");
  const intentPart = intent.trim() ? `；意图：${intent.trim()}` : "";
  return `把画布上的 ${nodeIds.length} 张卡片整理成文：${kind}${intentPart}；卡片：${cards}`;
}

/** goal 是否命中组卡成文（用于落盘成功横幅判定） */
export function isWriteupGoal(goal: string): boolean {
  return goal.includes("整理成文") && goal.includes("卡片：");
}
