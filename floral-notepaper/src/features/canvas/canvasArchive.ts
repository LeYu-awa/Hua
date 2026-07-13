import { callChatCompletion, extractJsonArray } from "../cowrite/coWriteAI";
import type { ProviderConfig } from "../settings/types";
import { callEmbedding, cosineSimilarity } from "../agent/embeddingService";
import type { CanvasNode } from "./types";

export interface ArchiveSuggestion {
  /** 建议的标签 */
  tag: string;
  /** 属于该标签的节点 ID */
  nodeIds: string[];
  /** 推荐理由 */
  reason: string;
}

const PRESET_TAGS = [
  "需求",
  "资料",
  "草稿",
  "复盘",
  "灵感",
  "待办",
  "人物设定",
  "世界观设定",
  "技术方案",
  "排版",
];

/**
 * 基于画布节点文本生成分组/归档建议。
 * 失败时返回空数组。
 */
export async function generateArchiveSuggestions(
  nodes: CanvasNode[],
  providers: ProviderConfig[],
): Promise<ArchiveSuggestion[]> {
  if (nodes.length < 2 || providers.length === 0) return [];

  const nodeDescriptions = nodes
    .map((n) => `- ID: ${n.id}\n  类型: ${n.type}\n  内容: ${n.text.slice(0, 120)}`)
    .join("\n\n");

  const prompt = `你是温柔的写作伙伴。请阅读以下画布节点，把它们分成 1-3 个语义组。
每组给一个简洁标签（可从 ${PRESET_TAGS.join("、")} 中选，也可自定义），并列出组内节点 ID。
语气中性、不评价用户。
只输出 JSON 数组，不要有多余解释：
[
  {
    "tag": "标签",
    "nodeIds": ["节点ID1", "节点ID2"],
    "reason": "简短温柔的推荐理由"
  }
]

节点列表：
${nodeDescriptions}`;

  try {
    const messages = [
      { role: "system", content: "你是一个温柔、不强迫的写作伙伴。" },
      { role: "user", content: prompt },
    ];
    const text = await callChatCompletion(providers, messages, 0.6);
    const results = extractJsonArray<Partial<ArchiveSuggestion>>(text);

    return results
      .filter((r): r is ArchiveSuggestion =>
        Boolean(r.tag && Array.isArray(r.nodeIds) && r.nodeIds.length > 0 && r.reason),
      )
      .slice(0, 3)
      .map((r) => ({
        tag: r.tag,
        nodeIds: r.nodeIds.filter((id) => nodes.some((n) => n.id === id)),
        reason: r.reason.slice(0, 120),
      }))
      .filter((r) => r.nodeIds.length > 0);
  } catch {
    return [];
  }
}

// ─── 基于 Embedding 的语义归档（issue 场景九） ───

export interface EmbeddingArchiveOptions {
  /** 自定义标签库，默认用 PRESET_TAGS */
  tags?: string[];
  /** 节点归入某标签所需的最低相似度，默认 0.3 */
  minSimilarity?: number;
  /** 一个分组至少包含几个节点才建议，默认 2 */
  minGroupSize?: number;
}

/**
 * 基于 Embedding 的画布卡片语义归档。
 * 每个节点取与标签库中相似度最高的标签，按标签聚合成组。
 * 不依赖 LLM，Embedding 可用即可出结果；失败时返回空数组（可回退到 LLM 版）。
 */
export async function classifyNodesByEmbedding(
  nodes: CanvasNode[],
  providers: ProviderConfig[],
  options: EmbeddingArchiveOptions = {},
): Promise<ArchiveSuggestion[]> {
  const tags = options.tags ?? PRESET_TAGS;
  const minSimilarity = options.minSimilarity ?? 0.3;
  const minGroupSize = options.minGroupSize ?? 2;

  const valid = nodes.filter((n) => n.text.trim().length > 0);
  if (valid.length < minGroupSize || tags.length === 0) return [];

  let nodeVectors: number[][];
  let tagVectors: number[][];
  try {
    nodeVectors = await callEmbedding(providers, valid.map((n) => n.text.slice(0, 300)));
    tagVectors = await callEmbedding(providers, tags);
  } catch {
    return [];
  }

  // 每个节点归入最相似的标签（需达到阈值）
  const groups = new Map<string, string[]>();
  valid.forEach((node, ni) => {
    let bestTag = "";
    let bestSim = minSimilarity;
    tags.forEach((tag, ti) => {
      const sim = cosineSimilarity(nodeVectors[ni], tagVectors[ti]);
      if (sim >= bestSim) {
        bestSim = sim;
        bestTag = tag;
      }
    });
    if (bestTag) {
      const arr = groups.get(bestTag) ?? [];
      arr.push(node.id);
      groups.set(bestTag, arr);
    }
  });

  const suggestions: ArchiveSuggestion[] = [];
  for (const [tag, nodeIds] of groups) {
    if (nodeIds.length >= minGroupSize) {
      suggestions.push({
        tag,
        nodeIds,
        reason: `这几张好像都属于“${tag}”，要不要先收成一个小组？`,
      });
    }
  }
  // 组内节点多者优先
  suggestions.sort((a, b) => b.nodeIds.length - a.nodeIds.length);
  return suggestions.slice(0, 3);
}
