// Embedding 向量服务
// 复用 settings 里的 ProviderConfig，调用 OpenAI 兼容的 /embeddings 接口，
// 把文本转成向量，用于隐含连接、语义空白、共识分歧、聊天沉淀等场景。
// 带内存缓存降低重复调用；无 embedding 供应商时抛 EmbeddingUnavailableError，
// 由上层降级到规则/LLM。

import type { ProviderConfig } from "../settings/types";
import { embeddingCacheGet, embeddingCachePut } from "./embeddingCacheApi";

/** 无可用 embedding 供应商时抛出，供上层捕获后降级 */
export class EmbeddingUnavailableError extends Error {
  constructor(message = "没有可用的 Embedding 供应商，请在设置中配置 embedding 模型") {
    super(message);
    this.name = "EmbeddingUnavailableError";
  }
}

interface EmbeddingApiConfig {
  apiUrl: string;
  apiKey: string;
  modelId: string;
}

/** 从供应商列表中挑选一个 embedding 模型（modelTypes 含 "embedding"） */
function getEmbeddingApiConfig(providers: ProviderConfig[]): EmbeddingApiConfig | null {
  const enabled = providers.filter((p) => p.enabled && p.models.length > 0);
  for (const provider of enabled) {
    const model = provider.models.find((m) =>
      (m.modelTypes ?? []).some((t) => t.toLowerCase() === "embedding"),
    );
    if (!model) continue;
    // OpenAI 兼容惯例：embedding 走 {baseUrl}/embeddings
    const apiUrl = provider.baseUrl.replace(/\/+$/, "") + "/embeddings";
    return { apiUrl, apiKey: provider.apiKey, modelId: model.modelId };
  }
  return null;
}

/** 供应商列表中是否存在可用的 embedding 模型 */
export function hasEmbeddingProvider(providers: ProviderConfig[]): boolean {
  return getEmbeddingApiConfig(providers) !== null;
}

/** 简单稳定哈希，用作缓存 key（非加密用途） */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (h * 33) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

// 进程级内存缓存：modelId + 文本哈希 -> 向量
const cache = new Map<string, number[]>();

function cacheKey(modelId: string, text: string): string {
  return `${modelId}:${hashText(text)}`;
}

/**
 * 批量把文本转成向量。三级缓存：内存 → 本地持久化(Rust) → Embedding API。
 * API 返回的向量会同时回填内存与本地持久化缓存。
 * 失败时抛错（EmbeddingUnavailableError 或网络错误），由上层降级。
 */
export async function callEmbedding(
  providers: ProviderConfig[],
  texts: string[],
): Promise<number[][]> {
  const config = getEmbeddingApiConfig(providers);
  if (!config) throw new EmbeddingUnavailableError();

  const results: (number[] | undefined)[] = Array.from({ length: texts.length }, () => undefined);

  // 1. 内存缓存
  const memMissIdx: number[] = [];
  texts.forEach((text, i) => {
    const cached = cache.get(cacheKey(config.modelId, text));
    if (cached) results[i] = cached;
    else memMissIdx.push(i);
  });

  // 2. 本地持久化缓存（对内存未命中的文本）
  const apiMissIdx: number[] = [];
  if (memMissIdx.length > 0) {
    const keys = memMissIdx.map((i) => hashText(texts[i]));
    const persisted = await embeddingCacheGet(config.modelId, keys);
    memMissIdx.forEach((originalIndex, k) => {
      const vec = persisted[k];
      if (vec) {
        results[originalIndex] = vec;
        cache.set(cacheKey(config.modelId, texts[originalIndex]), vec); // 回填内存
      } else {
        apiMissIdx.push(originalIndex);
      }
    });
  }

  // 3. Embedding API（仍未命中的文本）
  if (apiMissIdx.length > 0) {
    const apiMissTexts = apiMissIdx.map((i) => texts[i]);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: config.modelId, input: apiMissTexts }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding 响应错误 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const items: Array<{ embedding: number[]; index?: number }> = data.data ?? [];
    const toPersist: Array<{ key: string; vector: number[] }> = [];
    items.forEach((item, order) => {
      // OpenAI 返回可能带 index，缺失时按顺序对应
      const missPos = typeof item.index === "number" ? item.index : order;
      const originalIndex = apiMissIdx[missPos];
      const text = apiMissTexts[missPos];
      const vec = item.embedding;
      results[originalIndex] = vec;
      cache.set(cacheKey(config.modelId, text), vec);
      toPersist.push({ key: hashText(text), vector: vec });
    });
    // 4. 回填本地持久化缓存（失败不影响主流程）
    await embeddingCachePut(config.modelId, toPersist);
  }

  return results.map((vec, i) => {
    if (!vec) throw new Error(`Embedding 缺失结果：index ${i}`);
    return vec;
  });
}

/** 便捷：单条文本转向量 */
export async function embedText(providers: ProviderConfig[], text: string): Promise<number[]> {
  const [vec] = await callEmbedding(providers, [text]);
  return vec;
}

/** 余弦相似度，范围约 [-1, 1]；任一向量为零向量时返回 0 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 两点欧氏距离（用于画布空间距离规则） */
export function spatialDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 清空 embedding 缓存（用于测试或手动刷新） */
export function clearEmbeddingCache(): void {
  cache.clear();
}
