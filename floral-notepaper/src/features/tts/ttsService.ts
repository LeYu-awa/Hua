import { loadTTSConfig } from "./config";
import { synthesizeWithConfig, type TtsContext } from "./ttsClient";

/**
 * 语音播放服务：对应 SDK 的 `session.speak(request)`。
 * - 总开关（config.enabled）关闭时静默跳过
 * - 单例音频播放，重复调用会先停止上一条
 * - 合成失败（本地服务未启动等）返回 false，供 UI 提示
 */

type WebKitWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let currentToken = 0;
let unlockedAudioContext: AudioContext | null = null;
let playbackQueue = Promise.resolve();

async function unlockAudioPlayback() {
  const audioWindow = window as WebKitWindow;
  const AudioContextClass = audioWindow.AudioContext || audioWindow.webkitAudioContext;
  if (!AudioContextClass) return;
  unlockedAudioContext ??= new AudioContextClass();
  if (unlockedAudioContext.state === "suspended") {
    await unlockedAudioContext.resume();
  }
}

function emitSpeechStateChange() {
  window.dispatchEvent(new Event("tts-speech-state-changed"));
}

/**
 * 口型联动（方案 C1：音量包络驱动）：
 * 播放链路走 Web Audio（createMediaElementSource + AnalyserNode），每帧计算
 * RMS 音量 → 低通平滑 → 阈值 + attack/release 包络 → 通过 `tts-mouth-value`
 * 事件广播 0~1 口型值，由 Live2D 层订阅后调用 setMouthValue。
 * 参数见设计方案：RMS 阈值 ~0.02，attack ~30ms，release ~120ms，上限 ~0.9。
 */
const MOUTH_RMS_THRESHOLD = 0.02;
const MOUTH_MAX = 0.9;
const MOUTH_ATTACK_MS = 30;
const MOUTH_RELEASE_MS = 120;
const MOUTH_EMIT_EPSILON = 0.02;

let mouthRafId: number | null = null;

function emitMouthValue(value: number) {
  window.dispatchEvent(new CustomEvent("tts-mouth-value", { detail: value }));
}

function startMouthDriver(audio: HTMLAudioElement, ctx: AudioContext) {
  stopMouthDriver();
  const source = ctx.createMediaElementSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  analyser.connect(ctx.destination);

  const timeData = new Uint8Array(analyser.fftSize);
  let smoothRms = 0;
  let value = 0;
  let lastEmit = 0;
  let lastTs = performance.now();

  const tick = (ts: number) => {
    mouthRafId = requestAnimationFrame(tick);
    const deltaMs = Math.min(Math.max(ts - lastTs, 1), 66);
    lastTs = ts;

    analyser.getByteTimeDomainData(timeData);
    let sum = 0;
    for (let i = 0; i < timeData.length; i += 1) {
      const v = (timeData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / timeData.length);
    // 低通平滑，滤掉音节间的瞬时抖动
    smoothRms += (rms - smoothRms) * 0.5;

    const target = smoothRms > MOUTH_RMS_THRESHOLD ? Math.min(MOUTH_MAX, smoothRms * 5) : 0;

    if (target >= value) {
      // attack：指数逼近
      value += (target - value) * (1 - Math.exp(-deltaMs / MOUTH_ATTACK_MS));
    } else {
      // release：线性衰减
      value = Math.max(0, value - (MOUTH_MAX / MOUTH_RELEASE_MS) * deltaMs);
    }

    // 变化超过 epsilon 才广播，避免 60fps 事件风暴；回落到 0 必须广播一次
    if (Math.abs(value - lastEmit) >= MOUTH_EMIT_EPSILON || value === 0) {
      lastEmit = value;
      emitMouthValue(value);
    }
  };

  mouthRafId = requestAnimationFrame(tick);
}

function stopMouthDriver() {
  if (mouthRafId !== null) {
    cancelAnimationFrame(mouthRafId);
    mouthRafId = null;
  }
  emitMouthValue(0);
}

/** 订阅口型值（0~1，无声时广播 0） */
export function subscribeMouthValue(callback: (value: number) => void) {
  const handler = (event: Event) => callback((event as CustomEvent<number>).detail ?? 0);
  window.addEventListener("tts-mouth-value", handler);
  return () => window.removeEventListener("tts-mouth-value", handler);
}

function waitForAudioStart(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      audio.removeEventListener("playing", handlePlaying);
      audio.removeEventListener("play", handlePlaying);
      audio.removeEventListener("error", handleError);
    };
    const handlePlaying = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const handleError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(audio.error ?? new Error("音频播放失败"));
    };
    audio.addEventListener("playing", handlePlaying, { once: true });
    audio.addEventListener("play", handlePlaying, { once: true });
    audio.addEventListener("error", handleError, { once: true });
  });
}

function waitForAudioEnd(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    if (audio.ended) {
      resolve();
      return;
    }
    const cleanup = () => {
      audio.removeEventListener("ended", handleDone);
      audio.removeEventListener("error", handleDone);
    };
    const handleDone = () => {
      cleanup();
      resolve();
    };
    audio.addEventListener("ended", handleDone, { once: true });
    audio.addEventListener("error", handleDone, { once: true });
  });
}

export function isSpeechPlaying(): boolean {
  return (
    Boolean(currentAudio && !currentAudio.paused && !currentAudio.ended) ||
    Boolean(window.speechSynthesis?.speaking)
  );
}

export function subscribeSpeechState(callback: (playing: boolean) => void) {
  const emit = () => callback(isSpeechPlaying());
  window.addEventListener("tts-speech-state-changed", emit);
  return () => window.removeEventListener("tts-speech-state-changed", emit);
}

export async function unlockSpeechPlayback() {
  try {
    await unlockAudioPlayback();
  } catch (error) {
    console.warn("[tts] 音频播放解锁失败", error);
  }
}

export function stopSpeech() {
  currentToken += 1;
  playbackQueue = Promise.resolve();
  stopMouthDriver();
  try {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  emitSpeechStateChange();
}

/**
 * 播放一段文本语音。
 * @returns 是否真正开始播放（false = 被开关关闭或合成失败）
 */
export async function speakText(
  text: string,
  options: TtsContext & { speed?: number; waitUntilEnded?: boolean; interrupt?: boolean } = {},
): Promise<boolean> {
  const run = () => speakTextNow(text, options);
  if (options.interrupt !== false) return run();
  const queued = playbackQueue.then(run, run);
  playbackQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

async function speakTextNow(
  text: string,
  options: TtsContext & { speed?: number; waitUntilEnded?: boolean; interrupt?: boolean } = {},
): Promise<boolean> {
  const config = loadTTSConfig();
  if (!config.enabled) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  try {
    await unlockAudioPlayback();
    if (options.interrupt !== false) stopSpeech();
    const token = currentToken;
    const result = await synthesizeWithConfig(trimmed, config, { emotion: options.emotion });
    if (token !== currentToken) return false;

    // Edge 引擎直接通过 speechSynthesis 播放，无 URL 可返回
    if (result.url) {
      const audio = new Audio(result.url);
      audio.volume = Math.min(1, Math.max(0, config.volume));
      audio.onplay = emitSpeechStateChange;
      audio.onended = () => {
        stopMouthDriver();
        if (currentAudio === audio) currentAudio = null;
        if (currentUrl === result.url) {
          URL.revokeObjectURL(currentUrl);
          currentUrl = null;
        }
        emitSpeechStateChange();
      };
      audio.onerror = () => {
        stopMouthDriver();
        console.warn("[tts] 音频播放失败", audio.error);
        emitSpeechStateChange();
      };
      currentUrl = result.url;
      currentAudio = audio;
      const started = waitForAudioStart(audio);
      // 口型联动：仅对本地 blob/objectURL 生效（Web Audio 可分析其音量）。
      // 云端 TTS 直出的远程 http(s) URL 若接入 Web Audio，跨域媒体会被静音路由，
      // 因此这类音频直接播放（不启口型），保证能听到声音。
      const isRemoteUrl = /^https?:\/\//i.test(result.url);
      if (unlockedAudioContext && !isRemoteUrl) {
        startMouthDriver(audio, unlockedAudioContext);
      }
      await audio.play();
      await started;
      emitSpeechStateChange();
      if (options.waitUntilEnded) await waitForAudioEnd(audio);
    }
    return true;
  } catch (error) {
    console.warn("[tts] 语音合成或播放失败", error);
    emitSpeechStateChange();
    return false;
  }
}

/** 是否满足自动朗读触发条件 */
export function shouldAutoSpeak(): boolean {
  const config = loadTTSConfig();
  return config.enabled && config.autoSpeak;
}
