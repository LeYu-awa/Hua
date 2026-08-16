// 共识/分歧检测（issue 场景三）
// 对一个议题簇内的观点节点两两计算语义相似度，用规则把作者分成
// 共识组 / 偏离组 / 中间派，并找出可能的"共识桥梁"。
// 产出 show_discussion_panel 指令。语气中立，不站队、不评价对错。

import type { ProviderConfig } from "../settings/types";
import { callEmbedding, cosineSimilarity } from "./embeddingService";
import type { AgentUICommand } from "./signalQueue";

/** 议题簇内的一条观点 */
export interface OpinionNode {
  id: string;
  text: string;
  authorId: string;
}

export type ConsensusStatus = "consensus" | "diverging" | "mixed";

export interface ConsensusResult {
  topic: string;
  /** 讨论整体状态 */
  status: ConsensusStatus;
  /** 分组：共识组 / 异议 / 中间派 */
  groups: Array<{
    label: string;
    color: string;
    userIds: string[];
    nodeIds: string[];
  }>;
  /** 潜在共识桥梁节点 ID（与多个分组都中等相似的折中观点） */
  bridgeNodeIds: string[];
}

export interface ConsensusOptions {
  /** 共识相似度阈值，默认 0.85 */
  consensusThreshold?: number;
  /** 偏离相似度阈值，默认 0.55 */
  divergeThreshold?: number;
  /** 触发分析的最少观点数，默认 3 */
  minOpinions?: number;
}

const GROUP_COLORS = ["#2a6a42", "#b8555a", "#b8860b", "#4a8db7"];

/** 计算相似度矩阵 */
function similarityMatrix(vectors: number[][]): number[][] {
  const n = vectors.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(vectors[i], vectors[j]);
      matrix[i][j] = sim;
      matrix[j][i] = sim;
    }
  }
  return matrix;
}

/**
 * 基于相似度阈值的连通分量聚类：
 * 相似度 >= consensusThreshold 的观点视为同组（并查集）。
 */
function clusterByThreshold(matrix: number[][], threshold: number): number[] {
  const n = matrix.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (matrix[i][j] >= threshold) union(i, j);
    }
  }
  return parent.map((_, i) => find(i));
}

/** 某观点与"非本组"观点的最大相似度落在中间带 => 桥梁 */
function findBridges(
  matrix: number[][],
  clusters: number[],
  divergeThreshold: number,
  consensusThreshold: number,
): number[] {
  const bridges: number[] = [];
  const n = matrix.length;
  for (let i = 0; i < n; i++) {
    let maxCross = 0;
    for (let j = 0; j < n; j++) {
      if (i === j || clusters[j] === clusters[i]) continue;
      maxCross = Math.max(maxCross, matrix[i][j]);
    }
    // 与其他组中等相似（既非对立也非同组）
    if (maxCross >= divergeThreshold && maxCross < consensusThreshold) {
      bridges.push(i);
    }
  }
  return bridges;
}

/**
 * 检测议题簇的共识/分歧状态。
 * 观点不足、无 embedding 供应商或调用失败时返回 null（可降级）。
 */
export async function detectConsensus(
  topic: string,
  opinions: OpinionNode[],
  providers: ProviderConfig[],
  options: ConsensusOptions = {},
): Promise<ConsensusResult | null> {
  const consensusThreshold = options.consensusThreshold ?? 0.85;
  const divergeThreshold = options.divergeThreshold ?? 0.55;
  const minOpinions = options.minOpinions ?? 3;

  const valid = opinions.filter((o) => o.text.trim().length > 0);
  if (valid.length < minOpinions) return null;

  let vectors: number[][];
  try {
    vectors = await callEmbedding(
      providers,
      valid.map((o) => o.text.slice(0, 400)),
    );
  } catch {
    return null;
  }

  const matrix = similarityMatrix(vectors);
  const clusters = clusterByThreshold(matrix, consensusThreshold);

  // 按聚类根聚合成组
  const groupMap = new Map<number, { userIds: Set<string>; nodeIds: string[] }>();
  valid.forEach((o, i) => {
    const root = clusters[i];
    const g = groupMap.get(root) ?? { userIds: new Set<string>(), nodeIds: [] };
    g.userIds.add(o.authorId);
    g.nodeIds.push(o.id);
    groupMap.set(root, g);
  });

  const rawGroups = [...groupMap.values()].sort((a, b) => b.nodeIds.length - a.nodeIds.length);
  const groups = rawGroups.map((g, idx) => ({
    label: idx === 0 ? "主流观点" : `观点组 ${idx + 1}`,
    color: GROUP_COLORS[idx % GROUP_COLORS.length],
    userIds: [...g.userIds],
    nodeIds: g.nodeIds,
  }));

  const bridgeIdx = findBridges(matrix, clusters, divergeThreshold, consensusThreshold);
  const bridgeNodeIds = bridgeIdx.map((i) => valid[i].id);

  // 整体状态：单组=共识；多组且有桥梁=中间派；多组无桥梁=分歧
  let status: ConsensusStatus;
  if (groups.length === 1) status = "consensus";
  else if (bridgeNodeIds.length > 0) status = "mixed";
  else status = "diverging";

  return { topic, status, groups, bridgeNodeIds };
}

/** 把共识结果转成可分发的 UI 指令 */
export function toDiscussionCommand(result: ConsensusResult): AgentUICommand {
  return {
    type: "show_discussion_panel",
    topic: result.topic,
    groups: result.groups.map((g) => ({
      label: g.label,
      userIds: g.userIds,
      color: g.color,
    })),
    bridgeNodeIds: result.bridgeNodeIds,
  };
}
