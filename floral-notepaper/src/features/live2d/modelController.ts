// Type-only import — 编译时完全擦除，不会触发模块级副作用
import type { Live2DModel, MotionPriority as Live2DMotionPriority } from "@naari3/pixi-live2d-display/cubism5";
import type { Container, FederatedPointerEvent, FederatedWheelEvent } from "pixi.js";
import type { Live2DScene } from "./scene";

const MotionPriority = {
  NONE: 0 as Live2DMotionPriority,
  IDLE: 1 as Live2DMotionPriority,
  NORMAL: 2 as Live2DMotionPriority,
  FORCE: 3 as Live2DMotionPriority,
} as const;
type MotionPriority = Live2DMotionPriority;

// #region debug-point A:model-controller-report
const reportModelDebug = (hypothesisId: string, location: string, msg: string, data: Record<string, unknown> = {}) => {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "live2d-cubism5", runId: "post-fix", hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() }),
  }).catch(() => undefined);
};
// #endregion

type Live2DModel3Json = {
  url?: string;
  HitAreas?: Array<Record<string, unknown>>;
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
    Pose?: string;
    DisplayInfo?: string;
    Expressions?: Array<Record<string, unknown>>;
    Motions?: Record<string, Array<Record<string, unknown>>>;
  };
};

async function loadNormalizedModel3Json(modelUrl: string): Promise<Live2DModel3Json> {
  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error(`Live2D model settings not found: ${modelUrl} (${response.status})`);
  }

  const json = (await response.json()) as Live2DModel3Json;
  json.url = modelUrl;
  json.HitAreas = Array.isArray(json.HitAreas) ? json.HitAreas : [];

  if (json.FileReferences) {
    json.FileReferences.Expressions = Array.isArray(json.FileReferences.Expressions) ? json.FileReferences.Expressions : [];
    json.FileReferences.Motions = json.FileReferences.Motions && typeof json.FileReferences.Motions === "object" ? json.FileReferences.Motions : {};
  }

  return json;
}

type Live2DCoreModelParameterId = {
  getString?: () => { s?: string } | string;
};

type Live2DCoreModelParameterApi = {
  getParameterCount?: () => number;
  getParameterId?: (index: number) => Live2DCoreModelParameterId | string;
  getParameterValueByIndex?: (index: number) => number;
  setParameterValueByIndex?: (index: number, value: number, weight?: number) => void;
};

const AQUARIUS_MODEL_MARKER = "aquarius-love";
const AQUARIUS_COPYRIGHT_HIDE_DELAY_MS = 1000;
const AQUARIUS_COPYRIGHT_HIDE_VALUE = 0;
const AQUARIUS_COPYRIGHT_TEXTURE_INDEX = 3;

type Live2DDrawableModelApi = {
  getDrawableTextureIndex?: (index: number) => number;
};

type AquariusCopyrightRendererApi = {
  drawMeshWebGL?: (drawableModel: Live2DDrawableModelApi, index: number, ...args: unknown[]) => void;
  __aquariusOriginalDrawMeshWebGL?: (drawableModel: Live2DDrawableModelApi, index: number, ...args: unknown[]) => void;
  __aquariusShouldHideCopyrightTexture?: () => boolean;
};

type Live2DRendererInternalApi = {
  internalModel?: {
    renderer?: AquariusCopyrightRendererApi;
  };
};

function isAquariusModel(modelUrl: string) {
  return decodeURIComponent(modelUrl).includes(AQUARIUS_MODEL_MARKER);
}

function getCoreModelParameterApi(live2dModel: Live2DModel | null): Live2DCoreModelParameterApi | null {
  return (live2dModel?.internalModel?.coreModel ?? null) as Live2DCoreModelParameterApi | null;
}

function getParameterIdString(id: Live2DCoreModelParameterId | string | undefined) {
  if (typeof id === "string") return id;
  const value = id?.getString?.();
  return typeof value === "string" ? value : value?.s;
}

function getParameterIndexById(core: Live2DCoreModelParameterApi, id: string) {
  const count = core.getParameterCount?.() ?? 0;
  for (let index = 0; index < count; index += 1) {
    if (getParameterIdString(core.getParameterId?.(index)) === id) return index;
  }
  return -1;
}

function setParameterIfPresent(core: Live2DCoreModelParameterApi, id: string, value: number) {
  const index = getParameterIndexById(core, id);
  if (index < 0) return false;
  core.setParameterValueByIndex?.(index, value, 1);
  return true;
}

function getAquariusRenderer(live2dModel: Live2DModel) {
  return (live2dModel as unknown as Live2DRendererInternalApi).internalModel?.renderer ?? null;
}

function patchAquariusCopyrightTextureDraw(live2dModel: Live2DModel, shouldHide: () => boolean) {
  const renderer = getAquariusRenderer(live2dModel);
  if (!renderer?.drawMeshWebGL) return false;

  if (!renderer.__aquariusOriginalDrawMeshWebGL) {
    renderer.__aquariusOriginalDrawMeshWebGL = renderer.drawMeshWebGL.bind(renderer);
    renderer.drawMeshWebGL = (drawableModel, index, ...args) => {
      if (renderer.__aquariusShouldHideCopyrightTexture?.() && drawableModel.getDrawableTextureIndex?.(index) === AQUARIUS_COPYRIGHT_TEXTURE_INDEX) {
        return;
      }
      renderer.__aquariusOriginalDrawMeshWebGL?.(drawableModel, index, ...args);
    };
  }

  renderer.__aquariusShouldHideCopyrightTexture = shouldHide;
  return true;
}

function applyAquariusCopyrightNoticeHidden(live2dModel: Live2DModel) {
  const core = getCoreModelParameterApi(live2dModel);
  if (!core) return [false, false];

  return [
    setParameterIfPresent(core, "ParamTrans", AQUARIUS_COPYRIGHT_HIDE_VALUE),
    setParameterIfPresent(core, "ParamSite", AQUARIUS_COPYRIGHT_HIDE_VALUE),
  ];
}

function getAquariusCopyrightNoticeState(live2dModel: Live2DModel) {
  const core = getCoreModelParameterApi(live2dModel);
  if (!core) return null;

  return {
    ParamSite: core.getParameterValueByIndex?.(getParameterIndexById(core, "ParamSite")),
    ParamTrans: core.getParameterValueByIndex?.(getParameterIndexById(core, "ParamTrans")),
  };
}

function scheduleAquariusCopyrightNoticeHide(modelUrl: string, live2dModel: Live2DModel, isCurrentModel: () => boolean, onHidden: () => void) {
  if (!isAquariusModel(modelUrl)) return null;

  return window.setTimeout(() => {
    if (!isCurrentModel()) return;

    const before = getAquariusCopyrightNoticeState(live2dModel);
    const changed = applyAquariusCopyrightNoticeHidden(live2dModel);
    onHidden();
    const after = getAquariusCopyrightNoticeState(live2dModel);

    reportModelDebug("W", "modelController.ts:scheduleAquariusCopyrightNoticeHide", "Aquarius copyright notice hide parameters applied", {
      modelUrl,
      changed,
      before,
      after,
    });
  }, AQUARIUS_COPYRIGHT_HIDE_DELAY_MS);
}

export interface Live2DModelController {
  model: Live2DModel | null;
  load: (modelUrl: string, characterLayer: Container) => Promise<void>;
  unload: () => void;
  setPosition: (x: number, y: number) => void;
  setScale: (scale: number) => void;
  playMotion: (group: string, index?: number) => void;
  setExpression: (expressionId: string) => Promise<void>;
  removeAllExpressions: () => void;
  setMouthValue: (value: number) => void;
  pulseMouth: (durationMs?: number) => void;
  focusAt: (clientX: number, clientY: number) => void;
  enableEyeFollow: (enabled: boolean) => void;
  setMouseFollowStrength: (strength: number) => void;
  destroy: () => void;
}

export function createLive2DModelController(live2dScene: Live2DScene): Live2DModelController {
  let model: Live2DModel | null = null;
  let eyeFollowEnabled = false;
  let mouseFollowStrength = 1;
  let mouthValue = 0;
  let baseScale = 1;
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let mouthTimer: number | null = null;
  let idleTimer: number | null = null;
  let aquariusCopyrightTimer: number | null = null;
  let aquariusCopyrightHidden = false;
  let aquariusCopyrightHandler: (() => void) | null = null;
  let runtimeTick: (() => void) | null = null;
  let heartbeatPhase = 0;

  const clearIdleTimer = () => {
    if (idleTimer !== null) {
      window.clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const focusAtStagePoint = (x: number, y: number) => {
    if (!eyeFollowEnabled || !model?.internalModel?.focusController) return;
    const centerX = live2dScene.app.screen.width / 2;
    const centerY = live2dScene.app.screen.height / 2;
    const dx = centerX > 0 ? (x - centerX) / centerX : 0;
    const dy = centerY > 0 ? (centerY - y) / centerY : 0;
    model.internalModel.focusController.focus(dx * mouseFollowStrength, dy * mouseFollowStrength);
  };

  const handlePointerDown = (e: FederatedPointerEvent) => {
    if (!model) return;
    dragging = true;
    dragOffsetX = model.x - e.global.x;
    dragOffsetY = model.y - e.global.y;

    try {
      const canvas = live2dScene.app.canvas as unknown as HTMLElement;
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // 当前 WebView 不支持 pointer capture 时忽略
    }
  };

  const handlePointerMove = (e: FederatedPointerEvent) => {
    if (dragging && model) {
      model.x = e.global.x + dragOffsetX;
      model.y = e.global.y + dragOffsetY;
    }

    focusAtStagePoint(e.global.x, e.global.y);
  };

  const handlePointerUp = () => {
    dragging = false;
  };

  const handleWheel = (e: FederatedWheelEvent) => {
    if (!model) return;
    const currentScale = baseScale > 0 ? model.scale.x / baseScale : 1;
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const nextScale = Math.min(2.4, Math.max(0.45, currentScale + delta));
    model.scale.set(baseScale * nextScale);
  };

  let mouthHandler: (() => void) | null = null;

  const applyMouthValue = () => {
    if (!model?.internalModel?.coreModel) return;
    const core = model.internalModel.coreModel as {
      setParameterValueById?: (id: string, value: number, weight?: number) => void;
    };
    core.setParameterValueById?.("ParamMouthOpenY", mouthValue);
  };

  const applyHeartbeat = (deltaMs: number) => {
    if (!model?.internalModel?.coreModel) return;
    heartbeatPhase += deltaMs / 1000;

    const core = model.internalModel.coreModel as {
      setParameterValueById?: (id: string, value: number, weight?: number) => void;
    };

    const breath = Math.sin(heartbeatPhase * 1.8) * 0.45;
    const bodyAngle = Math.sin(heartbeatPhase * 0.9) * 1.8;
    const headAngle = Math.sin(heartbeatPhase * 1.15) * 1.2;

    core.setParameterValueById?.("ParamBreath", breath, 0.35);
    core.setParameterValueById?.("ParamBodyAngleX", bodyAngle, 0.18);
    core.setParameterValueById?.("ParamAngleZ", headAngle, 0.12);
  };

  const startRuntimeLoop = () => {
    if (runtimeTick) return;

    runtimeTick = () => {
      if (!model) return;

      const deltaMs = Math.min(live2dScene.app.ticker.deltaMS || 16.67, 66.67);
      model.update(deltaMs);
      applyHeartbeat(deltaMs);

      if (mouthValue > 0) {
        mouthValue = Math.max(0, mouthValue - deltaMs / 420);
      }
    };

    live2dScene.app.ticker.add(runtimeTick);
    live2dScene.app.ticker.start();
  };

  const stopRuntimeLoop = () => {
    if (!runtimeTick) return;
    live2dScene.app.ticker.remove(runtimeTick);
    runtimeTick = null;
  };

  const scheduleIdleMotion = () => {
    clearIdleTimer();
    if (!model) return;

    const delay = 5000 + Math.round(Math.random() * 3500);
    idleTimer = window.setTimeout(() => {
      if (!model) return;
      const index = Math.random() > 0.5 ? 1 : 0;
      model.motion("Idle", index, MotionPriority.IDLE).catch(() => undefined);
      scheduleIdleMotion();
    }, delay);
  };

  return {
    get model() {
      return model;
    },

    async load(modelUrl: string, characterLayer: Container) {
      reportModelDebug("A", "modelController.ts:load", "model load enter", { modelUrl, hadExistingModel: !!model });
      if (model) {
        this.unload();
      }

      reportModelDebug("A", "modelController.ts:load", "importing cubism5 model runtime", { modelUrl });
      const { Live2DModel: L2DModel } = await import("@naari3/pixi-live2d-display/cubism5");
      reportModelDebug("A", "modelController.ts:load", "cubism5 model runtime imported", { modelUrl });
      const normalizedModelJson = await loadNormalizedModel3Json(modelUrl);
      reportModelDebug("A", "modelController.ts:load", "model3 json normalized", {
        modelUrl,
        hitAreaCount: normalizedModelJson.HitAreas?.length ?? 0,
        hasMotions: !!normalizedModelJson.FileReferences?.Motions,
        textureCount: normalizedModelJson.FileReferences?.Textures?.length ?? 0,
      });
      const loaded = await L2DModel.from(normalizedModelJson, { autoHitTest: false, autoFocus: false, autoUpdate: false, ticker: live2dScene.app.ticker });
      reportModelDebug("D", "modelController.ts:load", "Live2DModel.from resolved", {
        modelUrl,
        width: loaded.width,
        height: loaded.height,
        hasInternalModel: !!loaded.internalModel,
      });

      model = loaded as Live2DModel;
      const currentModel = model;
      (currentModel as unknown as { setRenderer?: (renderer: unknown) => void }).setRenderer?.(live2dScene.app.renderer);
      currentModel.anchor.set(0.5, 0.5);

      const screenWidth = live2dScene.app.screen.width || 360;
      const screenHeight = live2dScene.app.screen.height || 520;
      const modelWidth = Math.max(currentModel.width || screenWidth, 1);
      const modelHeight = Math.max(currentModel.height || screenHeight, 1);
      baseScale = Math.min(screenWidth / modelWidth, screenHeight / modelHeight) * 0.96;
      currentModel.scale.set(baseScale);
      currentModel.x = screenWidth / 2;
      currentModel.y = screenHeight * 0.56;

      characterLayer.addChild(currentModel as unknown as Container);

      currentModel.on("pointerdown", handlePointerDown);
      live2dScene.stage.on("pointermove", handlePointerMove);
      live2dScene.stage.on("pointerup", handlePointerUp);
      live2dScene.stage.on("pointerupoutside", handlePointerUp);
      live2dScene.stage.on("wheel", handleWheel);

      if (currentModel.internalModel) {
        mouthHandler = applyMouthValue;
        currentModel.internalModel.on("beforeModelUpdate", mouthHandler);
        if (isAquariusModel(modelUrl)) {
          const patched = patchAquariusCopyrightTextureDraw(currentModel, () => aquariusCopyrightHidden && model === currentModel);
          reportModelDebug("W", "modelController.ts:load", "Aquarius copyright texture draw patched", {
            modelUrl,
            patched,
            textureIndex: AQUARIUS_COPYRIGHT_TEXTURE_INDEX,
          });
          aquariusCopyrightHandler = () => {
            if (aquariusCopyrightHidden && model === currentModel) {
              applyAquariusCopyrightNoticeHidden(currentModel);
            }
          };
          currentModel.internalModel.on("beforeModelUpdate", aquariusCopyrightHandler);
        }
      }

      startRuntimeLoop();
      aquariusCopyrightTimer = scheduleAquariusCopyrightNoticeHide(modelUrl, currentModel, () => model === currentModel, () => {
        aquariusCopyrightHidden = true;
      });
      currentModel.motion("Idle", 0, MotionPriority.IDLE).catch(() => undefined);
      scheduleIdleMotion();
    },

    unload() {
      if (!model) return;

      model.off("pointerdown", handlePointerDown);
      live2dScene.stage.off("pointermove", handlePointerMove);
      live2dScene.stage.off("pointerup", handlePointerUp);
      live2dScene.stage.off("pointerupoutside", handlePointerUp);
      live2dScene.stage.off("wheel", handleWheel);

      clearIdleTimer();
      if (aquariusCopyrightTimer !== null) {
        window.clearTimeout(aquariusCopyrightTimer);
        aquariusCopyrightTimer = null;
      }
      stopRuntimeLoop();

      if (mouthTimer !== null) {
        window.clearTimeout(mouthTimer);
        mouthTimer = null;
      }

      if (mouthHandler && model.internalModel) {
        model.internalModel.off("beforeModelUpdate", mouthHandler);
        mouthHandler = null;
      }

      if (aquariusCopyrightHandler && model.internalModel) {
        model.internalModel.off("beforeModelUpdate", aquariusCopyrightHandler);
        aquariusCopyrightHandler = null;
      }

      const parent = model.parent;
      if (parent) {
        parent.removeChild(model);
      }
      model.destroy();
      model = null;
      dragging = false;
      aquariusCopyrightHidden = false;
      mouthValue = 0;
      baseScale = 1;
    },

    setPosition(x: number, y: number) {
      if (model) {
        model.x = x;
        model.y = y;
      }
    },

    setScale(scale: number) {
      if (model) {
        model.scale.set(baseScale * scale);
      }
    },

    playMotion(group: string, index?: number) {
      if (model) {
        clearIdleTimer();
        void model.motion(group, index, MotionPriority.NORMAL).catch(() => undefined).finally(() => {
          scheduleIdleMotion();
        });
      }
    },

    async setExpression(expressionId: string) {
      if (model) {
        await model.expression(expressionId);
      }
    },

    removeAllExpressions() {
      if (model) {
        model.expression(void 0).catch(() => undefined);
      }
    },

    setMouthValue(value: number) {
      mouthValue = Math.min(1, Math.max(0, value));
    },

    pulseMouth(durationMs = 220) {
      this.setMouthValue(0.85);
      if (mouthTimer !== null) window.clearTimeout(mouthTimer);
      mouthTimer = window.setTimeout(() => {
        mouthValue = 0;
        mouthTimer = null;
      }, durationMs);
    },

    focusAt(clientX: number, clientY: number) {
      const canvas = live2dScene.app.canvas as unknown as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = ((clientX - rect.left) / rect.width) * live2dScene.app.screen.width;
      const y = ((clientY - rect.top) / rect.height) * live2dScene.app.screen.height;
      focusAtStagePoint(x, y);
    },

    enableEyeFollow(enabled: boolean) {
      eyeFollowEnabled = enabled;
    },

    setMouseFollowStrength(strength: number) {
      mouseFollowStrength = strength;
    },

    destroy() {
      this.unload();
    },
  };
}
