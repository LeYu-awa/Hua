// 语义空白区识别（issue 场景二）
// 画布稳定后，把全部节点转成向量，对预设"视角库"逐一做语义检索，
// 找出覆盖度极低或为零的视角，提醒用户可能缺失的讨论角度。
// 语气建设性、不指责；无 Embedding 供应商时返回 null（可降级）。

import type { ProviderConfig } from "../settings/types";
import { callEmbedding, cosineSimilarity } from "./embeddingService";
import { clamp } from "./ruleEngine";

/** 一个讨论视角：标签 + 用于语义检索的描述文本 */
export interface Perspective {
  label: string;
  description: string;
}

/** 默认视角库，可被项目自定义覆盖 */
export const DEFAULT_PERSPECTIVES: Perspective[] = [
  { label: "用户接受度", description: "用户是否愿意使用、接受这个方案，用户的真实需求" },
  { label: "用户操作流程", description: "用户实际怎么一步步操作、使用流程、交互路径" },
  { label: "用户体验反馈", description: "用户使用后的感受、体验、情绪、满意度反馈" },
  { label: "风险", description: "潜在风险、隐患、失败可能、边界情况、异常处理" },
  { label: "商业价值", description: "商业模式、收益、成本回报、市场价值、盈利" },
  { label: "技术实现", description: "技术方案、架构、实现细节、工程可行性" },
  { label: "成本估算", description: "开发成本、资源投入、人力、预算" },
  { label: "排期计划", description: "时间安排、里程碑、进度、交付节奏" },
];

/** 单个视角的覆盖情况 */
export interface PerspectiveCoverage {
  label: string;
  /** 该视角在画布中的最大语义相似度 0-1 */
  coverage: number;
  /** 是否判定为缺失 */
  missing: boolean;
}

export interface SemanticGapResult {
  /** 缺失视角标签 */
  missingPerspectives: string[];
  /** 全部视角覆盖度明细 */
  coverages: PerspectiveCoverage[];
  /** 建设性提醒文案 */
  message: string;
  /** 建议放置占位节点的区域坐标 */
  areaHint: { x: number; y: number };
}

export interface SemanticGapOptions {
  /** 覆盖度阈值，低于此值视为缺失，默认 0.35 */
  coverageThreshold?: number;
  /** 触发分析所需的最少节点数，默认 5 */
  minNodes?: number;
  /** 自定义视角库 */
  perspectives?: Perspective[];
  /** 最多提示的缺失视角数，默认 3 */
  maxMissing?: number;
}

interface GapNode {
  id: string;
  text: string;
  x: number;
  y: number;
}

/** 取节点包围盒右侧的空白点作为占位建议位置 */
function suggestArea(nodes: GapNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let sumY = 0;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    sumY += n.y;
  }
  return { x: maxX + 240, y: sumY / nodes.length };
}

function buildMessage(missing: string[]): string {
  if (missing.length === 0) return "";
  const first = missing[0];
  return `现在其他角度聊得挺清楚了，好像还可以补一小块“${first}”的讨论。`;
}

/**
 * 检测画布语义空白区。
 * 节点数不足、无 Embedding 供应商或调用失败时返回 null。
 * 无缺失视角时 missingPerspectives 为空数组、message 为空串。
 */
export async function detectSemanticGaps(
  nodes: GapNode[],
  providers: ProviderConfig[],
  options: SemanticGapOptions = {},
): Promise<SemanticGapResult | null> {
  const coverageThreshold = options.coverageThreshold ?? 0.35;
  const minNodes = options.minNodes ?? 5;
  const perspectives = options.perspectives ?? DEFAULT_PERSPECTIVES;
  const maxMissing = options.maxMissing ?? 3;

  const valid = nodes.filter((n) => n.text.trim().length > 0);
  if (valid.length < minNodes) return null;

  let nodeVectors: number[][];
  let perspectiveVectors: number[][];
  try {
    nodeVectors = await callEmbedding(
      providers,
      valid.map((n) => n.text.slice(0, 500)),
    );
    perspectiveVectors = await callEmbedding(
      providers,
      perspectives.map((p) => `${p.label}：${p.description}`),
    );
  } catch {
    return null;
  }

  const coverages: PerspectiveCoverage[] = perspectives.map((p, pi) => {
    let maxSim = 0;
    for (const nodeVec of nodeVectors) {
      maxSim = Math.max(maxSim, cosineSimilarity(perspectiveVectors[pi], nodeVec));
    }
    return {
      label: p.label,
      coverage: clamp(maxSim, 0, 1),
      missing: maxSim < coverageThreshold,
    };
  });

  const missingPerspectives = coverages
    .filter((c) => c.missing)
    .sort((a, b) => a.coverage - b.coverage)
    .slice(0, maxMissing)
    .map((c) => c.label);

  return {
    missingPerspectives,
    coverages,
    message: buildMessage(missingPerspectives),
    areaHint: suggestArea(valid),
  };
}
