import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  BUILT_IN_LINGCHAT_PET_OPTIONS,
  COMPANION_MAX_SCALE,
  COMPANION_MIN_SCALE,
  loadCompanionConfig,
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
import {
  buildLingChatSystemPrompt,
  loadLingChatCharacter,
  type LingChatCharacterSettings,
} from "../lingchatPersona";

interface LingChatCompanionLayerProps {
  surface?: "embedded" | "floating";
  providers?: ProviderConfig[];
}

/** LingChat 桌宠窗口三段比例：立绘 240 + 气泡 200 + 输入 45（× scale） */
const PET_AVATAR_SIZE = 240;
const PET_DIALOGUE_HEIGHT = 200;
const PET_INPUT_HEIGHT = 45;
const PET_SAFE_MARGIN = 8;
const PET_CHAT_STORAGE_KEY = "lingchat_pet_chat_messages";
const PET_CHAT_CONTEXT_LIMIT = 10;

/**
 * LingChat 桌宠完整渲染层（移植自 LingChat PetMode.vue + components/pet/*，MIT）。
 *
 * 三段式窗口布局（宽度 240×scale，高度 (240+200+45)×scale）：
 *   台词气泡（DialogueBox，顶部，底部贴合立绘）→ 立绘区（GameRoleAvatar）→ 输入条（ChatInput，悬停显示）
 *
 * - 渲染门控：仅当 config.renderer === "lingchat" 且 enabled/visible 时渲染，
 *   其余情况返回 null（与 Live2DCompanionLayer 互斥，可无条件挂载于 AppShell）。
 * - 交互（与花笺 Live2D 的点击展开/长按拖拽解耦，完全按 LingChat 原生）：
 *   悬停显示输入条，离开隐藏；点击立绘聚焦输入；点击气泡收起。
 * - 后端逻辑：运行时加载 `characters/{角色}/settings.yml` 人设，
 *   用 `buildLingChatSystemPrompt`（复刻 sys_prompt_builder）组装 system prompt 请求 AI。
 */
export function LingChatCompanionLayer({
  surface = "embedded",
  providers = [],
}: LingChatCompanionLayerProps) {
  const [config, setConfig] = useState<CompanionConfig>(loadCompanionConfig());
  const [petMode, setPetModeState] = useState<boolean>(() => loadPetMode().enabled);
  const [emotion, setEmotion] = useState<string | undefined>();
  const [mood, setMood] = useState<SoullinkLocalMood | undefined>();
  const [dialogue, setDialogue] = useState<PetDialogueState | null>(null);
  const dialogueIdRef = useRef(0);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<PetChatMessage[]>(loadPetChatMessages);
  const [showChatInput, setShowChatInput] = useState(false);
  const [persona, setPersona] = useState<LingChatCharacterSettings | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    return subscribeCompanionConfig((next) => {
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

  // 后端逻辑：按当前角色加载 settings.yml 人设（scale_p 驱动立绘、system_prompt 驱动对话）
  useEffect(() => {
    let cancelled = false;
    loadLingChatCharacter(pet.roleFolder)
      .then((settings) => {
        if (!cancelled) setPersona(settings);
      })
      .catch((error) => console.warn("[lingchat-pet] 加载角色人设失败", error));
    return () => {
      cancelled = true;
    };
  }, [pet.roleFolder]);

  // ---- 交互（LingChat 原生）：悬停显示输入条，离开隐藏（输入中保持） ----
  const handleMouseEnter = useCallback(() => setShowChatInput(true), []);

  const handleMouseLeave = useCallback(() => {
    if (chatInput.trim().length > 0 || chatLoading) {
      setShowChatInput(true);
      return;
    }
    setShowChatInput(false);
  }, [chatInput, chatLoading]);

  const handleAvatarClick = useCallback(() => {
    void unlockSpeechPlayback();
    setShowChatInput(true);
    inputRef.current?.focus();
  }, []);

  // ---- 对话 ----
  const requestLingChatReply = useCallback(
    async (nextMessages: PetChatMessage[]) => {
      if (!activeProvider || !activeModel) throw new Error("请先配置并启用 AI 供应商");
      const apiUrl = activeProvider.baseUrl.replace(/\/+$/, "") + activeProvider.apiPath;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeProvider.apiKey) headers.Authorization = `Bearer ${activeProvider.apiKey}`;
      const systemPrompt = persona
        ? buildLingChatSystemPrompt(persona)
        : `你是花笺桌宠角色「${roleOption?.label ?? "桌宠"}」。你像 LingChat 桌宠一样陪用户写作与聊天，语气自然亲切。回复时用【情绪】标签分段表达情绪（如【高兴】【生气】【难过】），情绪标签只用于驱动立绘表情，不解释。回复正文一律使用中文。`;
      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: activeModel.modelId,
          messages: [{ role: "system", content: systemPrompt }, ...nextMessages.slice(-PET_CHAT_CONTEXT_LIMIT)],
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
    [activeModel, activeProvider, persona, roleOption?.label],
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
      className="lingchat-pet-layer"
      aria-label="LingChat 桌宠"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: "fixed",
        left: petMode ? 0 : clampedPosition.x,
        top: petMode ? 0 : clampedPosition.y,
        width: petMode ? "100%" : scaledSize.width,
        height: petMode ? "100%" : scaledSize.height,
        zIndex: 999,
        opacity: clamp(config.opacity, 0.2, 1),
        pointerEvents: "auto",
        overflow: "hidden",
        background: "transparent",
        isolation: "isolate",
      }}
    >
      <div className="flex h-full w-full flex-col items-center" style={{ background: "transparent" }}>
        {/* 台词气泡区（顶部，justify-end 让气泡底部贴合立绘，LingChat 原版顺序） */}
        <div
          className="flex w-full flex-shrink-0 flex-col justify-end"
          style={{ height: dialogueArea }}
        >
          <div className="mt-1 flex items-end justify-center">
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
        </div>

        {/* 立绘区（LingChat GameRoleAvatar，点击聚焦输入，无拖拽） */}
        <div
          className="relative flex-shrink-0"
          style={{ width: avatarArea, height: avatarArea }}
        >
          <LingChatPetLayer
            roleFolder={pet.roleFolder}
            clothesName={pet.clothesName}
            emotion={emotion}
            mood={mood}
            name={roleOption?.label}
            subTitle={persona?.aiSubtitle}
            scaleP={persona?.scaleP}
            offsetXP={persona?.offsetXP}
            offsetYP={persona?.offsetYP}
            effect={pet.effect}
            bubbleVolume={pet.bubbleVolume}
            thinking={chatLoading}
            onAvatarClick={handleAvatarClick}
          />
        </div>

        {/* 输入条（ChatInput，悬停显示） */}
        <div
          className="flex w-full flex-shrink-0 items-start justify-center"
          style={{ height: inputArea }}
        >
          <form
            onSubmit={(event) => void handleChatSubmit(event)}
            className={`w-full px-2 transition-all duration-300 ease-out ${
              showChatInput ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
            }`}
          >
            <div className="flex items-center gap-1.5 rounded-[20px] border border-white/10 bg-neutral-950/50 px-2 py-1 backdrop-blur-xl backdrop-saturate-200">
              <input
                ref={inputRef}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                disabled={chatLoading}
                placeholder={
                  chatLoading
                    ? "灵灵正在思考中..."
                    : activeProvider
                      ? "和桌宠说点什么…"
                      : "请先配置 AI 供应商"
                }
                className="min-w-0 flex-1 bg-transparent px-1 text-white placeholder-white/40 outline-none [text-shadow:0_1px_4px_rgba(0,0,0,0.5)]"
                style={{
                  height: Math.max(26, inputArea - 14),
                  fontSize: `${13 * petScale}px`,
                }}
              />
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex-shrink-0 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-400 font-bold text-white shadow-[0_4px_15px_rgba(6,182,212,0.4)] transition-all duration-300 hover:from-cyan-400 hover:to-blue-300 active:scale-95 disabled:opacity-50 disabled:hover:from-cyan-500 disabled:hover:to-blue-400"
                style={{
                  height: Math.max(26, inputArea - 14),
                  paddingLeft: `${12 * petScale}px`,
                  paddingRight: `${12 * petScale}px`,
                  fontSize: `${12 * petScale}px`,
                }}
              >
                {chatLoading ? "…" : "发送"}
              </button>
            </div>
          </form>
        </div>
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
