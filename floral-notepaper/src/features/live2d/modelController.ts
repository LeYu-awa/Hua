// Type-only import — 编译时完全擦除，不会触发模块级副作用
import type { Live2DModel, MotionPriority as Live2DMotionPriority } from "@naari3/pixi-live2d-display/cubism5";
import type { Container } from "pixi.js";
import { Assets, Cache, TextureSource, loadTextures } from "pixi.js";
import type { EmotionIntent } from "@soullink-emotion/engine";
import type { SoullinkCoreModelApi, SoullinkLocalMood } from "./soullinkLocalEngine";
import { SoullinkLocalEngineAdapter } from "./soullinkLocalEngine";
import type { Live2DScene } from "./scene";

const MotionPriority = {
  NONE: 0 as Live2DMotionPriority,
  IDLE: 1 as Live2DMotionPriority,
  NORMAL: 2 as Live2DMotionPriority,
  FORCE: 3 as Live2DMotionPriority,
} as const;
type MotionPriority = Live2DMotionPriority;

// #region debug-point D:model-controller-report
const reportModelDebug = (hypothesisId: string, location: string, msg: string, data?: unknown) => {
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
    Expressions?: Array<{ Name?: string; File?: string }>;
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
    const expressions = Array.isArray(json.FileReferences.Expressions)
      ? json.FileReferences.Expressions.filter((expression) => typeof expression.File === "string" && expression.File.trim().length > 0)
      : [];

    if (expressions.length > 0) {
      json.FileReferences.Expressions = expressions;
    } else {
      delete json.FileReferences.Expressions;
    }

    json.FileReferences.Motions = json.FileReferences.Motions && typeof json.FileReferences.Motions === "object" ? json.FileReferences.Motions : {};
  }

  return json;
}

function resolveModelAssetUrl(modelUrl: string, path: string) {
  try {
    return new URL(path, modelUrl).href;
  } catch {
    const base = modelUrl.endsWith("/") ? modelUrl : modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1);
    return base + path;
  }
}

function resolveModelAssetUrlCandidates(modelUrl: string, path: string) {
  const resolved = resolveModelAssetUrl(modelUrl, path);
  const candidates = [resolved];
  try {
    candidates.push(new URL(resolved, window.location.href).href);
  } catch {
    // Keep the runtime-style URL only.
  }
  return Array.from(new Set(candidates));
}

async function unloadCachedModelTextures(modelUrl: string, modelJson: Live2DModel3Json) {
  const textures = modelJson.FileReferences?.Textures ?? [];
  const urls = textures.flatMap((texture) => resolveModelAssetUrlCandidates(modelUrl, texture));
  await Promise.all(
    urls.map(async (url) => {
      if (!Cache.has(url)) return;
      try {
        await Assets.unload(url);
      } catch {
        Cache.remove(url);
      }
    }),
  );
  return urls.length;
}

function configureLive2DTextureLoading() {
  if (!loadTextures.config) return false;
  loadTextures.config.preferWorkers = false;
  loadTextures.config.preferCreateImageBitmap = false;
  TextureSource.defaultOptions.autoGenerateMipmaps = true;
  TextureSource.defaultOptions.magFilter = "linear";
  TextureSource.defaultOptions.minFilter = "linear";
  TextureSource.defaultOptions.mipmapFilter = "linear";
  TextureSource.defaultOptions.maxAnisotropy = 16;
  return true;
}

type Live2DTextureQualitySource = TextureSource & {
  style?: {
    maxAnisotropy?: number;
    update?: () => void;
  };
};

function configureTextureQuality(live2dModel: Live2DModel) {
  const textures = ((live2dModel as unknown as { textures?: unknown[] }).textures ?? []) as Array<{ source?: Live2DTextureQualitySource }>;
  let configured = 0;

  textures.forEach((texture) => {
    const source = texture.source;
    if (!source) return;
    source.autoGenerateMipmaps = true;
    source.magFilter = "linear";
    source.minFilter = "linear";
    source.mipmapFilter = "linear";
    source.maxAnisotropy = 16;
    source.style?.update?.();
    source.updateMipmaps();
    configured += 1;
  });

  return configured;
}

type Live2DCoreModelParameterId = {
  getString?: () => { s?: string } | string;
};

type Live2DGlContext = WebGLRenderingContext | WebGL2RenderingContext;

type Live2DInternalDrawPatch = {
  draw?: (gl: Live2DGlContext) => void;
  __transparentCanvasDrawPatched?: boolean;
};

type Live2DCoreModelParameterApi = SoullinkCoreModelApi;

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

function patchTransparentCanvasDraw(live2dModel: Live2DModel) {
  const internalModel = live2dModel.internalModel as unknown as Live2DInternalDrawPatch | null;
  if (!internalModel?.draw || internalModel.__transparentCanvasDrawPatched) return false;

  const originalDraw = internalModel.draw.bind(internalModel);
  internalModel.draw = (gl: Live2DGlContext) => {
    const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
    const scissorBox = gl.getParameter(gl.SCISSOR_BOX) as Int32Array;

    originalDraw(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    gl.scissor(scissorBox[0], scissorBox[1], scissorBox[2], scissorBox[3]);
    if (scissorEnabled) {
      gl.enable(gl.SCISSOR_TEST);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    gl.clearColor(0, 0, 0, 0);
  };
  internalModel.__transparentCanvasDrawPatched = true;
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

type PixiEventTargetPatch = {
  eventMode?: string;
  interactiveChildren?: boolean;
};

function disablePixiHitTesting(target: unknown) {
  const patched = target as PixiEventTargetPatch | null;
  if (!patched) return;
  patched.eventMode = "none";
  patched.interactiveChildren = false;
}

function resetExpressionIfAvailable(live2dModel: Live2DModel) {
  const expressionManager = live2dModel.internalModel?.motionManager?.expressionManager;
  if (!expressionManager) return;
  (expressionManager as { resetExpression?: () => void }).resetExpression?.();
}

function hasExpression(live2dModel: Live2DModel, expressionId: string) {
  const expressionManager = live2dModel.internalModel?.motionManager?.expressionManager;
  const definitions = (expressionManager as unknown as { definitions?: unknown[] })?.definitions;
  return Array.isArray(definitions) && definitions.some((definition) => {
    const item = definition as { Name?: unknown; File?: unknown };
    return item.Name === expressionId || item.File === expressionId;
  });
}

function ensureModelVisible(live2dModel: Live2DModel, scene: Live2DScene) {
  const canvas = scene.app.canvas as unknown as HTMLCanvasElement;

  canvas.style.display = "block";
  canvas.style.background = "transparent";
  canvas.style.backgroundColor = "transparent";
  canvas.style.pointerEvents = "none";
  scene.resizeToParent();
  scene.app.stage.visible = true;
  scene.app.stage.renderable = true;
  scene.app.stage.alpha = 1;
  scene.characterLayer.visible = true;
  scene.characterLayer.renderable = true;
  scene.characterLayer.alpha = 1;
  live2dModel.visible = true;
  live2dModel.renderable = true;
  live2dModel.alpha = 1;
}

function sampleCanvasPixels(scene: Live2DScene) {
  const canvas = scene.app.canvas as unknown as HTMLCanvasElement;
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return null;

  const samplePoints = [
    [2, 2],
    [Math.max(0, Math.floor(canvas.width / 2)), 2],
    [Math.max(0, canvas.width - 3), 2],
    [2, Math.max(0, Math.floor(canvas.height / 2))],
    [Math.max(0, canvas.width - 3), Math.max(0, Math.floor(canvas.height / 2))],
    [2, Math.max(0, canvas.height - 3)],
    [Math.max(0, Math.floor(canvas.width / 2)), Math.max(0, canvas.height - 3)],
    [Math.max(0, canvas.width - 3), Math.max(0, canvas.height - 3)],
  ];

  return samplePoints.map(([x, y]) => {
    const pixel = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { x, y, rgba: Array.from(pixel) };
  });
}

function getCanvasScaleSnapshot(scene: Live2DScene) {
  const canvas = scene.app.canvas as unknown as HTMLCanvasElement;
  return {
    devicePixelRatio: window.devicePixelRatio || 1,
    rendererResolution: scene.app.renderer.resolution,
    screenWidth: scene.app.screen.width,
    screenHeight: scene.app.screen.height,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    canvasClientWidth: canvas.clientWidth,
    canvasClientHeight: canvas.clientHeight,
    backingStoreScaleX: canvas.clientWidth ? canvas.width / canvas.clientWidth : null,
    backingStoreScaleY: canvas.clientHeight ? canvas.height / canvas.clientHeight : null,
  };
}

function getModelSourceSize(live2dModel: Live2DModel) {
  const coreModel = live2dModel.internalModel?.coreModel as { getCanvasWidth?: () => number; getCanvasHeight?: () => number } | undefined;
  return {
    canvasWidth: coreModel?.getCanvasWidth?.() ?? null,
    canvasHeight: coreModel?.getCanvasHeight?.() ?? null,
    loadedWidth: live2dModel.width,
    loadedHeight: live2dModel.height,
  };
}

function getTextureQualitySnapshot(live2dModel: Live2DModel) {
  const textures = ((live2dModel as unknown as { textures?: unknown[] }).textures ?? []) as Array<{
    width?: number;
    height?: number;
    source?: {
      pixelWidth?: number;
      pixelHeight?: number;
      resolution?: number;
      alphaMode?: string;
      scaleMode?: string;
      magFilter?: string;
      minFilter?: string;
      mipmapFilter?: string;
      autoGenerateMipmaps?: boolean;
      mipLevelCount?: number;
      antialias?: boolean;
      style?: {
        scaleMode?: string;
        magFilter?: string;
        minFilter?: string;
        mipmapFilter?: string;
        maxAnisotropy?: number;
      };
    };
  }>;

  return textures.map((texture, index) => ({
    index,
    width: texture.width ?? null,
    height: texture.height ?? null,
    sourcePixelWidth: texture.source?.pixelWidth ?? null,
    sourcePixelHeight: texture.source?.pixelHeight ?? null,
    sourceResolution: texture.source?.resolution ?? null,
    alphaMode: texture.source?.alphaMode ?? null,
    scaleMode: texture.source?.scaleMode ?? texture.source?.style?.scaleMode ?? null,
    magFilter: texture.source?.magFilter ?? texture.source?.style?.magFilter ?? null,
    minFilter: texture.source?.minFilter ?? texture.source?.style?.minFilter ?? null,
    mipmapFilter: texture.source?.mipmapFilter ?? texture.source?.style?.mipmapFilter ?? null,
    autoGenerateMipmaps: texture.source?.autoGenerateMipmaps ?? null,
    mipLevelCount: texture.source?.mipLevelCount ?? null,
    antialias: texture.source?.antialias ?? null,
    maxAnisotropy: texture.source?.style?.maxAnisotropy ?? null,
  }));
}

function getGlQualitySnapshot(scene: Live2DScene) {
  const canvas = scene.app.canvas as unknown as HTMLCanvasElement;
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return null;
  return {
    contextAttributes: gl.getContextAttributes?.() ?? null,
    viewport: Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array),
    unpackPremultiplyAlpha: gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL),
    blendEnabled: gl.isEnabled(gl.BLEND),
    blendSrcRgb: gl.getParameter(gl.BLEND_SRC_RGB),
    blendDstRgb: gl.getParameter(gl.BLEND_DST_RGB),
    blendSrcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA),
    blendDstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA),
  };
}

export interface Live2DModelController {
  /**
   * 当前已加载模型的句柄。仅用于存在性判断（truthiness），
   * official 渲染后端返回占位对象，legacy 后端返回 @naari3 的 Live2DModel。
   */
  model: unknown;
  load: (modelUrl: string, characterLayer?: Container) => Promise<void>;
  unload: () => void;
  setPosition: (x: number, y: number) => void;
  setScale: (scale: number) => void;
  playMotion: (group: string, index?: number) => void;
  setExpression: (expressionId: string) => Promise<void>;
  removeAllExpressions: () => void;
  setMouthValue: (value: number) => void;
  pulseMouth: (durationMs?: number) => void;
  triggerEmotion: (mood: SoullinkLocalMood, intensity?: number) => void;
  /** 把消息交给 Soullink 会话运行时（触发引擎/LLM 反应规划） */
  sendMessage: (message: string) => Promise<EmotionIntent | null>;
  focusAt: (clientX: number, clientY: number) => void;
  enableEyeFollow: (enabled: boolean) => void;
  setMouseFollowStrength: (strength: number) => void;
  destroy: () => void;
}

export interface Live2DModelControllerOptions {
  /** LLM 生成的回复回调（用于展示气泡） */
  onReply?: (reply: string) => void;
}

export function createLive2DModelController(
  live2dScene: Live2DScene,
  options: Live2DModelControllerOptions = {},
): Live2DModelController {
  let model: Live2DModel | null = null;
  let eyeFollowEnabled = false;
  let mouseFollowStrength = 1;
  let mouthValue = 0;
  let baseScale = 1;
  let mouthTimer: number | null = null;
  let idleTimer: number | null = null;
  let aquariusCopyrightTimer: number | null = null;
  let aquariusCopyrightHidden = false;
  let aquariusCopyrightHandler: (() => void) | null = null;
  let runtimeTick: (() => void) | null = null;
  let releaseSceneResize: (() => void) | null = null;
  let soullinkLocalEngine: SoullinkLocalEngineAdapter | null = null;
  let heartbeatPhase = 0;

  const fitModelToViewport = (live2dModel: Live2DModel) => {
    const screenWidth = Math.max(live2dScene.app.screen.width || 360, 1);
    const screenHeight = Math.max(live2dScene.app.screen.height || 520, 1);
    const availableWidth = Math.max(1, screenWidth - 32);
    const availableHeight = Math.max(1, screenHeight - 32);

    live2dModel.scale.set(1);
    const modelWidth = Math.max(live2dModel.width || screenWidth, 1);
    const modelHeight = Math.max(live2dModel.height || screenHeight, 1);

    baseScale = Math.min(availableWidth / modelWidth, availableHeight / modelHeight) * 0.98;
    live2dModel.scale.set(baseScale);
    live2dModel.x = screenWidth / 2;
    live2dModel.y = screenHeight / 2;

    return {
      screenWidth,
      screenHeight,
      modelWidth,
      modelHeight,
      baseScale,
      displayWidth: modelWidth * baseScale,
      displayHeight: modelHeight * baseScale,
      x: live2dModel.x,
      y: live2dModel.y,
    };
  };

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
      const core = getCoreModelParameterApi(model);
      if (core && soullinkLocalEngine) {
        soullinkLocalEngine.update(core, deltaMs);
      } else {
        applyHeartbeat(deltaMs);
      }

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

    async load(modelUrl: string, characterLayer?: Container) {
      reportModelDebug("A", "modelController.ts:load", "model load enter", { modelUrl, hadExistingModel: !!model });
      if (model) {
        this.unload();
      }

      reportModelDebug("A", "modelController.ts:load", "importing cubism5 model runtime", { modelUrl });
      const { Live2DModel: L2DModel } = await import("@naari3/pixi-live2d-display/cubism5");
      reportModelDebug("A", "modelController.ts:load", "cubism5 model runtime imported", { modelUrl });
      const normalizedModelJson = await loadNormalizedModel3Json(modelUrl);
      const textureLoadingConfigured = configureLive2DTextureLoading();
      const unloadedTextureCandidates = await unloadCachedModelTextures(modelUrl, normalizedModelJson);
      reportModelDebug("A", "modelController.ts:load", "cached model textures invalidated before load", {
        modelUrl,
        textureLoadingConfigured,
        unloadedTextureCandidates,
      });
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
      const configuredTextures = configureTextureQuality(currentModel);
      (currentModel as unknown as { setRenderer?: (renderer: unknown) => void }).setRenderer?.(live2dScene.app.renderer);
      const transparentCanvasPatched = patchTransparentCanvasDraw(currentModel);
      reportModelDebug("A", "modelController.ts:load", "transparent canvas draw guard applied", {
        modelUrl,
        transparentCanvasPatched,
      });
      currentModel.anchor.set(0.5, 0.5);
      // 交互由外层 React/DOM 拖动按钮负责；禁用 Pixi hitTest，避免 Pixi v8 递归 Live2D 内部对象树时报
      // `currentTarget.isInteractive is not a function`（Live2D 内部节点并非完整 Pixi v8 Container）。
      disablePixiHitTesting(live2dScene.stage);
      disablePixiHitTesting(live2dScene.backgroundLayer);
      disablePixiHitTesting(live2dScene.particleLayer);
      disablePixiHitTesting(live2dScene.characterLayer);
      disablePixiHitTesting(currentModel);

      const placement = fitModelToViewport(currentModel);
      const resolutionScale = live2dScene.app.renderer.resolution || 1;

      releaseSceneResize?.();
      releaseSceneResize = live2dScene.onResize(() => {
        if (model !== currentModel) return;
        const nextPlacement = fitModelToViewport(currentModel);
        reportModelDebug("D", "modelController.ts:onSceneResize", "model placement recomputed after viewport resize", nextPlacement);
      });

      reportModelDebug("D", "modelController.ts:load", "model placement computed", {
        modelUrl,
        ...placement,
        resolutionScale,
        physicalDisplayWidth: placement.displayWidth * resolutionScale,
        physicalDisplayHeight: placement.displayHeight * resolutionScale,
        sourceSize: getModelSourceSize(currentModel),
        effectiveScaleX: placement.baseScale,
        effectiveScaleY: placement.baseScale,
        x: currentModel.x,
        y: currentModel.y,
        visible: currentModel.visible,
        alpha: currentModel.alpha,
      });

      reportModelDebug("CROP", "modelController.ts:load", "model bounds after layout", {
        bounds: (() => {
          const bounds = currentModel.getBounds();
          return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
        })(),
        position: { x: currentModel.position.x, y: currentModel.position.y },
        scale: { x: currentModel.scale.x, y: currentModel.scale.y },
        pivot: { x: currentModel.pivot.x, y: currentModel.pivot.y },
        anchor: { x: currentModel.anchor?.x ?? null, y: currentModel.anchor?.y ?? null },
        rendererScreen: { width: live2dScene.app.screen.width, height: live2dScene.app.screen.height },
        rendererResolution: live2dScene.app.renderer.resolution,
      });

      reportModelDebug("Q", "modelController.ts:load", "render quality configuration applied", {
        modelUrl,
        configuredTextures,
        canvas: getCanvasScaleSnapshot(live2dScene),
        sourceSize: getModelSourceSize(currentModel),
        modelScale: { x: currentModel.scale.x, y: currentModel.scale.y },
        textureQuality: getTextureQualitySnapshot(currentModel),
        gl: getGlQualitySnapshot(live2dScene),
      });

      if (characterLayer) {
        characterLayer.addChild(currentModel as unknown as Container);
      }
      ensureModelVisible(currentModel, live2dScene);
      live2dScene.app.render();
      requestAnimationFrame(() => {
        reportModelDebug("A", "modelController.ts:load", "canvas pixel sample after first model render", {
          modelUrl,
          canvasPixels: sampleCanvasPixels(live2dScene),
          rendererBackgroundAlpha: live2dScene.app.renderer.background.alpha,
          stageChildren: live2dScene.stage.children.length,
          characterChildren: live2dScene.characterLayer.children.length,
        });
      });

      if (currentModel.internalModel) {
        const core = getCoreModelParameterApi(currentModel);
        if (core) {
          // runtime-core 会话运行时：异步加载模型专属 Profile + 自动接入 LLM 规划器
          const engine = await SoullinkLocalEngineAdapter.create(core, modelUrl, {
            onReply: options.onReply,
          });
          if (model === currentModel) {
            soullinkLocalEngine = engine;
          } else {
            engine.stop();
          }
        }

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

      if (releaseSceneResize) {
        releaseSceneResize();
        releaseSceneResize = null;
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
      model.destroy({ children: true, texture: true, baseTexture: true });
      model = null;
      if (soullinkLocalEngine) {
        soullinkLocalEngine.stop();
        soullinkLocalEngine = null;
      }
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
      if (model && hasExpression(model, expressionId)) {
        await model.expression(expressionId);
      }
    },

    removeAllExpressions() {
      if (model) {
        resetExpressionIfAvailable(model);
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

    triggerEmotion(mood: SoullinkLocalMood, intensity = 0.75) {
      soullinkLocalEngine?.triggerEmotion(mood, intensity);
    },

    sendMessage(message: string): Promise<EmotionIntent | null> {
      if (!soullinkLocalEngine) return Promise.resolve(null);
      return soullinkLocalEngine.sendMessage(message);
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
