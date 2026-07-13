import { invoke } from "@tauri-apps/api/core";

/** 个人写作基线，与 Rust profile::WritingBaseline 对应 */
export interface StoredWritingBaseline {
  deleteRatio: number;
  cursorPerMin: number;
  pausePerMin: number;
}

/** 历史文档档案，与 Rust profile::HistoricalDoc 对应 */
export interface StoredHistoricalDoc {
  noteId: string;
  title: string;
  summary: string;
  deleteRatio: number;
}

/** 读取个人写作基线，未设置或非 Tauri 环境时返回 null */
export async function getBaseline(): Promise<StoredWritingBaseline | null> {
  try {
    return await invoke<StoredWritingBaseline | null>("profile_get_baseline");
  } catch {
    return null;
  }
}

/** 保存个人写作基线 */
export async function saveBaseline(baseline: StoredWritingBaseline): Promise<void> {
  try {
    await invoke("profile_save_baseline", { baseline });
  } catch {
    // 忽略持久化失败
  }
}

/** 列出历史文档档案（用于复盘 RAG 对比） */
export async function listHistoricalDocs(): Promise<StoredHistoricalDoc[]> {
  try {
    return await invoke<StoredHistoricalDoc[]>("profile_list_historical_docs");
  } catch {
    return [];
  }
}

/** 追加或替换一条历史文档档案（按 noteId 去重） */
export async function addHistoricalDoc(doc: StoredHistoricalDoc): Promise<void> {
  try {
    await invoke("profile_add_historical_doc", { doc });
  } catch {
    // 忽略
  }
}

/** 清空用户画像数据 */
export async function clearProfile(): Promise<void> {
  try {
    await invoke("profile_clear");
  } catch {
    // 忽略
  }
}
