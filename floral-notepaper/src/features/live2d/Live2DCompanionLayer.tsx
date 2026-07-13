import { ensureCubismCore } from "./cubismSetup";
import { useCallback, useEffect, useRef, useState, type PointerEventHandler } from "react";
import { createLive2DScene, createLive2DModelController, processAgentUICommands } from "./index";
import type { Live2DModelController } from "./modelController";
import type { Live2DScene } from "./scene";
import { loadCompanionConfig, saveCompanionPosition, subscribeCompanionConfig } from "../../features/companion/companionConfig";
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

// #region debug-point D:live2d-layer-report
const reportLive2DDebug = (hypothesisId: string, location: string, msg: string, data: Record<string, unknown> = {}) => {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "live2d-cubism5", runId: "post-fix", hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() }),
  }).catch(() => undefined);
};
// #endregion

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

function resolveLive2DAssetPath(modelPath: string, assetPath: string) {
  const modelUrl = new URL(modelPath, window.location.origin);
  return new URL(assetPath, modelUrl).pathname;
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
  await Promise.all(assets.map((asset) => assertFetchOk(resolveLive2DAssetPath(modelPath, asset))));
}

export function Live2DCompanionLayer({ conversationId, surface = "embedded" }: Live2DCompanionLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Live2DScene | null>(null);
  const controllerRef = useRef<Live2DModelController | null>(null);
  const configRef = useRef<CompanionConfig>(loadCompanionConfig());
  const loadedModelPathRef = useRef<string | null>(null);
  const loadingModelRef = useRef(false);
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  const [config, setConfig] = useState<CompanionConfig>(loadCompanionConfig());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [draggingEmbedded, setDraggingEmbedded] = useState(false);
  const dragStateRef = useRef<EmbeddedDragState | null>(null);
  const dragTimerRef = useRef<number | null>(null);
  const latestPositionRef = useRef(config.position);
  const actionState = useCompanionEvents({
    ...config,
    enabled: config.enabled && config.visible && config.renderer === "live2d",
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

  const loadCurrentModel = useCallback(async () => {
    const scene = sceneRef.current;
    const controller = controllerRef.current;
    const currentConfig = configRef.current;
    if (!scene || !controller || !currentConfig.modelPath || loadingModelRef.current) return;
    if (!currentConfig.enabled || !currentConfig.visible || currentConfig.renderer !== "live2d") return;
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
      await controller.load(currentConfig.modelPath, scene.characterLayer);
      loadedModelPathRef.current = currentConfig.modelPath;
      controller.enableEyeFollow(true);
      controller.setMouseFollowStrength(currentConfig.sensitivity.mouseFollowStrength ?? 0.75);
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
  }, []);

  useEffect(() => {
    reportLive2DDebug("D", "Live2DCompanionLayer.tsx:initEffect", "init effect evaluated", {
      enabled: config.enabled,
      visible: config.visible,
      renderer: config.renderer,
      skinId: config.skinId,
      modelPath: config.modelPath,
    });

    if (!config.enabled || !config.visible || config.renderer !== "live2d") {
      reportLive2DDebug("D", "Live2DCompanionLayer.tsx:initEffect", "init skipped by companion config", {
        enabled: config.enabled,
        visible: config.visible,
        renderer: config.renderer,
      });
      return;
    }

    let cancelled = false;
    let scene: Live2DScene | null = null;
    let controller: Live2DModelController | null = null;
    let frameId: number | null = null;

    const init = async () => {
      await new Promise<void>((resolve) => {
        frameId = window.requestAnimationFrame(() => resolve());
      });
      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) {
        setLoadError("Live2D canvas not mounted");
        return;
      }

      try {
        reportLive2DDebug("C", "Live2DCompanionLayer.tsx:init", "calling ensureCubismCore", { modelPath: configRef.current.modelPath });
        await ensureCubismCore();
        reportLive2DDebug("C", "Live2DCompanionLayer.tsx:init", "ensureCubismCore resolved", { hasCore: !!(window as unknown as Record<string, unknown>).Live2DCubismCore });
        if (cancelled) return;

        const probeCanvas = document.createElement("canvas");
        const gl = probeCanvas.getContext("webgl2") || probeCanvas.getContext("webgl");
        reportLive2DDebug("B", "Live2DCompanionLayer.tsx:init", "WebGL context checked", {
          hasWebgl: !!gl,
          maxTextureSize: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : null,
        });
        if (!gl) {
          setLoadError("WebGL not available in Tauri WebView");
          return;
        }

        reportLive2DDebug("B", "Live2DCompanionLayer.tsx:init", "creating Live2D scene");
        scene = await createLive2DScene(canvas);
        sceneRef.current = scene;
        controller = createLive2DModelController(scene);
        controllerRef.current = controller;

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
      if (controller) controller.destroy();
      if (scene) scene.destroy();
      sceneRef.current = null;
      controllerRef.current = null;
      loadedModelPathRef.current = null;
      loadingModelRef.current = false;
    };
  }, [config.enabled, config.visible, config.renderer, loadCurrentModel]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;

    if (!config.enabled || !config.visible || config.renderer !== "live2d") {
      if (controller.model) controller.unload();
      loadedModelPathRef.current = null;
      setModelLoaded(false);
      return;
    }

    controller.setMouseFollowStrength(config.sensitivity.mouseFollowStrength ?? 0.75);
    void loadCurrentModel();
  }, [config.enabled, config.visible, config.renderer, config.modelPath, config.sensitivity.mouseFollowStrength, loadCurrentModel]);

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

    const width = LIVE2D_WIDTH * dragState.scale;
    const height = LIVE2D_HEIGHT * dragState.scale;
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);
    const position = {
      x: clamp(dragState.originX + event.clientX - dragState.startX, 8, maxX),
      y: clamp(dragState.originY + event.clientY - dragState.startY, 8, maxY),
    };

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
      if (surface === "floating") {
        void import("@tauri-apps/api/window")
          .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
          .catch(() => undefined);
        return;
      }

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
        active: false,
      };

      if (dragTimerRef.current !== null) {
        window.clearTimeout(dragTimerRef.current);
      }

      dragTimerRef.current = window.setTimeout(() => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== pointerId) return;
        dragState.active = true;
        setDraggingEmbedded(true);
      }, 180);
    },
    [surface],
  );

  useEffect(() => {
    if (!conversationId) return;

    const poll = () => {
      analyzeAgentConversation(conversationId)
        .then((result) => {
          const controller = controllerRef.current;
          if (!controller) return;

          processAgentUICommands(controller, result.suggestions.map((s) => s.payload as unknown as AgentUICommand).flat(), (text) => {
            setBubbleText(text);
            if (bubbleTimerRef.current !== null) {
              window.clearTimeout(bubbleTimerRef.current);
            }
            bubbleTimerRef.current = window.setTimeout(() => {
              setBubbleText(null);
              bubbleTimerRef.current = null;
            }, 5000);
          });
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

  if (!config.enabled || !config.visible || config.renderer !== "live2d") return null;

  return (
    <aside
      className={`live2d-companion-layer live2d-surface-${surface}`}
      style={{
        position: surface === "embedded" ? "fixed" : "relative",
        left: surface === "embedded" ? config.position.x : undefined,
        top: surface === "embedded" ? config.position.y : undefined,
        width: LIVE2D_WIDTH,
        height: LIVE2D_HEIGHT,
        zIndex: 999,
        opacity: config.opacity,
        transform: `scale(${config.scale})`,
        transformOrigin: "top left",
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
            top: 8,
            right: 8,
            width: 34,
            height: 34,
            zIndex: 2,
            border: "1px solid rgba(255,255,255,0.22)",
            borderRadius: 999,
            background: draggingEmbedded ? "rgba(0,112,192,0.76)" : "rgba(20,20,20,0.36)",
            color: "#fff",
            cursor: surface === "embedded" ? "grab" : "move",
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
              textShadow: "0 1px 4px rgba(0,0,0,0.7)",
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
