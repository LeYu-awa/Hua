import { ensureCubismCore } from "./cubismSetup";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEventHandler,
} from "react";
import { createLive2DScene, createLive2DModelController, processAgentUICommand, processAgentUICommands } from "./index";
import { agentSignalQueue } from "../agent/signalQueue";
import type { Live2DModelController } from "./modelController";
import { pickLive2DRenderBackend, type Live2DRenderBackend } from "./moc3Version";
import type { Live2DScene } from "./scene";
import {
  COMPANION_MAX_SCALE,
  COMPANION_MIN_SCALE,
  loadCompanionConfig,
  saveCompanionConfig,
  saveCompanionPosition,
  subscribeCompanionConfig,
} from "../../features/companion/companionConfig";
import { useCompanionEvents } from "../../features/companion/useCompanionEvents";
import type { CompanionConfig } from "../../features/companion/types";
import type { AgentUICommand } from "../../features/agent/types";
import { analyzeAgentConversation } from "../../features/agent/api";
import type { ProviderConfig } from "../settings/types";
import { shouldAutoSpeak, speakText, subscribeMouthValue, unlockSpeechPlayback } from "../tts";
import { subscribeLive2DEmotion } from "./emotionBus";
import type { SoullinkLocalMood } from "./soullinkLocalEngine";

interface Live2DCompanionLayerProps {
  conversationId?: string | null;
  surface?: "embedded" | "floating";
  providers?: ProviderConfig[];
}

const LIVE2D_WIDTH = 260;
const LIVE2D_HEIGHT = 380;
const LIVE2D_SCALE_STEP = 0.05;
const LIVE2D_DRAG_HANDLE_SIZE = 34;
const LIVE2D_SAFE_MARGIN = 8;
const LIVE2D_LONG_PRESS_MS = 50;
const LIVE2D_CHAT_STORAGE_KEY = "live2d_companion_chat_messages";
const LIVE2D_CHAT_POSITION_STORAGE_KEY = "live2d_companion_chat_position";
const LIVE2D_CHAT_CONTEXT_LIMIT = 10;

/** 6 元情绪 → Haru 表情 Name（F01-F08 系列；其他模型无对应表情时静默跳过） */
const MOOD_TO_EXPRESSION: Record<SoullinkLocalMood, string> = {
  happy: "F01",
  neutral: "F02",
  sleepy: "F03",
  excited: "F04",
  worried: "F05",
  curious: "F06",
};

type Live2DModel3Json = {
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
    DisplayInfo?: string;
  };
};

type EmbeddedDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  scale: number;
  active: boolean;
};

type Live2DChatDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type Live2DChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampScale(scale: number) {
  return Math.round(clamp(scale, COMPANION_MIN_SCALE, COMPANION_MAX_SCALE) * 100) / 100;
}

function getScaledLive2DSize(scale: number) {
  const safeScale = clampScale(scale);
  return {
    width: LIVE2D_WIDTH * safeScale,
    height: LIVE2D_HEIGHT * safeScale,
  };
}

function clampAxisPosition(position: number, size: number, viewportSize: number) {
  const minWhenFits = LIVE2D_SAFE_MARGIN;
  const maxWhenFits = viewportSize - size - LIVE2D_SAFE_MARGIN;

  if (maxWhenFits >= minWhenFits) {
    return clamp(position, minWhenFits, maxWhenFits);
  }

  return clamp(position, maxWhenFits, minWhenFits);
}

function getClampedPosition(position: CompanionConfig["position"], scale: number) {
  const { width, height } = getScaledLive2DSize(scale);
  return {
    x: clampAxisPosition(position.x, width, window.innerWidth),
    y: clampAxisPosition(position.y, height, window.innerHeight),
  };
}

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

function loadLive2DChatMessages(): Live2DChatMessage[] {
  try {
    const raw = localStorage.getItem(LIVE2D_CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Live2DChatMessage[];
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

function saveLive2DChatMessages(messages: Live2DChatMessage[]) {
  localStorage.setItem(LIVE2D_CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-30)));
}

function getDefaultLive2DChatPosition() {
  return { x: Math.round(window.innerWidth / 2 - 170), y: Math.round(window.innerHeight - 96) };
}

function getClampedLive2DChatPosition(position: { x: number; y: number }) {
  return {
    x: clamp(position.x, 12, Math.max(12, window.innerWidth - 360)),
    y: clamp(position.y, 48, Math.max(48, window.innerHeight - 64)),
  };
}

function loadLive2DChatPosition() {
  try {
    const raw = localStorage.getItem(LIVE2D_CHAT_POSITION_STORAGE_KEY);
    if (!raw) return getDefaultLive2DChatPosition();
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number")
      return getDefaultLive2DChatPosition();
    return getClampedLive2DChatPosition({ x: parsed.x, y: parsed.y });
  } catch {
    return getDefaultLive2DChatPosition();
  }
}

function saveLive2DChatPosition(position: { x: number; y: number }) {
  localStorage.setItem(
    LIVE2D_CHAT_POSITION_STORAGE_KEY,
    JSON.stringify(getClampedLive2DChatPosition(position)),
  );
}

function getCenteredScalePosition(
  position: CompanionConfig["position"],
  fromScale: number,
  toScale: number,
) {
  const fromSize = getScaledLive2DSize(fromScale);
  const toSize = getScaledLive2DSize(toScale);
  const center = {
    x: position.x + fromSize.width / 2,
    y: position.y + fromSize.height / 2,
  };
  return getClampedPosition(
    {
      x: Math.round(center.x - toSize.width / 2),
      y: Math.round(center.y - toSize.height / 2),
    },
    toScale,
  );
}

function isLive2DScaleKey(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return 0;
  if (event.altKey) return 0;
  const key = event.key;
  const code = event.code;
  if (key === "+" || key === "=" || code === "Equal" || code === "NumpadAdd") return 1;
  if (key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract") return -1;
  return 0;
}

function resolveScaleUpdate(current: CompanionConfig, direction: number) {
  const currentScale = clampScale(current.scale);
  const nextScale = clampScale(currentScale + direction * LIVE2D_SCALE_STEP);
  if (nextScale === currentScale) return null;
  return {
    ...current,
    scale: nextScale,
    position: getCenteredScalePosition(current.position, currentScale, nextScale),
  };
}

function resolveLive2DAssetPath(modelPath: string, assetPath: string) {
  const modelUrl = new URL(modelPath, window.location.origin);
  return new URL(assetPath, modelUrl).pathname;
}

function isCanvasLayoutReady(canvas: HTMLCanvasElement) {
  const parent = canvas.parentElement;
  const rect = canvas.getBoundingClientRect();
  return Boolean(
    parent &&
    parent.isConnected &&
    rect.width > 0 &&
    rect.height > 0 &&
    parent.clientWidth > 0 &&
    parent.clientHeight > 0,
  );
}

function waitForCanvasLayout(canvas: HTMLCanvasElement, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const parent = canvas.parentElement;
    if (!parent) {
      resolve(false);
      return;
    }
    if (isCanvasLayoutReady(canvas)) {
      resolve(true);
      return;
    }

    let settled = false;
    let timeoutId = 0;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      observer.disconnect();
      resolve(ready);
    };

    const observer = new ResizeObserver(() => {
      if (isCanvasLayoutReady(canvas)) finish(true);
    });

    timeoutId = window.setTimeout(() => finish(false), timeoutMs);

    // 透明悬浮窗首帧窗口尺寸可能尚未应用（WebView 视口为 0x0），
    // 固定帧数探测不可靠，改为监听父容器/画布/根节点的尺寸变化。
    observer.observe(parent);
    observer.observe(canvas);
    observer.observe(document.documentElement);
  });
}

async function assertFetchOk(path: string) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Live2D resource not found: ${path} (${response.status})`);
  }
  return response;
}

async function validateLive2DModelAssets(modelPath: string) {
  const modelResponse = await assertFetchOk(modelPath);
  const modelJson = (await modelResponse.json()) as Live2DModel3Json;
  const refs = modelJson.FileReferences;
  if (!refs?.Moc || !refs.Textures?.length) {
    throw new Error(`Invalid Live2D model3.json: ${modelPath}`);
  }

  const assets = [refs.Moc, ...refs.Textures, refs.Physics, refs.DisplayInfo].filter(
    Boolean,
  ) as string[];
  const resolvedAssets = assets.map((asset) => resolveLive2DAssetPath(modelPath, asset));
  await Promise.all(resolvedAssets.map((asset) => assertFetchOk(asset)));
}

export function Live2DCompanionLayer({
  conversationId,
  surface = "embedded",
  providers = [],
}: Live2DCompanionLayerProps) {
  const sceneRef = useRef<Live2DScene | null>(null);
  const layerRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<Live2DModelController | null>(null);
  const backendRef = useRef<Live2DRenderBackend | null>(null);
  const configRef = useRef<CompanionConfig>(loadCompanionConfig());
  const loadedModelPathRef = useRef<string | null>(null);
  const loadingModelRef = useRef(false);
  const lastFedSuggestionIdRef = useRef<string | null>(null);
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const [config, setConfig] = useState<CompanionConfig>(loadCompanionConfig());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [draggingEmbedded, setDraggingEmbedded] = useState(false);
  const [showDragHandle, setShowDragHandle] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<Live2DChatMessage[]>(loadLive2DChatMessages);
  const [chatPosition, setChatPosition] = useState(loadLive2DChatPosition);
  const [chatDots, setChatDots] = useState(".");
  const dragStateRef = useRef<EmbeddedDragState | null>(null);
  const dragTimerRef = useRef<number | null>(null);
  const dragHandleTimerRef = useRef<number | null>(null);
  const latestPositionRef = useRef(config.position);
  const dragIntentRef = useRef<"idle" | "pressing" | "dragging">("idle");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const chatDragStateRef = useRef<Live2DChatDragState | null>(null);
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
  // 嵌入式层仅在非浮动模式激活，浮动窗口仅在 floating 模式激活，避免同一配置双份渲染
  const isSurfaceActive =
    surface === "floating" ? config.mode === "floating" : config.mode !== "floating";
  const actionState = useCompanionEvents({
    ...config,
    enabled: config.enabled && config.visible && config.renderer === "live2d" && isSurfaceActive,
  });

  useEffect(() => {
    latestPositionRef.current = config.position;
  }, [config.position]);

  useEffect(() => {
    return () => {
      if (dragTimerRef.current !== null) {
        window.clearTimeout(dragTimerRef.current);
      }
      if (dragHandleTimerRef.current !== null) {
        window.clearTimeout(dragHandleTimerRef.current);
      }
      dragIntentRef.current = "idle";
    };
  }, []);

  useEffect(() => {
    saveLive2DChatMessages(chatMessages);
  }, [chatMessages]);

  useEffect(() => {
    saveLive2DChatPosition(chatPosition);
  }, [chatPosition]);

  useEffect(() => {
    if (!chatLoading) {
      setChatDots(".");
      return;
    }
    const timer = window.setInterval(() => {
      setChatDots((current) => (current.length >= 3 ? "." : `${current}.`));
    }, 360);
    return () => window.clearInterval(timer);
  }, [chatLoading]);

  useEffect(() => {
    if (!chatLoading) return;
    setBubbleText(`我在想${chatDots}`);
  }, [chatDots, chatLoading]);

  useEffect(() => {
    const unsub = subscribeCompanionConfig((next) => {
      configRef.current = next;
      setConfig(next);
    });
    return unsub;
  }, [surface]);

  useEffect(() => {
    if (!chatOpen) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [chatOpen]);

  const showBubble = useCallback((text: string, durationMs = 5000) => {
    setBubbleText(text);
    if (bubbleTimerRef.current !== null) {
      window.clearTimeout(bubbleTimerRef.current);
    }
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubbleText(null);
      bubbleTimerRef.current = null;
    }, durationMs);
  }, []);

  /** 全局信号队列订阅：画布等场景派发的 live2d_signal 直接驱动花灵（P0-3 成文提议等） */
  useEffect(() => {
    return agentSignalQueue.subscribe((command) => {
      if (command.type !== "live2d_signal") return;
      const controller = controllerRef.current;
      if (!controller) return;
      processAgentUICommand(controller, command, showBubble);
    });
  }, [showBubble]);

  const requestLive2DReply = useCallback(
    async (nextMessages: Live2DChatMessage[]) => {
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
              content:
                "你是花笺桌面应用里的 Live2D 写作陪伴角色，名字叫花灵。你是任务型助手,只能用中文,支持联网搜索,具有修改文章,润色文章的功能,语气温柔自然",
            },
            ...nextMessages.slice(-LIVE2D_CHAT_CONTEXT_LIMIT),
          ],
          stream: false,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Live2D 对话失败 (${response.status}): ${errorText}`);
      }
      const data = await response.json();
      return getCompletionText(data) || "我刚刚有点走神了，可以再和我说一遍吗？";
    },
    [activeModel, activeProvider],
  );

  const handleChatSubmit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const text = chatInput.trim();
      if (!text || chatLoading) return;
      if (!activeProvider || !activeModel) {
        showBubble("先在设置里配置一个 AI 模型，我就能陪你聊天啦。", 5000);
        return;
      }
      void unlockSpeechPlayback();
      setChatInput("");
      setChatOpen(true);
      const userMessage: Live2DChatMessage = { role: "user", content: text };
      const nextMessages = [...chatMessages, userMessage].slice(-30);
      setChatMessages(nextMessages);
      setChatLoading(true);
      showBubble(`我在想${chatDots}`, 1400);
      try {
        const reply = await requestLive2DReply(nextMessages);
        if (shouldAutoSpeak()) {
          const started = await speakText(reply, { emotion: "happy", interrupt: true });
          if (!started) showBubble("语音暂时没响，我先把文字给你。", 1800);
        }
        const assistantMessage: Live2DChatMessage = { role: "assistant", content: reply };
        setChatMessages((current) => [...current, assistantMessage].slice(-30));
        showBubble(reply, Math.min(12000, Math.max(5000, reply.length * 180)));
      } catch (error) {
        console.warn("[live2d-chat] 对话失败", error);
        showBubble(error instanceof Error ? error.message : "Live2D 对话失败，请稍后再试。", 6000);
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
      requestLive2DReply,
      showBubble,
    ],
  );

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
      if (!layer || draggingEmbedded) return;
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
  }, [draggingEmbedded, showDragHandleBriefly]);

  /**
   * 构建项目自研 Pixi v8 + @naari3/pixi-live2d-display 控制器。
   */
  const buildController = useCallback(
    async (_backend: Live2DRenderBackend): Promise<Live2DModelController> => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Live2D canvas not mounted");

      canvas.style.display = "block";
      await ensureCubismCore();
      const probeCanvas = document.createElement("canvas");
      const gl = probeCanvas.getContext("webgl2") || probeCanvas.getContext("webgl");
      if (!gl) throw new Error("WebGL not available in Tauri WebView");

      const nextScene = await createLive2DScene(canvas, clampScale(configRef.current.scale));
      const previousScene = sceneRef.current;
      if (previousScene && previousScene !== nextScene) {
        previousScene.destroy();
      }
      sceneRef.current = nextScene;
      return createLive2DModelController(nextScene, { onReply: showBubble });
    },
    [showBubble],
  );

  const loadCurrentModel = useCallback(async () => {
    const controller = controllerRef.current;
    const currentConfig = configRef.current;
    if (!controller || !currentConfig.modelPath || loadingModelRef.current) return;
    if (!currentConfig.enabled || !currentConfig.visible || currentConfig.renderer !== "live2d")
      return;
    if (
      surface === "floating" ? currentConfig.mode !== "floating" : currentConfig.mode === "floating"
    )
      return;
    if (controller.model && loadedModelPathRef.current === currentConfig.modelPath) return;

    loadingModelRef.current = true;
    try {
      setModelLoaded(false);
      setLoadError(null);
      await validateLive2DModelAssets(currentConfig.modelPath);

      // 统一走项目自研 Pixi v8 渲染器，避免低版本 MOC3 被误分流到 SDK renderer。
      const backend = await pickLive2DRenderBackend(currentConfig.modelPath);
      if (backend !== backendRef.current) {
        controllerRef.current?.destroy();
        const next = await buildController(backend);
        controllerRef.current = next;
        backendRef.current = backend;
      }

      const active = controllerRef.current;
      if (!active) throw new Error("Live2D controller not ready");
      await active.load(currentConfig.modelPath, sceneRef.current?.characterLayer);
      loadedModelPathRef.current = currentConfig.modelPath;
      active.enableEyeFollow(true);
      active.setMouseFollowStrength(currentConfig.sensitivity.mouseFollowStrength ?? 0.75);
      active.setScale(currentConfig.scale);
      setModelLoaded(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Live2D] Model load failed:", err);
      setLoadError(msg);
    } finally {
      loadingModelRef.current = false;
    }
  }, [surface, buildController]);

  useEffect(() => {
    if (!config.enabled || !config.visible || config.renderer !== "live2d" || !isSurfaceActive) {
      return;
    }

    let cancelled = false;
    let controller: Live2DModelController | null = null;
    let frameId: number | null = null;

    const init = async () => {
      await new Promise<void>((resolve) => {
        frameId = window.requestAnimationFrame(() => resolve());
        // 透明悬浮窗首帧 rAF 可能被节流，兜底超时避免 init 永久挂起
        window.setTimeout(() => {
          if (frameId !== null) window.cancelAnimationFrame(frameId);
          resolve();
        }, 120);
      });
      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) {
        setLoadError("Live2D canvas not mounted");
        return;
      }

      const layoutReady = await waitForCanvasLayout(canvas);
      if (cancelled) return;
      if (!layoutReady) {
        // 布局失败不永久停摆：3 秒后自动重试，直到窗口尺寸就绪
        if (retryTimerRef.current === null) {
          setLoadError("Live2D canvas layout not ready");
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            if (!cancelled) {
              setLoadError(null);
              void init();
            }
          }, 3000);
        }
        return;
      }

      try {
        const backend = await pickLive2DRenderBackend(configRef.current.modelPath);
        if (cancelled) return;

        controller = await buildController(backend);
        controllerRef.current = controller;
        backendRef.current = backend;

        await loadCurrentModel();
      } catch (err) {
        if (!cancelled) {
          console.error("[Live2D] Init failed:", err);
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (controller) controller.destroy();
      if (sceneRef.current) sceneRef.current.destroy();
      sceneRef.current = null;
      controllerRef.current = null;
      backendRef.current = null;
      loadedModelPathRef.current = null;
      loadingModelRef.current = false;
    };
  }, [config.enabled, config.visible, config.renderer, config.mode, loadCurrentModel]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const direction = isLive2DScaleKey(event);
      if (!direction) return;
      if (
        !configRef.current.enabled ||
        !configRef.current.visible ||
        configRef.current.renderer !== "live2d" ||
        !isSurfaceActive
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      const latest = loadCompanionConfig();
      const next = resolveScaleUpdate(latest, direction);
      if (!next) return;

      saveCompanionConfig(next);
      configRef.current = next;
      latestPositionRef.current = next.position;
      setConfig(next);
      sceneRef.current?.setQualityScale(1);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isSurfaceActive]);

  useEffect(() => {
    sceneRef.current?.setQualityScale(1);
    controllerRef.current?.setScale(config.scale);
  }, [config.scale]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;

    if (!config.enabled || !config.visible || config.renderer !== "live2d" || !isSurfaceActive) {
      if (controller.model) controller.unload();
      loadedModelPathRef.current = null;
      setModelLoaded(false);
      return;
    }

    controller.setMouseFollowStrength(config.sensitivity.mouseFollowStrength ?? 0.75);
    void loadCurrentModel();
  }, [
    config.enabled,
    config.visible,
    config.renderer,
    config.modelPath,
    config.mode,
    config.sensitivity.mouseFollowStrength,
    loadCurrentModel,
  ]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      controllerRef.current?.focusAt(event.clientX, event.clientY);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  // 口型联动（方案 C1）：TTS 播放时 RMS 音量包络 → setMouthValue，无声自动归零
  useEffect(() => {
    return subscribeMouthValue((value) => {
      controllerRef.current?.setMouthValue(value);
    });
  }, []);

  // 对话情绪驱动（移植自 LingChat，MIT）：SidebarChat 解析【情绪】标签 / 分类器预测
  // → live2d-emotion 事件 → triggerEmotion + setExpression
  useEffect(() => {
    return subscribeLive2DEmotion(({ mood, intensity, label }) => {
      const controller = controllerRef.current;
      if (!controller?.model) return;
      controller.triggerEmotion(mood, Math.min(1, Math.max(0.35, intensity)));
      const expression = MOOD_TO_EXPRESSION[mood];
      if (expression) {
        controller.setExpression(expression).catch(() => undefined);
      }
      if (label) {
        console.debug(`[live2d-emotion] ${label} → ${mood} (${intensity.toFixed(2)})`);
      }
    });
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller?.model) return;

    const action = actionState.action;
    if (action === "hide") return;

    if (action === "idle") {
      controller.setMouthValue(0);
      controller.setExpression("F02").catch(() => undefined);
      return;
    }

    if (action === "pause") {
      controller.setExpression("F03").catch(() => undefined);
      controller.setMouthValue(0);
      return;
    }

    const expression =
      action === "delete"
        ? "F05"
        : action === "save" || action === "complete"
          ? "F01"
          : action === "moveLeft" ||
              action === "moveRight" ||
              action === "moveUp" ||
              action === "moveDown"
            ? "F06"
            : "F04";

    const motionIndex =
      actionState.paw === "left"
        ? 0
        : actionState.paw === "right"
          ? 1
          : action === "complete"
            ? 3
            : 2;
    controller.setExpression(expression).catch(() => undefined);
    controller.playMotion("TapBody", motionIndex);
    controller.pulseMouth(Math.round(140 + actionState.intensity * 220));
  }, [actionState.action, actionState.paw, actionState.intensity, actionState.lastEventAt]);

  const handleEmbeddedDragEnd = useCallback(() => {
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
    setDraggingEmbedded(false);
  }, []);

  const handleEmbeddedDragMove = useCallback((event: PointerEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState?.active) return;

    const scale = clampScale(dragState.scale);
    const position = getClampedPosition(
      {
        x: dragState.originX + event.clientX - dragState.startX,
        y: dragState.originY + event.clientY - dragState.startY,
      },
      scale,
    );

    latestPositionRef.current = position;
    setConfig((current) => ({ ...current, position }));
  }, []);

  useEffect(() => {
    if (!draggingEmbedded) return;

    window.addEventListener("pointermove", handleEmbeddedDragMove);
    window.addEventListener("pointerup", handleEmbeddedDragEnd, { once: true });
    window.addEventListener("pointercancel", handleEmbeddedDragEnd, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleEmbeddedDragMove);
      window.removeEventListener("pointerup", handleEmbeddedDragEnd);
      window.removeEventListener("pointercancel", handleEmbeddedDragEnd);
    };
  }, [draggingEmbedded, handleEmbeddedDragEnd, handleEmbeddedDragMove]);

  const handlePointerDown: PointerEventHandler<HTMLButtonElement> = useCallback((event) => {
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
      setChatOpen(false);
      setDraggingEmbedded(true);
    }, LIVE2D_LONG_PRESS_MS);
  }, []);

  const handlePointerUp: PointerEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (dragTimerRef.current !== null) {
        window.clearTimeout(dragTimerRef.current);
        dragTimerRef.current = null;
      }
      const wasDragging = dragIntentRef.current === "dragging";
      if (wasDragging) {
        handleEmbeddedDragEnd();
        return;
      }
      dragStateRef.current = null;
      dragIntentRef.current = "idle";
      setChatOpen((open) => !open);
      setShowDragHandle(true);
    },
    [handleEmbeddedDragEnd],
  );

  const handleChatDragStart: PointerEventHandler<HTMLElement> = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      chatDragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: chatPosition.x,
        originY: chatPosition.y,
      };
    },
    [chatPosition.x, chatPosition.y],
  );

  const handleChatDragMove: PointerEventHandler<HTMLElement> = useCallback((event) => {
    const state = chatDragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setChatPosition(
      getClampedLive2DChatPosition({
        x: state.originX + event.clientX - state.startX,
        y: state.originY + event.clientY - state.startY,
      }),
    );
  }, []);

  const handleChatDragEnd: PointerEventHandler<HTMLElement> = useCallback((event) => {
    const state = chatDragStateRef.current;
    if (state?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      chatDragStateRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!conversationId) return;

    const poll = () => {
      analyzeAgentConversation(conversationId)
        .then((result) => {
          const controller = controllerRef.current;
          if (!controller) return;

          processAgentUICommands(
            controller,
            result.suggestions.map((s) => s.payload as unknown as AgentUICommand).flat(),
            showBubble,
          );

          // 把新建议交给 Soullink 会话运行时 → LLM 反应规划（情绪 + 回复）
          const top = result.suggestions[0];
          if (top && top.id !== lastFedSuggestionIdRef.current && top.message) {
            lastFedSuggestionIdRef.current = top.id;
            void controller.sendMessage(top.message).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    };

    poll();
    const timer = window.setInterval(poll, 30_000);
    return () => {
      window.clearInterval(timer);
      if (bubbleTimerRef.current !== null) {
        window.clearTimeout(bubbleTimerRef.current);
      }
    };
  }, [conversationId]);

  if (!config.enabled || !config.visible || config.renderer !== "live2d" || !isSurfaceActive)
    return null;

  const scaledSize = getScaledLive2DSize(config.scale);

  return (
    <>
      <aside
        ref={layerRef}
        className="live2d-companion-layer"
        style={{
          position: surface === "embedded" ? "fixed" : "relative",
          left: surface === "embedded" ? config.position.x : undefined,
          top: surface === "embedded" ? config.position.y : undefined,
          width: scaledSize.width,
          height: scaledSize.height,
          zIndex: 999,
          opacity: clamp(config.opacity, 0.2, 1),
          pointerEvents: draggingEmbedded || showDragHandle || chatOpen ? "auto" : "none",
          overflow: "visible",
          background: "transparent",
          backgroundColor: "transparent",
          isolation: "isolate",
        }}
        aria-label="Live2D 写作陪伴"
      >
        <div
          className="live2d-companion-card"
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            background: "transparent",
            border: "none",
            boxShadow: "none",
            outline: "none",
            backdropFilter: "none",
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <button
            type="button"
            aria-label="和 Live2D 角色聊天，长按拖动"
            title="点按聊天，长按拖动"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handleEmbeddedDragEnd}
            style={{
              position: "absolute",
              left: LIVE2D_SAFE_MARGIN,
              bottom: LIVE2D_SAFE_MARGIN,
              width: LIVE2D_DRAG_HANDLE_SIZE,
              height: LIVE2D_DRAG_HANDLE_SIZE,
              zIndex: 2,
              borderRadius: 999,
              background: draggingEmbedded
                ? "rgba(85, 124, 96, 0.78)"
                : chatOpen
                  ? "rgba(134,170,142,0.92)"
                  : "rgba(20,20,20,0.36)",
              color: "#fff",
              cursor: draggingEmbedded ? "grabbing" : "pointer",
              fontSize: 16,
              lineHeight: "30px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: draggingEmbedded || showDragHandle || chatOpen ? 1 : 0,
              pointerEvents: draggingEmbedded || showDragHandle || chatOpen ? "auto" : "none",
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
              style={{ transform: "translateY(0.5px)" }}
            >
              <path d="M8 1.9 9.2 5.6 13 6.8 9.2 8 8 11.8 6.8 8 3 6.8l3.8-1.2Z" />
              <path d="M12.4 10.8v2.4" opacity="0.55" />
              <path d="M11.2 12h2.4" opacity="0.55" />
            </svg>
          </button>
          <canvas
            ref={canvasRef}
            className="live2d-canvas"
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              background: "transparent",
              backgroundColor: "transparent",
              pointerEvents: "none",
            }}
          />

          {loadError && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                fontSize: 11,
                color: "#ff6b6b",
                textAlign: "center",
                wordBreak: "break-all",
                pointerEvents: "none",
              }}
            >
              {loadError}
            </div>
          )}

          {!modelLoaded && !loadError ? null : null}

          {bubbleText && (
            <div
              className="live2d-bubble"
              style={{
                position: "absolute",
                top: "calc(100% - 20px)",
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(38, 40, 38, 0.92)",
                color: "#f5f7f2",
                border: "1px solid rgba(134, 170, 142, 0.32)",
                boxShadow: "0 10px 30px rgba(0,0,0,0.24)",
                backdropFilter: "blur(12px)",
                padding: "7px 12px",
                borderRadius: 14,
                fontSize: 12,
                lineHeight: 1.45,
                minWidth: 96,
                width: "max-content",
                maxWidth: "min(320px, calc(100vw - 32px))",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
                pointerEvents: "none",
              }}
            >
              {bubbleText}
            </div>
          )}
        </div>
      </aside>

      {chatOpen && (
        <form
          onSubmit={(event) => void handleChatSubmit(event)}
          style={{
            position: "fixed",
            left: chatPosition.x,
            top: chatPosition.y,
            zIndex: 1001,
            width: "min(340px, calc(100vw - 32px))",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 9px",
            borderRadius: 18,
            background: "rgba(38, 40, 38, 0.92)",
            border: "1px solid rgba(134, 170, 142, 0.32)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.24)",
            backdropFilter: "blur(12px)",
            pointerEvents: "auto",
          }}
        >
          <span
            onPointerDown={handleChatDragStart}
            onPointerMove={handleChatDragMove}
            onPointerUp={handleChatDragEnd}
            onPointerCancel={handleChatDragEnd}
            title="拖动对话框"
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#86aa8e",
              background: "rgba(134,170,142,0.14)",
              flex: "0 0 auto",
              cursor: "grab",
              touchAction: "none",
              userSelect: "none",
            }}
          >
            <svg
              width="14"
              height="14"
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
          </span>
          <input
            ref={inputRef}
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            disabled={chatLoading}
            placeholder={activeProvider ? "和花灵说点什么…" : "请先配置 AI 供应商"}
            style={{
              minWidth: 0,
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "#f5f7f2",
              fontSize: 12,
            }}
          />
          <button
            type="submit"
            disabled={!chatInput.trim() || chatLoading || !activeProvider}
            style={{
              minWidth: 42,
              border: "none",
              borderRadius: 999,
              padding: "5px 9px",
              color: "#223326",
              background:
                !chatInput.trim() || chatLoading || !activeProvider
                  ? "rgba(134,170,142,0.45)"
                  : "#a9d5b1",
              cursor:
                !chatInput.trim() || chatLoading || !activeProvider ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 700,
              flex: "0 0 auto",
            }}
          >
            {chatLoading ? chatDots : "发送"}
          </button>
        </form>
      )}
    </>
  );
}
