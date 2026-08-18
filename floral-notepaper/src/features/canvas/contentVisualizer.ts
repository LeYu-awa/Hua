import type { CanvasEdge, CanvasNode } from "./types";

/**
 * 文章内容智能绘图（项目自身 Agent 模块，不依赖外部 diagram 技能）。
 *
 * 输入：任意笔记选中的文本片段/全文；
 * 输出：一张可直接插入画布的内容结构图（主题节点 + 关键要点节点 + 关系连线）。
 *
 * 解析策略（确定性分析，无外部依赖）：
 * 1. 切分句子，取首句/标题作为主题节点；
 * 2. 按"关键词语气词 + 句长"打分，抽取核心要点作为分支节点；
 * 3. 主题 → 各分支以「支持」关系连线，形成放射状思维导图。
 */

const KEYWORD_HINTS = [
  "因为",
  "所以",
  "因此",
  "但是",
  "然而",
  "首先",
  "其次",
  "最终",
  "结论",
  "关键",
  "重点",
  "核心",
  "最重要",
  "本质",
  "意味着",
  "表明",
  "需要",
  "应该",
  "如何",
  "为什么",
  "建议",
  "注意",
];

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

function sentenceScore(sentence: string): number {
  let score = Math.min(sentence.length, 80);
  for (const kw of KEYWORD_HINTS) {
    if (sentence.includes(kw)) score += 14;
  }
  return score;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function pickTopic(sentences: string[]): string {
  // 主题优先取首个长句（通常是中心论点/导语）
  for (const s of sentences) {
    if (s.length >= 8) return s;
  }
  return sentences[0] ?? "";
}

export interface ContentVisualResult {
  /** 主题节点文本 */
  topic: string;
  /** 关键要点（按重要性降序） */
  keyPoints: string[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * 将文章文本解析为可插入画布的内容可视化结构。
 * @param text  选中的文本片段/全文
 * @param maxPoints 分支节点上限（默认 6）
 */
export function buildContentVisual(text: string, maxPoints = 6): ContentVisualResult {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return {
      topic: truncate(text || "空文本", 60),
      keyPoints: [],
      nodes: [],
      edges: [],
    };
  }

  const topic = pickTopic(sentences);
  const rest = sentences
    .filter((s) => s !== topic)
    .map((s) => ({ s, score: sentenceScore(s) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPoints)
    .map((entry) => entry.s);

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  const rootId = `vis-root-${Date.now()}`;
  nodes.push({
    id: rootId,
    type: "knowledge",
    x: 0,
    y: 0,
    width: 280,
    height: 120,
    text: truncate(topic, 90),
    source: "agent",
    fields: { title: "主题", confidence: "agent 解析" },
  });

  rest.forEach((point, index) => {
    const id = `vis-${Date.now()}-${index}`;
    // 放射状布局：从正上方逆时针铺开，半径随数量自适应
    const count = rest.length;
    const angle = -Math.PI / 2 + (count === 1 ? 0 : (index / (count - 1)) * Math.PI);
    const radius = Math.max(300, 260 + count * 18);
    nodes.push({
      id,
      type: "idea",
      x: Math.round(Math.cos(angle) * radius),
      y: Math.round(Math.sin(angle) * radius),
      width: 240,
      height: 96,
      text: truncate(point, 60),
      source: "agent",
    });
    edges.push({
      id: `vis-edge-${Date.now()}-${index}`,
      fromNodeId: rootId,
      toNodeId: id,
      style: "solid",
      relationType: "supports",
      label: "要点",
    });
  });

  return { topic, keyPoints: rest, nodes, edges };
}

/** 供"整理成文"等场景使用的纯文本版内容骨架（简短摘要要点列表） */
export function summarizeContent(text: string, maxPoints = 5): string {
  const { topic, keyPoints } = buildContentVisual(text, maxPoints);
  const lines = [`主题：${truncate(topic, 60)}`, ...keyPoints.map((p, i) => `${i + 1}. ${truncate(p, 50)}`)];
  return lines.join("\n");
}
