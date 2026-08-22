import { invoke } from "@tauri-apps/api/core";
import { EMOTION_SPEED_ADJUST, type TTSConfig } from "./types";

/**
 * 与 soullink-emotion-sdk 对齐的 TTS 合成端口。
 *
 * SDK 规范：
 * ```ts
 * interface TtsContext { emotion?: string; vad?: Partial<VADVector>; intent?: EmotionIntent | null }
 * interface TtsResult { url?: string; bytes?: ArrayBuffer; durationSec?: number }
 * interface TtsClient { synthesize(text: string, ctx: TtsContext): Promise<TtsResult> }
 * ```
 *
 * `synthesizeWithConfig` 实现同一契约：给定文本与情绪上下文，返回可播放音频 URL。
 * 根据用户配置的引擎分发到不同后端：
 * - gpt-sovits: GPT-SoVITS api_v2 的 `POST /tts`，返回 wav 音频字节
 * - vits: MoeTTS 风格 `GET /tts?text=...&id=<说话人>`，返回音频字节
 * - edge: 浏览器 speechSynthesis（系统 Edge/中文语音），返回基于语音合成的 URL（空则不可用）
 * - openai: `POST {apiUrl}/audio/speech`，返回 mp3 字节
 */

export interface TtsContext {
  emotion?: string;
}

export interface TtsResult {
  url?: string;
  durationSec?: number;
}

/** 按情绪微调语速系数（Elysia 面板提示：开心 +15% / 难过 -15% / 生气 +10% / 平静不变） */
function speedForEmotion(base: number, emotion?: string): number {
  const adjust = EMOTION_SPEED_ADJUST[emotion ?? ""];
  return adjust ? base * adjust : base;
}

/** 解析 GPT-SoVITS 参考音频绝对路径：voice 为文件名时拼接到 refAudioDir */
function resolveRefAudioPath(config: TTSConfig): string {
  const voice = (config.voice ?? "").trim();
  if (!voice) return config.refAudioDir.trim();
  if (voice.includes("/") || voice.includes("\\")) return voice;
  const dir = config.refAudioDir.trim().replace(/[\\/]+$/, "");
  return dir ? `${dir}/${voice}` : voice;
}

async function synthesizeGptSovits(
  text: string,
  config: TTSConfig,
  emotion?: string,
): Promise<TtsResult> {
  const baseUrl = config.apiUrl.replace(/\/+$/, "");
  const body = {
    text,
    text_lang: "auto",
    ref_audio_path: resolveRefAudioPath(config),
    prompt_text: "",
    prompt_lang: "auto",
    top_k: 5,
    top_p: 1,
    temperature: 1,
    text_split_method: "cut5",
    batch_size: 1,
    media_type: "wav",
    streaming_mode: false,
    speed_factor: speedForEmotion(config.defaultSpeed, emotion),
  };
  const response = await fetch(`${baseUrl}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`GPT-SoVITS 合成失败 (${response.status}): ${err}`);
  }
  const blob = await response.blob();
  return { url: URL.createObjectURL(blob) };
}

async function synthesizeVits(text: string, config: TTSConfig): Promise<TtsResult> {
  const baseUrl = config.apiUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({ text });
  const speakerId = (config.voice ?? "").trim() || "0";
  params.set("id", speakerId);
  params.set("format", "wav");
  const response = await fetch(`${baseUrl}/tts?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`VITS 合成失败 (${response.status})`);
  }
  const blob = await response.blob();
  return { url: URL.createObjectURL(blob) };
}

async function synthesizeOpenAI(
  text: string,
  config: TTSConfig,
  emotion?: string,
): Promise<TtsResult> {
  const baseUrl = config.apiUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model.trim() || "tts-1",
      voice: (config.voice ?? "").trim() || "alloy",
      input: text,
      response_format: "mp3",
      speed: speedForEmotion(config.defaultSpeed, emotion),
    }),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`OpenAI TTS 合成失败 (${response.status}): ${err}`);
  }
  const blob = await response.blob();
  return { url: URL.createObjectURL(blob) };
}

/** 阿里云百炼 CosyVoice 非实时合成：POST /services/audio/tts/SpeechSynthesizer，可传复刻音色 ID */
async function synthesizeDashScope(
  text: string,
  config: TTSConfig,
  emotion?: string,
): Promise<TtsResult> {
  const baseUrl = (config.apiUrl || "https://dashscope.aliyuncs.com/api/v1").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/services/audio/tts/SpeechSynthesizer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model.trim() || "cosyvoice-v2",
      input: {
        text,
        voice: (config.voice ?? "").trim() || "longxiaochun",
        format: "wav",
        sample_rate: 24000,
        volume: Math.max(0, Math.min(100, Math.round((config.volume || 1) * 100))),
        rate: speedForEmotion(config.defaultSpeed, emotion),
      },
    }),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`阿里云 CosyVoice 合成失败 (${response.status}): ${err}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await response.json()) as {
      output?: { audio?: { url?: string } };
    };
    const url = json?.output?.audio?.url;
    if (!url) throw new Error("阿里云 CosyVoice 响应中缺少音频 URL");
    return { url };
  }
  const blob = await response.blob();
  return { url: URL.createObjectURL(blob) };
}

/** 浏览器语音合成（Edge / 系统语音），按 voice 名称匹配，缺省选中文女声 */
async function synthesizeEdge(
  text: string,
  config: TTSConfig,
  emotion?: string,
): Promise<TtsResult> {
  const synth = window.speechSynthesis;
  if (!synth) throw new Error("当前环境不支持浏览器语音合成");
  const voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const existing = synth.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    let settled = false;
    const handler = () => {
      if (settled) return;
      settled = true;
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", handler, { once: true });
    setTimeout(handler, 800);
  });
  const wanted = (config.voice ?? "").trim();
  let voice: SpeechSynthesisVoice | undefined;
  if (wanted) {
    voice = voices.find((v) => v.name === wanted) ?? voices.find((v) => v.lang.startsWith("zh"));
  } else {
    voice =
      voices.find((v) => v.lang.startsWith("zh") && /female|xiaoxiao|yaoyao|yayun/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("zh"));
  }
  if (!voice) throw new Error("未找到可用的中文语音");

  return new Promise<TtsResult>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.rate = speedForEmotion(config.defaultSpeed, emotion) || 1;
    utterance.volume = config.volume;
    utterance.onend = () => resolve({});
    utterance.onerror = (event) =>
      reject(new Error(`Edge 语音合成失败: ${event.error ?? "unknown"}`));
    synth.speak(utterance);
  });
}

/**
 * 本地 SBV2 引擎（LingChat 同源，进程内推理）：
 * 调用 `tts_local_synthesize_preview` 返回原始 WAV 字节（不落盘），
 * 前端包成 objectURL 播放。语音需要先下载 DeBERTa + Ling-v2 资产。
 */
async function synthesizeLocal(
  text: string,
  config: TTSConfig,
  emotion?: string,
): Promise<TtsResult> {
  const bytes = await invoke<ArrayBuffer>("tts_local_synthesize_preview", {
    text,
    voiceId: await resolveLocalVoiceId(config.voice),
    lengthScale: speedForEmotion(config.defaultSpeed, emotion),
    sdpRatio: 0.2,
  });
  const blob = new Blob([bytes], { type: "audio/wav" });
  return { url: URL.createObjectURL(blob) };
}

/**
 * 解析本地引擎使用的音色：
 * - 配置的 voice 是已安装音色 → 直接用
 * - 否则回退到第一个已安装音色（防止默认值如 "furina" 未被安装导致合成失败）
 * - 都没有 → 回退 "ling-v2"（后端会再报缺资产）
 */
async function resolveLocalVoiceId(configured: string | undefined): Promise<string> {
  try {
    const { localTtsListInstalled } = await import("./localTtsApi");
    const snapshot = await localTtsListInstalled();
    const voices = snapshot.voices.map((v) => v.voice_id);
    const wanted = (configured ?? "").trim();
    if (wanted && voices.includes(wanted)) return wanted;
    return voices[0] ?? "ling-v2";
  } catch {
    return (configured ?? "").trim() || "ling-v2";
  }
}

/**
 * 统一入口：按配置引擎合成文本 → 返回可播放 URL。
 * 满足 SDK `TtsClient.synthesize(text, ctx)` 契约。
 */
export async function synthesizeWithConfig(
  text: string,
  config: TTSConfig,
  ctx: TtsContext = {},
): Promise<TtsResult> {
  switch (config.engine) {
    case "gpt-sovits":
      return synthesizeGptSovits(text, config, ctx.emotion);
    case "vits":
      return synthesizeVits(text, config);
    case "openai":
      return synthesizeOpenAI(text, config, ctx.emotion);
    case "dashscope":
      return synthesizeDashScope(text, config, ctx.emotion);
    case "edge":
      return synthesizeEdge(text, config);
    case "local":
      return synthesizeLocal(text, config, ctx.emotion);
    default:
      throw new Error(`未支持的 TTS 引擎: ${config.engine}`);
  }
}
