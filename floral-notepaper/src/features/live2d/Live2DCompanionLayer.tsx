import { ensureCubismCore } from "./cubismSetup";
import { useCallback, useEffect, useRef, useState, type PointerEventHandler } from "react";
import { createLive2DScene, createLive2DModelController, processAgentUICommands } from "./index";
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

interface Live2DCompanionLayerProps {
  conversationId?: string | null;
  surface?: "embedded" | "floating";
}

const LIVE2D_WIDTH = 260;
const LIVE2D_HEIGHT = 380;
const LIVE2D_SCALE_STEP = 0.05;
const LIVE2D_DRAG_HANDLE_SIZE = 34;
const LIVE2D_SAFE_MARGIN = 8;

const reportLive2DDebug = (hypothesisId: string, location: string, msg: string, data?: unknown) => {
  fetch("http://127.0.0.1:7778/event", {
    method: "POST",
    body: JSON.stringify({
      sessionId: "live2d-scale-bug",
      runId: "post-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => undefined);
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

function getCenteredScalePosition(position: CompanionConfig["position"], fromScale: number, toScale: number) {
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

function getElementDebugSnapshot(element: Element | null) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return {
    tagName: element.tagName,
    className: typeof element.className === "string" ? element.className : null,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    client: element instanceof HTMLElement ? { width: element.clientWidth, height: element.clientHeight } : null,
    css: {
      width: style.width,
      height: style.height,
      maxWidth: style.maxWidth,
      maxHeight: style.maxHeight,
      overflow: style.overflow,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      position: style.position,
      transform: style.transform,
      transformOrigin: style.transformOrigin,
      willChange: style.willChange,
      contain: style.contain,
      isolation: style.isolation,
    },
  };
}

type PixiDebugObject = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  alpha?: number;
  visible?: boolean;
  renderable?: boolean;
  scale?: { x?: number; y?: number };
  position?: { x?: number; y?: number };
  pivot?: { x?: number; y?: number };
  getBounds?: () => { x: number; y: number; width: number; height: number };
};

function getPixiDebugSnapshot(value: unknown) {
  const object = value as PixiDebugObject | null;
  if (!object) return null;
  let bounds: { x: number; y: number; width: number; height: number } | null = null;
  try {
    const nextBounds = object.getBounds?.();
    bounds = nextBounds ? { x: nextBounds.x, y: nextBounds.y, width: nextBounds.width, height: nextBounds.height } : null;
  } catch {
    bounds = null;
  }
  return {
    x: object.x ?? object.position?.x ?? null,
    y: object.y ?? object.position?.y ?? null,
    width: object.width ?? null,
    height: object.height ?? null,
    scale: { x: object.scale?.x ?? null, y: object.scale?.y ?? null },
    pivot: { x: object.pivot?.x ?? null, y: object.pivot?.y ?? null },
    visible: object.visible ?? null,
    renderable: object.renderable ?? null,
    alpha: object.alpha ?? null,
    bounds,
  };
}

function getLayerCropDebugSnapshot(container: HTMLElement | null, canvas: HTMLCanvasElement | null, scene: Live2DScene | null, scale: number) {
  const card = canvas?.closest(".live2d-companion-card") ?? null;
  const gl = canvas ? canvas.getContext("webgl2") || canvas.getContext("webgl") : null;
  const model = scene?.characterLayer.children[0] ?? null;
  return {
    scale,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
    layer: getElementDebugSnapshot(container),
    card: getElementDebugSnapshot(card),
    canvas: getElementDebugSnapshot(canvas),
    parentChain: [container, card, canvas?.parentElement, canvas]
      .filter((element, index, list): element is Element => Boolean(element) && list.indexOf(element) === index)
      .map((element) => getElementDebugSnapshot(element)),
    canvasPixels: canvas ? { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight } : null,
    renderer: scene
      ? {
          resolution: scene.app.renderer.resolution,
          screen: { width: scene.app.screen.width, height: scene.app.screen.height },
          canvasPixels: { width: scene.app.canvas.width, height: scene.app.canvas.height },
          characterLayer: getPixiDebugSnapshot(scene.characterLayer),
          model: getPixiDebugSnapshot(model),
        }
      : null,
    gl: gl ? { viewport: Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array), contextAttributes: gl.getContextAttributes?.() ?? null } : null,
  };
}

function resolveLive2DAssetPath(modelPath: string, assetPath: string) {
  const modelUrl = new URL(modelPath, window.location.origin);
  return new URL(assetPath, modelUrl).pathname;
}

function isCanvasLayoutReady(canvas: HTMLCanvasElement) {
  const parent = canvas.parentElement;
  const rect = canvas.getBoundingClientRect();
  return Boolean(parent && parent.isConnected && rect.width > 0 && rect.height > 0 && parent.clientWidth > 0 && parent.clientHeight > 0);
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

  const assets = [refs.Moc, ...refs.Textures, refs.Physics, refs.DisplayInfo].filter(Boolean) as string[];
  const resolvedAssets = assets.map((asset) => resolveLive2DAssetPath(modelPath, asset));
  reportLive2DDebug("A", "Live2DCompanionLayer.tsx:validateLive2DModelAssets", "validating model asset references", {
    modelPath,
    moc: refs.Moc,
    textureCount: refs.Textures.length,
    physics: refs.Physics ?? null,
    displayInfo: refs.DisplayInfo ?? null,
    resolvedAssets,
  });
  await Promise.all(resolvedAssets.map((asset) => assertFetchOk(asset)));
}

export function Live2DCompanionLayer({ conversationId, surface = "embedded" }: Live2DCompanionLayerProps) {
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
  const dragStateRef = useRef<EmbeddedDragState | null>(null);
  const dragTimerRef = useRef<number | null>(null);
  const latestPositionRef = useRef(config.position);
  // 嵌入式层仅在非浮动模式激活，浮动窗口仅在 floating 模式激活，避免同一配置双份渲染
  const isSurfaceActive = surface === "floating" ? config.mode === "floating" : config.mode !== "floating";
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
    };
  }, []);

  useEffect(() => {
    reportLive2DDebug("D", "Live2DCompanionLayer.tsx:mount", "Live2D layer mounted", {
      enabled: configRef.current.enabled,
      visible: configRef.current.visible,
      renderer: configRef.current.renderer,
      skinId: configRef.current.skinId,
      modelPath: configRef.current.modelPath,
      surface,
    });

    const unsub = subscribeCompanionConfig((next) => {
      reportLive2DDebug("D", "Live2DCompanionLayer.tsx:subscribeCompanionConfig", "companion config changed", {
        enabled: next.enabled,
        visible: next.visible,
        renderer: next.renderer,
        skinId: next.skinId,
        modelPath: next.modelPath,
      });
      configRef.current = next;
      setConfig(next);
    });
    return unsub;
  }, [surface]);

  const showBubble = useCallback((text: string) => {
    setBubbleText(text);
    if (bubbleTimerRef.current !== null) {
      window.clearTimeout(bubbleTimerRef.current);
    }
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubbleText(null);
      bubbleTimerRef.current = null;
    }, 5000);
  }, []);

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
    if (!currentConfig.enabled || !currentConfig.visible || currentConfig.renderer !== "live2d") return;
    if (surface === "floating" ? currentConfig.mode !== "floating" : currentConfig.mode === "floating") return;
    if (controller.model && loadedModelPathRef.current === currentConfig.modelPath) return;

    loadingModelRef.current = true;
    reportLive2DDebug("D", "Live2DCompanionLayer.tsx:loadCurrentModel", "loadCurrentModel enter", {
      modelPath: currentConfig.modelPath,
      renderer: currentConfig.renderer,
      skinId: currentConfig.skinId,
      loadedModelPath: loadedModelPathRef.current,
    });
    try {
      setModelLoaded(false);
      setLoadError(null);
      await validateLive2DModelAssets(currentConfig.modelPath);
      reportLive2DDebug("D", "Live2DCompanionLayer.tsx:loadCurrentModel", "model assets validated", { modelPath: currentConfig.modelPath });

      // 统一走项目自研 Pixi v8 渲染器，避免低版本 MOC3 被误分流到 SDK renderer。
      const backend = await pickLive2DRenderBackend(currentConfig.modelPath);
      if (backend !== backendRef.current) {
        controllerRef.current?.destroy();
        const next = await buildController(backend);
        controllerRef.current = next;
        backendRef.current = backend;
        reportLive2DDebug("D", "Live2DCompanionLayer.tsx:loadCurrentModel", "render backend switched", { backend });
      }

      const active = controllerRef.current;
      if (!active) throw new Error("Live2D controller not ready");
      await active.load(currentConfig.modelPath, sceneRef.current?.characterLayer);
      loadedModelPathRef.current = currentConfig.modelPath;
      active.enableEyeFollow(true);
      active.setMouseFollowStrength(currentConfig.sensitivity.mouseFollowStrength ?? 0.75);
      active.setScale(currentConfig.scale);
      setModelLoaded(true);
      reportLive2DDebug("D", "Live2DCompanionLayer.tsx:loadCurrentModel", "model load completed", { modelPath: currentConfig.modelPath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reportLive2DDebug("D", "Live2DCompanionLayer.tsx:loadCurrentModel", "model load failed", {
        modelPath: currentConfig.modelPath,
        message: msg,
        stack: err instanceof Error ? err.stack : null,
      });
      console.error("[Live2D] Model load failed:", err);
      setLoadError(msg);
    } finally {
      loadingModelRef.current = false;
    }
  }, [surface, buildController]);

  useEffect(() => {
    reportLive2DDebug("D", "Live2DCompanionLayer.tsx:initEffect", "init effect evaluated", {
      enabled: config.enabled,
      visible: config.visible,
      renderer: config.renderer,
      skinId: config.skinId,
      modelPath: config.modelPath,
    });

    if (!config.enabled || !config.visible || config.renderer !== "live2d" || !isSurfaceActive) {
      reportLive2DDebug("D", "Live2DCompanionLayer.tsx:initEffect", "init skipped by companion config", {
        enabled: config.enabled,
        visible: config.visible,
        renderer: config.renderer,
        mode: config.mode,
        surface,
        isSurfaceActive,
      });
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
        reportLive2DDebug("B", "Live2DCompanionLayer.tsx:init", "canvas layout not ready", {
          isConnected: canvas.isConnected,
          parentConnected: canvas.parentElement?.isConnected ?? false,
          parentClientWidth: canvas.parentElement?.clientWidth ?? null,
          parentClientHeight: canvas.parentElement?.clientHeight ?? null,
          rect: (() => {
            const rect = canvas.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          })(),
        });
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

      reportLive2DDebug("B", "Live2DCompanionLayer.tsx:init", "canvas resolved before init", {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        boundingRect: (() => {
          const rect = canvas.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })(),
        canvasBackground: window.getComputedStyle(canvas).backgroundColor,
        parentBackground: canvas.parentElement ? window.getComputedStyle(canvas.parentElement).backgroundColor : null,
        layerBackground: canvas.closest(".live2d-companion-layer") ? window.getComputedStyle(canvas.closest(".live2d-companion-layer") as Element).backgroundColor : null,
        cardBackground: canvas.closest(".live2d-companion-card") ? window.getComputedStyle(canvas.closest(".live2d-companion-card") as Element).backgroundColor : null,
        live2dCanvasCount: document.querySelectorAll("canvas.live2d-canvas").length,
        allCanvasCount: document.querySelectorAll("canvas").length,
        parentTag: canvas.parentElement?.tagName ?? null,
        parentClientWidth: canvas.parentElement?.clientWidth ?? null,
        parentClientHeight: canvas.parentElement?.clientHeight ?? null,
      });

      try {
        reportLive2DDebug("C", "Live2DCompanionLayer.tsx:init", "picking Live2D render backend", { modelPath: configRef.current.modelPath });
        const backend = await pickLive2DRenderBackend(configRef.current.modelPath);
        reportLive2DDebug("C", "Live2DCompanionLayer.tsx:init", "render backend resolved", {
          backend,
          hasCubismCore: !!(window as unknown as Record<string, unknown>).Live2DCubismCore,
        });
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
      if (!configRef.current.enabled || !configRef.current.visible || configRef.current.renderer !== "live2d" || !isSurfaceActive) return;

      event.preventDefault();
      event.stopPropagation();
      const latest = loadCompanionConfig();
      const next = resolveScaleUpdate(latest, direction);
      if (!next) return;

      saveCompanionConfig(next);
      configRef.current = next;
      latestPositionRef.current = next.position;
      setConfig(next);
      sceneRef.current?.setQualityScale(next.scale);
      reportLive2DDebug("S", "Live2DCompanionLayer.tsx:scaleShortcut", "keyboard scale shortcut applied", {
        direction,
        scale: next.scale,
        position: next.position,
        key: event.key,
        code: event.code,
      });
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isSurfaceActive]);

  useEffect(() => {
    sceneRef.current?.setQualityScale(clampScale(config.scale));
    controllerRef.current?.setScale(config.scale);
    reportLive2DDebug("CROP", "Live2DCompanionLayer.tsx:scaleEffect", "layer scale snapshot", getLayerCropDebugSnapshot(layerRef.current, canvasRef.current, sceneRef.current, config.scale));
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
  }, [config.enabled, config.visible, config.renderer, config.modelPath, config.mode, config.sensitivity.mouseFollowStrength, loadCurrentModel]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      controllerRef.current?.focusAt(event.clientX, event.clientY);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
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
          : action === "moveLeft" || action === "moveRight" || action === "moveUp" || action === "moveDown"
            ? "F06"
            : "F04";

    const motionIndex = actionState.paw === "left" ? 0 : actionState.paw === "right" ? 1 : action === "complete" ? 3 : 2;
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

  const handlePointerDown: PointerEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pointerId = event.pointerId;
      event.currentTarget.setPointerCapture(pointerId);
      dragStateRef.current = {
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: configRef.current.position.x,
        originY: configRef.current.position.y,
        scale: configRef.current.scale,
        active: true,
      };

      if (dragTimerRef.current !== null) {
        window.clearTimeout(dragTimerRef.current);
        dragTimerRef.current = null;
      }
      setDraggingEmbedded(true);
    },
    [],
  );

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

  if (!config.enabled || !config.visible || config.renderer !== "live2d" || !isSurfaceActive) return null;

  const scaledSize = getScaledLive2DSize(config.scale);

  return (
    <aside
      ref={layerRef}
      style={{
        position: surface === "embedded" ? "fixed" : "relative",
        left: surface === "embedded" ? config.position.x : undefined,
        top: surface === "embedded" ? config.position.y : undefined,
        width: scaledSize.width,
        height: scaledSize.height,
        zIndex: 999,
        opacity: clamp(config.opacity, 0.2, 1),
        pointerEvents: draggingEmbedded ? "auto" : "none",
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
          aria-label="长按拖动 Live2D"
          title="长按拖动 Live2D"
          onPointerDown={handlePointerDown}
          onPointerUp={handleEmbeddedDragEnd}
          onPointerCancel={handleEmbeddedDragEnd}
          style={{
            position: "absolute",
            left: LIVE2D_SAFE_MARGIN,
            bottom: LIVE2D_SAFE_MARGIN,
            width: LIVE2D_DRAG_HANDLE_SIZE,
            height: LIVE2D_DRAG_HANDLE_SIZE,
            zIndex: 2,
            borderRadius: 999,
            background: draggingEmbedded ? "rgba(71, 202, 54, 0.76)" : "rgba(20,20,20,0.36)",
            color: "#fff",
            cursor: "grab",
            fontSize: 16,
            lineHeight: "30px",
            pointerEvents: "auto",
            userSelect: "none",
            backdropFilter: "blur(6px)",
          }}
        >
          ↕
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
              top: 18,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(20,20,20,0.72)",
              color: "#fff",
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              whiteSpace: "nowrap",
              maxWidth: 260,
              overflow: "hidden",
              textOverflow: "ellipsis",
              pointerEvents: "none",
            }}
          >
            {bubbleText}
          </div>
        )}
      </div>
    </aside>
  );
}
