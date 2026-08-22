import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * 本地 SBV2 TTS 资产 API（对应后端 services::tts_local 命令）。
 * 移植自 LingChat（MIT）：按需下载 / 进度事件 / 本地持久化 / 删除。
 */

/** 资产目录条目（后端 registry::AssetEntry） */
export interface LocalTtsAsset {
  id: string;
  kind: "bert" | "voice" | "style_vectors";
  display_name: string;
  language: string;
  size_bytes: number;
  download_url: string;
  source: string;
  voice_id?: string | null;
  bundled_assets?: string[];
}

/** 下载进度事件（后端 DownloadProgress） */
export interface LocalTtsDownloadProgress {
  asset_id: string;
  bytes_done: number;
  total_bytes: number;
  percent: number;
}

/** 已安装资产记录 */
export interface LocalTtsAssetRecord {
  asset_id: string;
  kind: string;
  size_bytes: number;
  path: string;
  language?: string | null;
  display_name?: string | null;
  source?: string | null;
}

/** 已安装声线记录 */
export interface LocalTtsVoiceRecord {
  voice_id: string;
  kind: string; // "sbv2" | "onnx"
  size_bytes: number;
  path: string;
  language?: string | null;
  display_name?: string | null;
  source?: string | null;
  has_style_vectors: boolean;
}

export interface LocalTtsStatus {
  ready: boolean;
  deberta_installed: boolean;
  installed_voice_count: number;
}

export interface LocalTtsInstallSnapshot {
  assets: LocalTtsAssetRecord[];
  voices: LocalTtsVoiceRecord[];
}

export interface LocalTtsImportResult {
  asset_id: string;
  voice_id?: string | null;
  path: string;
  bytes: number;
  message: string;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 当前状态：DeBERTa 是否就绪、声线数量 */
export async function localTtsStatus(): Promise<LocalTtsStatus | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<LocalTtsStatus>("tts_local_status");
  } catch (error) {
    console.warn("[tts-local] 读取状态失败", error);
    return null;
  }
}

/** 资产目录（已隐藏捆绑资产，如 deberta-tokenizer / ling-v2-style） */
export async function localTtsListCatalog(): Promise<LocalTtsAsset[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<LocalTtsAsset[]>("tts_local_list_catalog");
  } catch (error) {
    console.warn("[tts-local] 读取资产目录失败", error);
    return [];
  }
}

/** 已安装资产 + 声线 */
export async function localTtsListInstalled(): Promise<LocalTtsInstallSnapshot> {
  if (!isTauri()) return { assets: [], voices: [] };
  try {
    return await invoke<LocalTtsInstallSnapshot>("tts_local_list_installed");
  } catch (error) {
    console.warn("[tts-local] 读取已安装列表失败", error);
    return { assets: [], voices: [] };
  }
}

/** 触发按需下载（主资产 + 捆绑资产；DeBERTa 就位后自动初始化引擎） */
export async function localTtsDownload(assetId: string): Promise<LocalTtsImportResult[]> {
  return invoke<LocalTtsImportResult[]>("tts_local_download", { assetId });
}

/** 删除声线 */
export async function localTtsDeleteVoice(voiceId: string): Promise<void> {
  await invoke("tts_local_delete_voice", { voiceId });
}

/**
 * 从本地目录离线导入模型资产（跳过网络下载）。
 * 源目录需与本地 TTS 布局一致（assets/deberta + voices/<id>/）。
 * 常用于把 LingChat 已下载的模型直接迁移到花笺。
 */
export async function localTtsImportOffline(
  sourceDir: string,
): Promise<LocalTtsInstallSnapshot | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<LocalTtsInstallSnapshot>("tts_local_import_offline", { sourceDir });
  } catch (error) {
    console.warn("[tts-local] 离线导入失败", error);
    return null;
  }
}

/** 订阅下载进度事件，返回取消订阅函数 */
export async function onLocalTtsDownloadProgress(
  callback: (progress: LocalTtsDownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<LocalTtsDownloadProgress>("tts://download-progress", (event) => {
    callback(event.payload);
  });
}

/** 订阅下载完成事件 */
export async function onLocalTtsDownloadComplete(
  callback: (assetId: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("tts://download-complete", (event) => {
    callback(event.payload);
  });
}
