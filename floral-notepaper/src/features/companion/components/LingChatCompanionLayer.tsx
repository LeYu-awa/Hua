import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEventHandler,
} from "react";
import {
  BUILT_IN_LINGCHAT_PET_OPTIONS,
  COMPANION_MAX_SCALE,
  COMPANION_MIN_SCALE,
  loadCompanionConfig,
  saveCompanionPosition,
  subscribeCompanionConfig,
} from "../companionConfig";
import type { CompanionConfig } from "../types";
import { loadPetMode, subscribePetMode } from "../petModeStore";
import { loadProactiveConfig, PET_PROACTIVE_GREETINGS } from "../lingchatProactive";
import { emitLive2DSpeak, subscribeLive2DSpeak } from "../../live2d/speechBus";
import { LingChatPetLayer } from "./LingChatPetLayer";
import { PetDialogueBox } from "./PetDialogueBox";
import { subscribeLive2DEmotion } from "../../live2d/emotionBus";
import { emotionTagToMood, splitEmotionSegments } from "../../live2d/emotionMapping";
import type { SoullinkLocalMood } from "../../live2d/soullinkLocalEngine";
import type { ProviderConfig } from "../../settings/types";
import { shouldAutoSpeak, speakText, unlockSpeechPlayback } from "../../tts";

interface LingChatCompanionLayerProps {
  surface?: "embedded" | "floating";
  providers?: ProviderConfig[];
}

/** LingChat 桌宠窗口三段比例：立绘 240 + 气泡 200 + 输入 45（× scale） */
const PET_AVATAR_SIZE = 240;
const PET_DIALOGUE_HEIGHT = 200;
const PET_INPUT_HEIGHT = 45;
const PET_SAFE_MARGIN = 8;
const PET_LONG_PRESS_MS = 50;
const PET_CHAT_STORAGE_KEY = "lingchat_pet_chat_messages";
const PET_CHAT_CONTEXT_LIMIT = 10;

/**
 * LingChat 桌宠完整渲染层（移植自 LingChat PetMode.vue + components/pet/*，MIT）。
 *
 * 三段式窗口布局（宽度 240×scale，高度 (240+200+45)×scale）：
 *   立绘区（GameRoleAvatar）→ 台词气泡（DialogueBox）→ 输入条（ChatInput）
 *
 * - 渲染门控：仅当 config.renderer === "lingchat" 且 enabled/visible 时渲染，
 *   其余情况返回 null（与 Live2DCompanionLayer 互斥，可无条件挂载于 AppShell）。
 * - 情绪驱动：订阅 live2d-emotion（SidebarChat 解析【情绪】标签 / 分类器）→ 切立绘；
 *   订阅 live2d-speak（SidebarChat 朗读）→ 气泡打字机展示。
 * - 交互：点按立绘聚焦输入，长按拖动（嵌入式），输入回车请求 AI 回复并朗读。
 */
export function LingChatCompanionLayer({
  surface = "embedded",
  providers = [],
}: LingChatCompanionLayerProps) {
  const configRef = useRef<CompanionConfig>(loadCompanionConfig());
  const [config, setConfig] = useState<CompanionConfig>(loadCompanionConfig());
  const [petMode, setPetModeState] = useState<boolean>(() => loadPetMode().enabled);
  const [emotion, setEmotion] = useState<string | undefined>();
  const [mood, setMood] = useState<SoullinkLocalMood | undefined>();
  const [dialogue, setDialogue] = useState<PetDialogueState | null>(null);
  const dialogueIdRef = useRef(0);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<PetChatMessage[]>(loadPetChatMessages);
  const [dragging, setDragging] = useState(false);
  const [showDragHandle, setShowDragHandle] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const layerRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<LingChatDragState | null>(null);
  const dragTimerRef = useRef<number | null>(null);
  const dragHandleTimerRef = useRef<number | null>(null);
  const latestPositionRef = useRef(config.position);
  const dragIntentRef = useRef<"idle" | "pressing" | "dragging">("idle");

  const enabledProviders = useMemo(
    () => providers.filter((provider) => provider.enabled && provider.models.length > 0),
    [providers],
  );
  const activeProvider = useMemo(
    () =>
      enabledProviders.find((provider) => provider.name.toLowerCase().includes("deepseek")) ??
      enabledProviders[0] ??
      null,
    [enabledProviders],
  );
  const activeModel = activeProvider?.models[0] ?? null;
  // 嵌入式层仅在非浮动模式激活（lingchat 合并逻辑强制 mode=embedded）
  const isSurfaceActive =
    surface === "floating" ? config.mode === "floating" : config.mode !== "floating";

  const roleOption = BUILT_IN_LINGCHAT_PET_OPTIONS.find((option) => option.skinId === config.skinId);
  const pet = config.pet;
  const petScale = clampScale(config.scale);

  const showDialogue = useCallback((text: string, emotionLabel?: string) => {
    dialogueIdRef.current += 1;
    setDialogue({ text, emotion: emotionLabel, id: dialogueIdRef.current });
  }, []);

  useEffect(() => {
    latestPositionRef.current = config.position;
  }, [config.position]);

  useEffect(() => {
    return subscribeCompanionConfig((next) => {
      configRef.current = next;
      setConfig(next);
    });
  }, [surface]);

  useEffect(() => {
    return subscribePetMode((state) => setPetModeState(state.enabled));
  }, []);

  // 情绪驱动：SidebarChat / Agent 事件 → 立绘 + 气泡情绪切换
  useEffect(() => {
    return subscribeLive2DEmotion(({ mood: nextMood, label }) => {
      setMood(nextMood);
      if (label) setEmotion(label);
    });
  }, []);

  // 台词驱动：SidebarChat 朗读回复 → 气泡打字机展示
  useEffect(() => {
    return subscribeLive2DSpeak((payload) => {
      showDialogue(payload.text, payload.emotion);
    });
  }, [showDialogue]);

  // 主动系统（移植自 LingChat WindowTab）：按配置间隔广播问候台词
  useEffect(() => {
    let lastFiredAt = Date.now();
    const timer = window.setInterval(() => {
      const proactive = loadProactiveConfig();
      if (!proactive.enabled) return;
      const now = Date.now();
      if (now - lastFiredAt < proactive.intervalMin * 60_000) return;
      lastFiredAt = now;
      const greeting =
        PET_PROACTIVE_GREETINGS[
          Math.floor(Math.random() * PET_PROACTIVE_GREETINGS.length)
        ];
      emitLive2DSpeak({ text: greeting.text, emotion: greeting.emotion });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (dragTimerRef.current !== null) window.clearTimeout(dragTimerRef.current);
      if (dragHandleTimerRef.current !== null) window.clearTimeout(dragHandleTimerRef.current);
      dragIntentRef.current = "idle";
    };
  }, []);

  const showDragHandleBriefly = useCallback(() => {
    setShowDragHandle(true);
    if (dragHandleTimerRef.current !== null) {
      window.clearTimeout(dragHandleTimerRef.current);
    }
    dragHandleTimerRef.current = window.setTimeout(() => {
      dragHandleTimerRef.current = null;
      setShowDragHandle(false);
    }, 2000);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const layer = layerRef.current;
      if (!layer || dragging || petMode) return;
      const rect = layer.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (inside) showDragHandleBriefly();
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [dragging, petMode, showDragHandleBriefly]);

  // ---- 拖拽（嵌入式）：长按 50ms 进入拖动，短按聚焦输入 ----
  const handleDragEnd = useCallback(() => {
    if (dragTimerRef.current !== null) {
      window.clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
    const dragState = dragStateRef.current;
    if (dragState?.active) {
      const next = saveCompanionPosition(latestPositionRef.current);
      configRef.current = next;
      setConfig(next);
    }
    dragStateRef.current = null;
    dragIntentRef.current = "idle";
    setDragging(false);
  }, []);

  const handleDragMove = useCallback((event: PointerEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState?.active) return;
    const scale = clampScale(dragState.scale);
    const size = getPetSize(scale);
    const next = {
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    };
    const position = {
      x: clampAxisPosition(next.x, size.width, window.innerWidth),
      y: clampAxisPosition(next.y, size.height, window.innerHeight),
    };
    latestPositionRef.current = position;
    setConfig((current) => ({ ...current, position }));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd, { once: true });
    window.addEventListener("pointercancel", handleDragEnd, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
      window.removeEventListener("pointercancel", handleDragEnd);
    };
  }, [dragging, handleDragEnd, handleDragMove]);

  const handleAvatarPointerDown: PointerEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      if (petMode) return; // 桌宠模式窗口固定尺寸，不拖拽
      event.preventDefault();
      event.stopPropagation();
      const pointerId = event.pointerId;
      event.currentTarget.setPointerCapture(pointerId);
      dragIntentRef.current = "pressing";
      dragStateRef.current = {
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: configRef.current.position.x,
        originY: configRef.current.position.y,
        scale: configRef.current.scale,
        active: false,
      };
      if (dragTimerRef.current !== null) {
        window.clearTimeout(dragTimerRef.current);
        dragTimerRef.current = null;
      }
      if (dragHandleTimerRef.current !== null) {
        window.clearTimeout(dragHandleTimerRef.current);
        dragHandleTimerRef.current = null;
      }
      setShowDragHandle(true);
      void unlockSpeechPlayback();
      dragTimerRef.current = window.setTimeout(() => {
        const current = dragStateRef.current;
        if (!current || current.pointerId !== pointerId || dragIntentRef.current !== "pressing")
          return;
        current.active = true;
        dragIntentRef.current = "dragging";
        setDragging(true);
      }, PET_LONG_PRESS_MS);
    },
    [petMode],
  );

  const handleAvatarPointerUp: PointerEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (dragTimerRef.current !== null) {
        window.clearTimeout(dragTimerRef.current);
        dragTimerRef.current = null;
      }
      const wasDragging = dragIntentRef.current === "dragging";
      if (wasDragging) {
        handleDragEnd();
        return;
      }
      dragIntentRef.current = "idle";
      // 短按（点击）：聚焦输入
      if (!chatLoading) inputRef.current?.focus();
    },
    [chatLoading, handleDragEnd],
  );

  // ---- 对话 ----
  const requestLingChatReply = useCallback(
    async (nextMessages: PetChatMessage[]) => {
      if (!activeProvider || !activeModel) throw new Error("请先配置并启用 AI 供应商");
      const apiUrl = activeProvider.baseUrl.replace(/\/+$/, "") + activeProvider.apiPath;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeProvider.apiKey) headers.Authorization = `Bearer ${activeProvider.apiKey}`;
      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: activeModel.modelId,
          messages: [
            {
              role: "system",
              content: `你是花笺桌宠角色「${roleOption?.label ?? "桌宠"}」。你像 LingChat 桌宠一样陪用户写作与聊天，语气自然亲切。回复时用【情绪】标签分段表达情绪（如【高兴】【生气】【难过】），情绪标签只用于驱动立绘表情，不解释。回复正文一律使用中文。`,
            },
            ...nextMessages.slice(-PET_CHAT_CONTEXT_LIMIT),
          ],
          stream: false,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`桌宠对话失败 (${response.status}): ${errorText}`);
      }
      const data = await response.json();
      return getCompletionText(data) || "我刚刚有点走神了，可以再和我说一遍吗？";
    },
    [activeModel, activeProvider, roleOption?.label],
  );

  const handleChatSubmit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const text = chatInput.trim();
      if (!text || chatLoading) return;
      if (!activeProvider || !activeModel) {
        showDialogue("先在设置里配置一个 AI 模型，我就能陪你聊天啦。", "疑惑");
        return;
      }
      void unlockSpeechPlayback();
      setChatInput("");
      const userMessage: PetChatMessage = { role: "user", content: text };
      const nextMessages = [...chatMessages, userMessage].slice(-30);
      setChatMessages(nextMessages);
      setChatLoading(true);
      try {
        const reply = await requestLingChatReply(nextMessages);
        const label = lastReplyEmotion(reply);
        const cleanText = stripEmotionTags(reply) || reply;
        if (label) {
          setEmotion(label);
          setMood(emotionTagToMood(label));
        }
        setDialogue({ text: cleanText, emotion: label, id: ++dialogueIdRef.current });
        if (shouldAutoSpeak()) {
          void speakText(cleanText, { emotion: emotionTagToMood(label ?? "高兴"), interrupt: true });
        }
        const assistantMessage: PetChatMessage = { role: "assistant", content: reply };
        setChatMessages((current) => [...current, assistantMessage].slice(-30));
      } catch (error) {
        console.warn("[lingchat-pet] 对话失败", error);
        setDialogue({
          text: error instanceof Error ? error.message : "桌宠对话失败，请稍后再试。",
          emotion: "无奈",
          id: ++dialogueIdRef.current,
        });
      } finally {
        setChatLoading(false);
      }
    },
    [
      activeModel,
      activeProvider,
      chatInput,
      chatLoading,
      chatMessages,
      requestLingChatReply,
      showDialogue,
    ],
  );

  useEffect(() => {
    savePetChatMessages(chatMessages);
  }, [chatMessages]);

  if (!config.enabled || !config.visible || config.renderer !== "lingchat" || !isSurfaceActive)
    return null;

  const scaledSize = getPetSize(petScale);
  const clampedPosition = {
    x: clampAxisPosition(config.position.x, scaledSize.width, window.innerWidth),
    y: clampAxisPosition(config.position.y, scaledSize.height, window.innerHeight),
  };
  const avatarArea = PET_AVATAR_SIZE * petScale;
  const dialogueArea = PET_DIALOGUE_HEIGHT * petScale;
  const inputArea = PET_INPUT_HEIGHT * petScale;
  const canSubmit = chatInput.trim().length > 0 && !chatLoading && Boolean(activeProvider);

  return (
    <aside
      ref={layerRef}
      className="lingchat-pet-layer"
      aria-label="LingChat 桌宠"
      style={{
        position: "fixed",
        left: petMode ? 0 : clampedPosition.x,
        top: petMode ? 0 : clampedPosition.y,
        width: petMode ? "100%" : scaledSize.width,
        height: petMode ? "100%" : scaledSize.height,
        zIndex: 999,
        opacity: clamp(config.opacity, 0.2, 1),
        pointerEvents: petMode || dragging || showDragHandle ? "auto" : "none",
        overflow: "hidden",
        background: "transparent",
        isolation: "isolate",
      }}
    >
      <div className="flex h-full w-full flex-col items-center" style={{ background: "transparent" }}>
        {/* 立绘区（点按聊天，长按拖动） */}
        <div
          className="relative flex-shrink-0"
          style={{ width: avatarArea, height: avatarArea }}
          onPointerDown={handleAvatarPointerDown}
          onPointerUp={handleAvatarPointerUp}
          onPointerCancel={handleDragEnd}
        >
          <LingChatPetLayer
            roleFolder={pet.roleFolder}
            clothesName={pet.clothesName}
            emotion={emotion}
            mood={mood}
            name={roleOption?.label}
            subTitle="桌宠"
            scale={1}
            effect={pet.effect}
            bubbleVolume={pet.bubbleVolume}
            thinking={chatLoading}
            onAvatarClick={() => {
              if (dragIntentRef.current === "dragging") return;
              if (!chatLoading) inputRef.current?.focus();
            }}
          />
          {/* 拖拽手柄（悬停出现，长按拖动） */}
          <button
            type="button"
            aria-label="拖动桌宠"
            title="点按聊天，长按拖动"
            style={{
              position: "absolute",
              left: PET_SAFE_MARGIN,
              bottom: PET_SAFE_MARGIN,
              width: 34,
              height: 34,
              zIndex: 2,
              borderRadius: 999,
              background: dragging ? "rgba(34,211,238,0.78)" : "rgba(20,20,20,0.36)",
              color: "#fff",
              cursor: dragging ? "grabbing" : "pointer",
              fontSize: 16,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: dragging || showDragHandle ? 1 : 0,
              pointerEvents: dragging || showDragHandle ? "auto" : "none",
              userSelect: "none",
              backdropFilter: "blur(6px)",
              transition: "opacity 0.2s ease, background-color 0.2s ease",
            }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 1.9 9.2 5.6 13 6.8 9.2 8 8 11.8 6.8 8 3 6.8l3.8-1.2Z" />
              <path d="M12.4 10.8v2.4" opacity="0.55" />
              <path d="M11.2 12h2.4" opacity="0.55" />
            </svg>
          </button>
        </div>

        {/* 台词气泡（打字机） */}
        <div
          className="flex w-full flex-shrink-0 items-start justify-center"
          style={{ height: dialogueArea, paddingTop: 4 * petScale }}
        >
          <PetDialogueBox
            text={dialogue?.text ?? ""}
            emotion={dialogue?.emotion}
            mood={dialogue ? mood : undefined}
            speed={pet.typeWriterSpeed}
            visible={Boolean(dialogue)}
            scale={petScale}
            maxHeight={dialogueArea - 12}
            onContinue={() => setDialogue(null)}
          />
        </div>

        {/* 输入条（ChatInput） */}
        <form
          onSubmit={(event) => void handleChatSubmit(event)}
          className="flex w-full flex-shrink-0 items-center gap-1.5 px-2"
          style={{ height: inputArea, pointerEvents: "auto" }}
        >
          <input
            ref={inputRef}
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            disabled={chatLoading}
            placeholder={activeProvider ? "和桌宠说点什么…" : "请先配置 AI 供应商"}
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-neutral-950/50 px-3 text-white placeholder-white/40 outline-none backdrop-blur-md focus:border-cyan-400/50"
            style={{
              height: Math.max(26, inputArea - 14),
              fontSize: `${13 * petScale}px`,
            }}
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-shrink-0 rounded-full font-bold text-white transition-opacity"
            style={{
              height: Math.max(26, inputArea - 14),
              paddingLeft: `${12 * petScale}px`,
              paddingRight: `${12 * petScale}px`,
              fontSize: `${12 * petScale}px`,
              background: canSubmit ? "rgba(34,211,238,0.92)" : "rgba(34,211,238,0.4)",
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {chatLoading ? "…" : "发送"}
          </button>
        </form>
      </div>
    </aside>
  );
}

// ---- 尺寸 / 位置工具 ----

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampScale(scale: number) {
  return Math.round(clamp(scale, COMPANION_MIN_SCALE, COMPANION_MAX_SCALE) * 100) / 100;
}

/** LingChat 桌宠窗口尺寸：宽度 240×scale，高度 (240+200+45)×scale */
function getPetSize(scale: number) {
  const safeScale = clampScale(scale);
  return {
    width: PET_AVATAR_SIZE * safeScale,
    height: (PET_AVATAR_SIZE + PET_DIALOGUE_HEIGHT + PET_INPUT_HEIGHT) * safeScale,
  };
}

function clampAxisPosition(position: number, size: number, viewportSize: number) {
  const minWhenFits = PET_SAFE_MARGIN;
  const maxWhenFits = viewportSize - size - PET_SAFE_MARGIN;
  if (maxWhenFits >= minWhenFits) {
    return clamp(position, minWhenFits, maxWhenFits);
  }
  return clamp(position, maxWhenFits, minWhenFits);
}

// ---- 聊天工具 ----

type PetChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type PetDialogueState = {
  text: string;
  emotion?: string;
  id: number;
};

type LingChatDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  scale: number;
  active: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getCompletionText(data: unknown) {
  if (!isRecord(data)) return "";
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0];
  if (!isRecord(first)) return "";
  const message = isRecord(first.message) ? first.message.content : undefined;
  return typeof message === "string" ? message.trim() : "";
}

function loadPetChatMessages(): PetChatMessage[] {
  try {
    const raw = localStorage.getItem(PET_CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PetChatMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (message) =>
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string",
      )
      .slice(-30);
  } catch {
    return [];
  }
}

function savePetChatMessages(messages: PetChatMessage[]) {
  localStorage.setItem(PET_CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-30)));
}

/** 剥离【情绪】标签，保留正文 */
function stripEmotionTags(text: string) {
  return text
    .replace(/【[^】\n]*】/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 取回复中最后一个【情绪】标签（驱动立绘与气泡情绪） */
function lastReplyEmotion(text: string): string | undefined {
  const segments = splitEmotionSegments(text);
  const labeled = segments.filter((segment) => segment.label);
  return labeled.length > 0 ? labeled[labeled.length - 1].label : undefined;
}
