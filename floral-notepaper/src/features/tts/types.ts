/**
 * TTS（语音合成）配置类型与常量。
 *
 * 设计对齐 soullink-emotion-sdk 的 TTS 端口规范：
 * - `TtsClient.synthesize(text, ctx): Promise<{ url?, bytes?, durationSec? }>`
 * - `session.speak({ text, emotion, ... })` 触发合成与播放
 * 本模块的 `synthesizeWithConfig` 即为该端口的本地实现，`speakText` 对应 `session.speak`。
 */

export type TTSEngineKey =
  | "gpt-sovits"
  | "vits"
  | "edge"
  | "openai"
  | "dashscope";

export interface TTSConfig {
  /** 引擎标识（对应 TTSEngineKey） */
  engine: TTSEngineKey;
  /** 模型标识：GPT-SoVITS / VITS 显示加载的权重名，Edge 为空，OpenAI 为 tts-1 */
  model: string;
  /** 本地 / 云端 HTTP API 地址 */
  apiUrl: string;
  /** GPT-SoVITS GPT 权重 (.ckpt) */
  gptWeightsPath: string;
  /** GPT-SoVITS SoVITS 权重 (.pth) */
  sovitsWeightsPath: string;
  /** GPT-SoVITS 参考音频目录 */
  refAudioDir: string;
  /** 默认语速 0.5..2.0 */
  defaultSpeed: number;
  /** 音量 0..1 */
  volume: number;
  /**
   * 音色：
   * - gpt-sovits: 参考音频文件名（位于 refAudioDir 下）
   * - vits: 说话人 id
   * - edge: 浏览器语音名（留空自动选择中文女声）
   * - openai: 标准音色名（alloy/echo/fable/onyx/nova/shimmer）
   */
  voice: string;
  /** OpenAI TTS 的 API Key（仅云端引擎使用） */
  apiKey: string;
  /** 总开关：false 时 speakText 直接静默跳过 */
  enabled: boolean;
  /** 触发条件：AI 助手回复后自动朗读 */
  autoSpeak: boolean;
}

export const TTS_ENGINE_OPTIONS: Array<{ key: TTSEngineKey; label: string }> = [
  { key: "gpt-sovits", label: "GPT-SoVITS (本地)" },
  { key: "vits", label: "VITS (本地)" },
  { key: "edge", label: "Edge TTS (云端)" },
  { key: "openai", label: "OpenAI 兼容 / VibeVoice (本地)" },
  { key: "dashscope", label: "阿里云 CosyVoice (云端)" },
];

export const OPENAI_TTS_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
];

export const DEFAULT_TTS: TTSConfig = {
  engine: "openai",
  model: "tts-1",
  apiUrl: "http://127.0.0.1:8001/v1",
  gptWeightsPath: "",
  sovitsWeightsPath: "",
  refAudioDir: "",
  defaultSpeed: 1.1,
  volume: 0.8,
  voice: "furina",
  apiKey: "",
  enabled: true,
  autoSpeak: true,
};

/** 情绪 → 语速微调系数（与 Elysia 面板提示一致） */
export const EMOTION_SPEED_ADJUST: Record<string, number> = {
  happy: 1.15,
  excited: 1.15,
  sad: 0.85,
  angry: 1.1,
};
