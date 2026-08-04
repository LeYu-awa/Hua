import { loadTTSConfig } from "./config";
import { synthesizeWithConfig, type TtsContext } from "./ttsClient";

/**
 * 语音播放服务：对应 SDK 的 `session.speak(request)`。
 * - 总开关（config.enabled）关闭时静默跳过
 * - 单例音频播放，重复调用会先停止上一条
 * - 合成失败（本地服务未启动等）返回 false，供 UI 提示
 */

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

export function stopSpeech() {
  try {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/**
 * 播放一段文本语音。
 * @returns 是否真正开始播放（false = 被开关关闭或合成失败）
 */
export async function speakText(
  text: string,
  options: TtsContext & { speed?: number } = {},
): Promise<boolean> {
  const config = loadTTSConfig();
  if (!config.enabled) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  try {
    stopSpeech();
    const result = await synthesizeWithConfig(trimmed, config, { emotion: options.emotion });

    // Edge 引擎直接通过 speechSynthesis 播放，无 URL 可返回
    if (result.url) {
      const audio = new Audio(result.url);
      audio.volume = Math.min(1, Math.max(0, options.speed ?? config.volume));
      currentUrl = result.url;
      currentAudio = audio;
      void audio.play().catch(() => {
        // 播放失败静默（例如自动播放策略）
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** 是否满足自动朗读触发条件 */
export function shouldAutoSpeak(): boolean {
  const config = loadTTSConfig();
  return config.enabled && config.autoSpeak;
}
