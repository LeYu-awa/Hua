import { useCallback, useEffect, useRef, useState } from "react";
import {
  LINGCHAT_EMOTION_ASSETS,
  resolveBubbleAudioUrl,
  resolveBubbleImageUrl,
  resolvePetAvatarFile,
} from "../lingchatEmotion";
import { resolveLingChatAvatarUrl } from "../companionConfig";
import { BAParticles, StarField } from "./LingChatPetEffects";
import "./lingchatPet.css";

/**
 * LingChat 桌宠立绘渲染层（移植自 LingChat components/pet/GameRoleAvatar.vue）。
 * - 圆形头像框 + 情绪立绘切换（预加载后淡入）
 * - 情绪变化触发：动作动画 + 气泡表情（2 秒自动隐藏）+ 气泡音效
 * - 可选粒子特效（StarField / BA）
 */
export interface LingChatPetLayerProps {
  roleFolder: string;
  clothesName: string;
  /** 中文情绪标签（来自【情绪】段或分类器） */
  emotion?: string;
  /** 花笺 6 元 mood 兜底 */
  mood?: string;
  /** 角色名（右上角铭牌） */
  name?: string;
  subTitle?: string;
  /** 视觉缩放（LingChat --pet-ui-scale 的立绘放大倍数） */
  scale?: number;
  /** 角色桌宠缩放（settings.yml scale_p，原版 GameRoleAvatar 对图片做 scale(scaleP)） */
  scaleP?: number;
  /** 角色桌宠位移（settings.yml offset_x_p / offset_y_p） */
  offsetXP?: number;
  offsetYP?: number;
  effect?: "none" | "starfield" | "ba";
  bubbleVolume?: number;
  thinking?: boolean;
  onAvatarClick?: () => void;
}

const BUBBLE_HIDE_MS = 2000;

export function LingChatPetLayer({
  roleFolder,
  clothesName,
  emotion,
  mood,
  name,
  subTitle,
  scale = 1,
  scaleP = 1.6,
  offsetXP = 0,
  offsetYP = 0,
  effect = "none",
  bubbleVolume = 70,
  thinking = false,
  onAvatarClick,
}: LingChatPetLayerProps) {
  const avatarFile = resolvePetAvatarFile(emotion, mood);
  const targetUrl = resolveLingChatAvatarUrl(roleFolder, clothesName, avatarFile);
  const [displayUrl, setDisplayUrl] = useState(targetUrl);
  const [bubble, setBubble] = useState<{ url: string; className: string } | null>(null);
  const [animClass, setAnimClass] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  const loadIdRef = useRef(0);

  // 立绘预加载 + 淡入
  useEffect(() => {
    const currentId = ++loadIdRef.current;
    if (targetUrl === displayUrl) return;
    const image = new Image();
    image.onload = () => {
      if (currentId === loadIdRef.current) setDisplayUrl(targetUrl);
    };
    image.src = targetUrl;
    return () => {
      if (currentId === loadIdRef.current) loadIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUrl]);

  const triggerEmotionFeedback = useCallback(
    (label: string) => {
      const config = LINGCHAT_EMOTION_ASSETS[label];
      if (!config) return;

      if (config.animation && config.animation !== "none") {
        setAnimClass(`lc-anim-${config.animation}`);
      }

      if (config.bubbleImage && config.bubbleImage !== "none") {
        if (bubbleTimerRef.current !== null) {
          window.clearTimeout(bubbleTimerRef.current);
          bubbleTimerRef.current = null;
        }
        setBubble({ url: resolveBubbleImageUrl(config.bubbleImage), className: config.bubbleClass });
        bubbleTimerRef.current = window.setTimeout(() => {
          setBubble(null);
          bubbleTimerRef.current = null;
        }, BUBBLE_HIDE_MS);
      }

      if (config.audio && config.audio !== "none" && audioRef.current) {
        const audio = audioRef.current;
        audio.volume = bubbleVolume / 100;
        audio.src = resolveBubbleAudioUrl(config.audio);
        audio.load();
        audio.play().catch((error) => console.warn("[lingchat-pet] 气泡音效播放失败", error));
      }
    },
    [bubbleVolume],
  );

  // 情绪变化 → 触发立绘/动画/气泡/音效
  useEffect(() => {
    if (!emotion) return;
    triggerEmotionFeedback(emotion);
  }, [emotion, triggerEmotionFeedback]);

  // 思考中反馈（与情绪解耦）
  useEffect(() => {
    if (!thinking) {
      if (bubbleTimerRef.current !== null) {
        window.clearTimeout(bubbleTimerRef.current);
        bubbleTimerRef.current = null;
      }
      setBubble(null);
      return;
    }
    const config = LINGCHAT_EMOTION_ASSETS["AI思考"];
    if (!config) return;
    if (config.bubbleImage && config.bubbleImage !== "none") {
      if (bubbleTimerRef.current !== null) {
        window.clearTimeout(bubbleTimerRef.current);
        bubbleTimerRef.current = null;
      }
      setBubble({ url: resolveBubbleImageUrl(config.bubbleImage), className: config.bubbleClass });
      bubbleTimerRef.current = window.setTimeout(() => {
        setBubble(null);
        bubbleTimerRef.current = null;
      }, BUBBLE_HIDE_MS);
    }
    if (config.audio && config.audio !== "none" && audioRef.current) {
      const audio = audioRef.current;
      audio.volume = bubbleVolume / 100;
      audio.src = resolveBubbleAudioUrl(config.audio);
      audio.load();
      audio.play().catch((error) => console.warn("[lingchat-pet] 思考音效播放失败", error));
    }
  }, [thinking, bubbleVolume]);

  useEffect(() => {
    return () => {
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
    };
  }, []);

  // 原版 GameRoleAvatar：scale(scaleP) translate(offsetXP, offsetYP)，origin-top 保持头部贴近圆框上缘
  const avatarStyle = {
    transform: `scale(${scale * scaleP}) translate(${offsetXP}px, ${offsetYP}px)`,
    transformOrigin: "top",
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center" onClick={onAvatarClick}>
      {/* 右上角角色铭牌 */}
      {(name || subTitle) && (
        <div className="pointer-events-none absolute right-[-16px] top-1 z-50 flex translate-x-4 flex-col items-start opacity-0 transition-all duration-400 group-hover:translate-x-0 group-hover:opacity-100">
          {name && (
            <div className="rounded-br-md rounded-tl-md bg-cyan-500 px-2 py-0.5 text-[10px] font-black italic tracking-wider text-white shadow-sm">
              {name}
            </div>
          )}
          {subTitle && (
            <div className="pl-1 text-xs font-bold uppercase tracking-widest text-cyan-700 drop-shadow-sm dark:text-cyan-300">
              {subTitle}
            </div>
          )}
        </div>
      )}

      {/* 流光圆环 */}
      <div className="lc-pulse-ring pointer-events-none absolute inset-3 rounded-full border-[1.5px] border-cyan-400/20" />
      <div className="lc-sweep-glow pointer-events-none absolute -inset-1 rounded-full drop-shadow-[0_0_6px_rgba(34,211,238,0.4)]" />

      {/* 圆形头像框 */}
      <div className="relative z-10 flex h-full w-full items-center justify-center overflow-hidden rounded-full border-2 border-white/60 bg-white/10 shadow-[0_8px_32px_rgba(0,176,255,0.15)] backdrop-blur-md transition-colors duration-300 dark:border-white/20 dark:bg-black/10">
        {effect === "starfield" && <StarField />}
        {effect === "ba" && <BAParticles />}

        {/* 立绘 */}
        <div
          className={`lc-avatar flex h-full w-full items-center justify-center overflow-hidden rounded-full ${animClass}`}
          onAnimationEnd={() => setAnimClass("")}
        >
          <div className="h-full w-full" style={avatarStyle}>
            <img
              src={displayUrl}
              alt={name ?? "桌宠"}
              className="lc-avatar-container relative h-full w-full rounded-full object-cover object-top transition-opacity duration-300"
              style={{ top: "-10px" }}
              draggable={false}
            />
          </div>
        </div>

        <audio ref={audioRef} />
      </div>

      {/* 情绪气泡表情 */}
      {bubble && (
        <div
          className={`lc-bubble pointer-events-none absolute left-[-2%] top-[-2%] z-[73] h-full w-full origin-bottom-left transition-all duration-300 ${bubble.className}`}
          style={{ backgroundImage: `url(${bubble.url})` }}
        />
      )}
    </div>
  );
}
