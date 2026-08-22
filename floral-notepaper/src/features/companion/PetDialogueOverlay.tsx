import { useEffect, useRef, useState } from "react";
import { subscribeLive2DSpeak, type Live2DSpeakPayload } from "../live2d/speechBus";
import { subscribeLive2DEmotion } from "../live2d/emotionBus";
import { loadPetMode, subscribePetMode } from "./petModeStore";
import { loadCompanionConfig, subscribeCompanionConfig } from "./companionConfig";

interface BubbleState {
  text: string;
  emotion?: string;
  id: number;
}

/**
 * 桌宠模式气泡层（移植自 LingChat DialogueBox，MIT）。
 *
 * - 仅当桌宠模式开启时渲染（覆盖在主窗口之上）
 * - 订阅 TTS 朗读事件展示最近一句台词；订阅情绪事件切换气泡情绪样式
 * - 点击气泡可隐藏（模拟 LingChat 的点击关闭）
 */
export function PetDialogueOverlay() {
  const [active, setActive] = useState<boolean>(() => loadPetMode().enabled);
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const [hidden, setHidden] = useState(false);
  const [lingchatRenderer, setLingchatRenderer] = useState<boolean>(
    () => loadCompanionConfig().renderer === "lingchat",
  );
  const counterRef = useRef(0);

  useEffect(() => {
    return subscribePetMode((state) => setActive(state.enabled));
  }, []);

  // LingChat 桌宠自带完整三段式 UI（立绘/气泡/输入），让位避免重复气泡
  useEffect(() => {
    return subscribeCompanionConfig((config) => {
      setLingchatRenderer(config.renderer === "lingchat");
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    const unsubscribeSpeak = subscribeLive2DSpeak((payload: Live2DSpeakPayload) => {
      counterRef.current += 1;
      setHidden(false);
      setBubble({ text: payload.text, emotion: payload.emotion, id: counterRef.current });
    });
    const unsubscribeEmotion = subscribeLive2DEmotion(({ mood, label }) => {
      // 情绪标签到达时若正在展示气泡，刷新情绪样式
      setBubble((current) =>
        current ? { ...current, emotion: label ?? mood } : current,
      );
    });
    return () => {
      unsubscribeSpeak();
      unsubscribeEmotion();
    };
  }, [active]);

  if (!active) return null;
  if (lingchatRenderer) return null;
  if (!bubble || hidden) return null;

  return (
    <button
      type="button"
      aria-label="桌宠台词气泡（点击隐藏）"
      onClick={() => setHidden(true)}
      className="pet-dialogue-overlay fixed z-[1000] pointer-events-auto"
    >
      <span className="pet-dialogue-emoji" aria-hidden>
        {emotionGlyph(bubble.emotion)}
      </span>
      <span className="pet-dialogue-text">{bubble.text}</span>
    </button>
  );
}

/** 情绪 → 气泡装饰符号（纯样式，非正式图标） */
function emotionGlyph(emotion?: string): string {
  switch (emotion) {
    case "happy":
    case "高兴":
    case "开心":
      return "☺";
    case "excited":
    case "调皮":
    case "惊讶":
    case "生气":
      return "!";
    case "worried":
    case "担心":
    case "紧张":
    case "害怕":
    case "哭泣":
      return "·";
    case "curious":
    case "疑惑":
    case "认真":
      return "?";
    default:
      return "";
  }
}
