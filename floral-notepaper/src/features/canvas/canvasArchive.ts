import { callChatCompletion, extractJsonArray } from "../cowrite/coWriteAI";
import type { ProviderConfig } from "../settings/types";
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
