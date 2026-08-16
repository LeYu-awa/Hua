import { DEFAULT_TTS, type TTSEngineKey, type TTSConfig } from "./types";

/** 与 ElysiaPage 历史配置共用的 localStorage 键，保证旧配置可无缝迁移 */
export const TTS_CONFIG_STORAGE_KEY = "elysia_tts_config";
const TTS_CONFIG_EVENT = "tts-config-changed";

/** 旧版中文引擎标签 → 新版 key 映射 */
const LEGACY_ENGINE_LABEL_TO_KEY: Record<string, TTSEngineKey> = {
  "GPT-SoVITS (本地)": "gpt-sovits",
  "VITS (本地)": "vits",
  "Edge TTS (云端)": "edge",
  "OpenAI TTS (云端)": "openai",
};

/**
 * 读取 TTS 配置，缺失字段回退默认值。
 * 兼容历史 JSON 结构：旧版 engine 存的是中文标签，这里归一化为新版 key。
 */
export function loadTTSConfig(): TTSConfig {
  try {
    const saved = localStorage.getItem(TTS_CONFIG_STORAGE_KEY);
    if (!saved) return { ...DEFAULT_TTS };
    const parsed = JSON.parse(saved) as Partial<TTSConfig>;
    const engine = LEGACY_ENGINE_LABEL_TO_KEY[String(parsed.engine)] ?? parsed.engine;
    const merged = { ...DEFAULT_TTS, ...parsed, engine: engine ?? DEFAULT_TTS.engine };
    const apiUrl = String(parsed.apiUrl ?? "").trim();
    const isEmptyLegacyGptSovits =
      merged.engine === "gpt-sovits" &&
      (!apiUrl || apiUrl.includes("127.0.0.1:9880")) &&
      !String(parsed.voice ?? "").trim() &&
      !String(parsed.gptWeightsPath ?? "").trim() &&
      !String(parsed.sovitsWeightsPath ?? "").trim() &&
      !String(parsed.refAudioDir ?? "").trim();
    const isCloudOpenAiDefault =
      merged.engine === "openai" &&
      (!apiUrl || apiUrl === "https://api.openai.com/v1") &&
      !String(parsed.apiKey ?? "").trim();
    const isLocalVibeVoiceDefault =
      merged.engine === "openai" &&
      apiUrl.replace(/\/+$/, "") === DEFAULT_TTS.apiUrl.replace(/\/+$/, "") &&
      (parsed.enabled !== true || parsed.autoSpeak !== true);
    return isEmptyLegacyGptSovits || isCloudOpenAiDefault || isLocalVibeVoiceDefault
      ? { ...DEFAULT_TTS }
      : merged;
  } catch {
    return { ...DEFAULT_TTS };
  }
}

export function saveTTSConfig(config: TTSConfig) {
  localStorage.setItem(TTS_CONFIG_STORAGE_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event(TTS_CONFIG_EVENT));
}

/** 订阅 TTS 配置变更（跨窗口/跨组件实时同步） */
export function subscribeTTSConfig(callback: (config: TTSConfig) => void) {
  const emit = () => callback(loadTTSConfig());
  const handleStorage = (event: StorageEvent) => {
    if (event.key === TTS_CONFIG_STORAGE_KEY) emit();
  };
  window.addEventListener(TTS_CONFIG_EVENT, emit);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(TTS_CONFIG_EVENT, emit);
    window.removeEventListener("storage", handleStorage);
  };
}
