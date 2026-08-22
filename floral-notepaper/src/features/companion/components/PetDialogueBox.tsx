import { useEffect, useRef, useState } from "react";
import { petEmotionLabel } from "../lingchatEmotion";

/**
 * LingChat 桌宠对话气泡（移植自 LingChat components/pet/DialogueBox.vue）。
 * - 深色毛玻璃 + 底部小尾巴 + 顶部情绪名（青色斜体）
 * - 打字机逐字显示
 * - 点击气泡可触发「继续下一句」
 */
export interface PetDialogueBoxProps {
  text: string;
  /** 中文情绪名（气泡顶部青色行） */
  emotion?: string;
  /** 花笺 mood 兜底（转中文名） */
  mood?: string;
  /** 打字机速度（字符/秒） */
  speed?: number;
  visible?: boolean;
  /** 缩放系数（LingChat 用 --pet-ui-scale） */
  scale?: number;
  /** 最大高度 px */
  maxHeight?: number;
  onContinue?: () => void;
}

export function PetDialogueBox({
  text,
  emotion,
  mood,
  speed = 30,
  visible = true,
  scale = 1,
  maxHeight = 200,
  onContinue,
}: PetDialogueBoxProps) {
  const [typed, setTyped] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    setTyped("");
    if (!text || !visible) return;
    const intervalMs = Math.max(16, Math.round(1000 / Math.max(1, speed)));
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTyped(textRef.current.slice(0, index));
      if (bodyRef.current) {
        bodyRef.current.textContent = textRef.current.slice(0, index);
      }
      if (index >= textRef.current.length) window.clearInterval(timer);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [text, visible, speed]);

  const label = petEmotionLabel(emotion, mood);
  const scaleStyle = {
    "--pet-ui-scale": String(scale),
  } as React.CSSProperties;

  return (
    <div
      onClick={visible ? onContinue : undefined}
      className={`relative z-30 flex w-full cursor-pointer items-center justify-center transition-all duration-300 ease-out ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      }`}
      style={scaleStyle}
    >
      <div
        className="relative w-[85%] rounded-[calc(20px*var(--pet-ui-scale,1))] border border-white/10 bg-neutral-950/50 px-[calc(18px*var(--pet-ui-scale,1))] py-[calc(6px*var(--pet-ui-scale,1))] text-white backdrop-blur-xl backdrop-saturate-200 transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.02] hover:border-white/20 hover:bg-neutral-950/65 [text-shadow:0_1px_4px_rgba(0,0,0,0.5)]"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        {/* 底部小尾巴（双层三角） */}
        <div className="absolute -bottom-2.5 left-1/2 h-0 w-0 -translate-x-1/2 border-l-[10px] border-r-[10px] border-t-[10px] border-t-white/10 border-l-transparent border-r-transparent drop-shadow-md" />
        <div className="absolute -bottom-2 left-1/2 h-0 w-0 -translate-x-1/2 border-l-8 border-r-8 border-t-8 border-t-white/10 border-l-transparent border-r-transparent" />

        {label && (
          <div className="mb-0.5 truncate text-[calc(12px*var(--pet-ui-scale,1))] font-semibold italic tracking-wider text-cyan-400 drop-shadow-[0_1px_4px_rgba(0,176,255,0.5)]">
            {label}
          </div>
        )}

        <div
          ref={bodyRef}
          className="overflow-y-auto whitespace-pre-line text-[calc(15px*var(--pet-ui-scale,1))] font-medium leading-snug [text-shadow:0_0_3px_rgba(0,0,0,0.9),0_1px_4px_rgba(0,0,0,0.5)]"
          style={{ maxHeight: `${maxHeight - 52}px` }}
        />
        {/* 无障碍文本镜像（typed 用于测试/可读性） */}
        <span className="sr-only">{typed}</span>
      </div>
    </div>
  );
}
