export const LIVE2D_SPEAK_EVENT = "live2d-speak";

export interface Live2DSpeakPayload {
  text: string;
  emotion?: string;
  durationMs?: number;
}

export function emitLive2DSpeak(payload: Live2DSpeakPayload) {
  const text = payload.text.trim();
  if (!text) return;
  window.dispatchEvent(
    new CustomEvent<Live2DSpeakPayload>(LIVE2D_SPEAK_EVENT, {
      detail: { ...payload, text },
    }),
  );
}

export function subscribeLive2DSpeak(callback: (payload: Live2DSpeakPayload) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Live2DSpeakPayload>).detail;
    if (detail?.text?.trim()) callback(detail);
  };
  window.addEventListener(LIVE2D_SPEAK_EVENT, handler);
  return () => window.removeEventListener(LIVE2D_SPEAK_EVENT, handler);
}
