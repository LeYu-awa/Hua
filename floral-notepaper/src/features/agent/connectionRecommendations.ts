import { callChatCompletion, extractJsonArray } from "../cowrite/coWriteAI";
import type { ProviderConfig } from "../settings/types";
import { callEmbedding, cosineSimilarity, spatialDistance } from "./embeddingService";
import { pairKey } from "./ruleEngine";

export interface ConnectionRecommendation {
  /** 推荐连向的笔记/节点 ID */
  targetId: string;
  /** 目标标题 */
  targetTitle: string;
  /** 推荐理由 */
  reason: string;
  /** 相关引文 */
  quote?: string;
}

interface CandidateNote {
  id: string;
  title: string;
  preview: string;
}

/**
 * 基于当前笔记与候选笔记列表，调用 LLM 生成隐含连接推荐。
 * 失败时返回空数组，不抛错。
 */
export async function generateConnectionRecommendations(
  currentNoteId: string,
  currentTitle: string,
  currentContent: string,
  candidates: CandidateNote[],
  providers: ProviderConfig[],
): Promise<ConnectionRecommendation[]> {
  if (!currentContent && !currentTitle) return [];
  if (candidates.length === 0) return [];

  const filtered = candidates.filter((c) => c.id !== currentNoteId).slice(0, 20);
  if (filtered.length === 0) return [];

  const prompt = `你是温柔的写作伙伴。请阅读当前笔记，并从候选笔记中找出 1-3 条与当前笔记语义相关的连接推荐。
推荐理由必须中性、不评价用户，用"好像都在聊……""也许可以先轻轻连起来看看"等温柔表达。
只输出 JSON 数组，不要有多余解释：
[
  {
    "targetId": "候选笔记ID",
    "targetTitle": "候选笔记标题",
    "reason": "简短温柔的推荐理由",
    "quote": "候选笔记中相关的只言片语（可选）"
  }
]

当前笔记《${currentTitle}》：
${currentContent.slice(0, 1500)}

候选笔记：
${filtered.map((c) => `- ID: ${c.id}\n  标题: ${c.title}\n  摘要: ${c.preview.slice(0, 200)}`).join("\n\n")}`;

  try {
    const messages = [
      { role: "system", content: "你是一个温柔、不强迫的写作伙伴。" },
      { role: "user", content: prompt },
    ];
    const text = await callChatCompletion(providers, messages, 0.6);
    const results = extractJsonArray<Partial<ConnectionRecommendation>>(text);

    return results
      .filter((r): r is ConnectionRecommendation =>
        Boolean(r.targetId && r.targetTitle && r.reason),
      )
      .slice(0, 3)
      .map((r) => ({
        targetId: r.targetId,
        targetTitle: r.targetTitle,
        reason: sanitizeReason(r.reason),
        quote: r.quote,
      }));
  } catch {
    return [];
  }
}

function sanitizeReason(reason: string): string {
  return reason
    .replace(/你应该|必须|效率低|遗漏|错误|差|糟糕/g, "")
    .trim()
    .slice(0, 120);
}

// ─── 基于 Embedding 的隐含连接（场景一） ───

/** 带坐标与文本的画布节点，用于隐含连接分析 */
export interface ConnectionCandidateNode {
  id: string;
  text: string;
  x: number;
  y: number;
}

/** 已存在的显式连线，用于去重 */
export interface ExistingEdge {
  fromNodeId: string;
  toNodeId: string;
}

/** 一条隐含连接推荐 */
export interface ImplicitConnection {
  sourceId: string;
  targetId: string;
  /** 语义相似度 0-1 */
  similarity: number;
  /** 空间距离 px */
  distance: number;
  /** 温柔的提示文案 */
  message: string;
}

export interface ImplicitConnectionOptions {
  /** 相似度阈值，默认 0.7 */
  similarityThreshold?: number;
  /** 空间距离阈值（px），默认 100 */
  minDistance?: number;
  /** 最多返回条数，默认 3 */
  maxResults?: number;
}

function connectionMessage(): string {
  return "这两块好像都在聊同一件事，要不要先轻轻连起来看看？";
}

/**
 * 基于 Embedding 的隐含连接发现（issue 场景一）。
 * 规则：语义相似度 > 阈值 且 空间距离 > 阈值 且 两节点间无显式连线。
 * 文案用中性模板，不依赖 LLM，保证 Embedding 可用即可降级出结果。
 * 无 Embedding 供应商或调用失败时返回空数组（由调用方回退到 LLM 版）。
 */
export async function findImplicitConnections(
  nodes: ConnectionCandidateNode[],
  existingEdges: ExistingEdge[],
  providers: ProviderConfig[],
  options: ImplicitConnectionOptions = {},
): Promise<ImplicitConnection[]> {
  const similarityThreshold = options.similarityThreshold ?? 0.7;
  const minDistance = options.minDistance ?? 100;
  const maxResults = options.maxResults ?? 3;

  const valid = nodes.filter((n) => n.text.trim().length > 0);
  if (valid.length < 2) return [];

  const existing = new Set(existingEdges.map((e) => pairKey(e.fromNodeId, e.toNodeId)));

  let vectors: number[][];
  try {
    vectors = await callEmbedding(
      providers,
      valid.map((n) => n.text.slice(0, 500)),
    );
  } catch {
    return [];
  }

  const found: ImplicitConnection[] = [];
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i];
      const b = valid[j];
      if (existing.has(pairKey(a.id, b.id))) continue;

      const similarity = cosineSimilarity(vectors[i], vectors[j]);
      if (similarity < similarityThreshold) continue;

      const distance = spatialDistance(a, b);
      if (distance < minDistance) continue;

      found.push({
        sourceId: a.id,
        targetId: b.id,
        similarity,
        distance,
        message: connectionMessage(),
      });
    }
  }

  // 相似度高者优先
  found.sort((x, y) => y.similarity - x.similarity);
  return found.slice(0, maxResults);
}
