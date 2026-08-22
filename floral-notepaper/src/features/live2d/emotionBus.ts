import type { SoullinkLocalMood } from "./soullinkLocalEngine";

export const LIVE2D_EMOTION_EVENT = "live2d-emotion";

export interface Live2DEmotionPayload {
  /** 花笺 6 元情绪（驱动 Soullink 引擎 / Live2D 表情） */
  mood: SoullinkLocalMood;
  /** 0-1 强度 */
  intensity: number;
  /** 原始情绪标签（LingChat 19 类中文标签，如 开心/生气/难过） */
  label?: string;
  /** 来源：tag=流式回复中的【情绪】段；classifier=ONNX 19 类分类器预测 */
  source?: "tag" | "classifier";
}

export function emitLive2DEmotion(payload: Live2DEmotionPayload) {
  window.dispatchEvent(
    new CustomEvent<Live2DEmotionPayload>(LIVE2D_EMOTION_EVENT, { detail: payload }),
  );
}

export function subscribeLive2DEmotion(
  callback: (payload: Live2DEmotionPayload) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Live2DEmotionPayload>).detail;
    if (detail?.mood) callback(detail);
  };
  window.addEventListener(LIVE2D_EMOTION_EVENT, handler);
  return () => window.removeEventListener(LIVE2D_EMOTION_EVENT, handler);
}
