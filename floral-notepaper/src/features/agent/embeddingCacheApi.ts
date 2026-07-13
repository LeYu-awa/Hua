import { invoke } from "@tauri-apps/api/core";

/** 一条 embedding 缓存条目 */
export interface EmbeddingCacheEntry {
  key: string;
  vector: number[];
}

/**
 * 按 key 批量读取本地 embedding 缓存，未命中位置为 null，顺序与 keys 对应。
 * 非 Tauri 环境（或 IPC 失败）时返回全 null，由上层照常请求 API。
 */
export async function embeddingCacheGet(
  model: string,
  keys: string[],
): Promise<(number[] | null)[]> {
  try {
    const result = await invoke<(number[] | null)[]>("embedding_cache_get", { model, keys });
    return result;
  } catch {
    return keys.map(() => null);
  }
}

/** 写入若干缓存条目。失败时静默忽略（缓存是可选优化）。 */
export async function embeddingCachePut(
  model: string,
  entries: EmbeddingCacheEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await invoke("embedding_cache_put", { model, entries });
  } catch {
    // 缓存写入失败不影响主流程
  }
}

/** 清空本地 embedding 缓存 */
export async function embeddingCacheClear(): Promise<void> {
  try {
    await invoke("embedding_cache_clear");
  } catch {
    // 忽略
  }
}
