// Type-only import only; erased at compile time, no runtime module side effects.
import type { Live2DModel, MotionPriority as Live2DMotionPriority } from "@naari3/pixi-live2d-display/cubism5";
import type { Container } from "pixi.js";
import { Assets, Cache, TextureSource, loadTextures } from "pixi.js";
import type { EmotionIntent } from "@soullink-emotion/engine";
import type { SoullinkCoreModelApi, SoullinkLocalMood } from "./soullinkLocalEngine";
import { SoullinkLocalEngineAdapter } from "./soullinkLocalEngine";
import type { Live2DScene } from "./scene";

/**
 * Live2D 运动优先级（对应 Cubism MotionPriority）：
 * NONE=0 不打断 / IDLE=1 待机 / NORMAL=2 普通 / FORCE=3 强制打断当前动作。
 */
const MotionPriority = {
  NONE: 0 as Live2DMotionPriority,
  IDLE: 1 as Live2DMotionPriority,
  NORMAL: 2 as Live2DMotionPriority,
  FORCE: 3 as Live2DMotionPriority,
} as const;
type MotionPriority = Live2DMotionPriority;

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
  viewport?: [number, number, number, number] | number[];
  __transparentCanvasDrawPatched?: boolean;
};

/**
 * 模型基准适配参照卡片（与 Live2DCompanionLayer 的 LIVE2D_WIDTH/LIVE2D_HEIGHT 保持一致）。
 * 缩放体系统一为：model.scale = baseScale × config.scale，
 * baseScale 在 load 时按参照卡片计算一次，不再跟随视口/分辨率变化，避免“两套比例换算”互相覆盖。
 */
const MODEL_REFERENCE_WIDTH = 260;
const MODEL_REFERENCE_HEIGHT = 380;
const MODEL_REFERENCE_FILL_RATIO = 0.96;

type Live2DCoreModelParameterApi = SoullinkCoreModelApi;

const AQUARIUS_MODEL_MARKER = "aquarius-love";
const AQUARIUS_COPYRIGHT_HIDE_DELAY_MS = 1000;
const AQUARIUS_COPYRIGHT_HIDE_VALUE = 0;
const AQUARIUS_COPYRIGHT_TEXTURE_INDEX = 3;

/** Miku 免费模型：水印由 Param137 控制，运行时强制隐藏（模型默认显示水印）。 */
const MIKU_MODEL_MARKER = "miku";
const MIKU_WATERMARK_PARAM_ID = "Param137";
const MIKU_WATERMARK_HIDE_VALUE = 0;

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

function isMikuModel(modelUrl: string) {
  return decodeURIComponent(modelUrl).includes(MIKU_MODEL_MARKER);
}

function hideMikuWatermark(core: Live2DCoreModelParameterApi | null) {
  if (!core) return false;
  return setParameterIfPresent(core, MIKU_WATERMARK_PARAM_ID, MIKU_WATERMARK_HIDE_VALUE);
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

function patchTransparentCanvasDraw(live2dModel: Live2DModel, scene: Live2DScene) {
  const internalModel = live2dModel.internalModel as unknown as Live2DInternalDrawPatch | null;
  if (!internalModel?.draw || internalModel.__transparentCanvasDrawPatched) return false;

  const originalDraw = internalModel.draw.bind(internalModel);
  internalModel.draw = (gl: Live2DGlContext) => {
    const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
    const scissorBox = gl.getParameter(gl.SCISSOR_BOX) as Int32Array;
    const previousLive2DViewport = internalModel.viewport ? [...internalModel.viewport] : null;
    const canvas = scene.app.canvas as HTMLCanvasElement;

    internalModel.viewport = [0, 0, canvas.width || Math.round(scene.app.screen.width * scene.app.renderer.resolution), canvas.height || Math.round(scene.app.screen.height * scene.app.renderer.resolution)];
    originalDraw(gl);

    if (previousLive2DViewport) internalModel.viewport = previousLive2DViewport;
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

    // 查询当前版权通知参数状态（getAquariusCopyrightNoticeState 与 applyAquariusCopyrightNoticeHidden 配套的只读查询入口）。
    void getAquariusCopyrightNoticeState(live2dModel);
    applyAquariusCopyrightNoticeHidden(live2dModel);
    onHidden();
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

export interface Live2DModelController {
  /** Current loaded model handle. Used for truthiness checks; v8 returns the @naari3 Live2DModel instance. */
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
  /** Send a message into the Soullink runtime and optionally receive an LLM reply. */
  sendMessage: (message: string) => Promise<EmotionIntent | null>;
  focusAt: (clientX: number, clientY: number) => void;
  enableEyeFollow: (enabled: boolean) => void;
  setMouseFollowStrength: (strength: number) => void;
  destroy: () => void;
}

export interface Live2DModelControllerOptions {
  /** Reply generated by the LLM, used for displaying the speech bubble. */
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
  let mikuWatermarkHandler: (() => void) | null = null;
  let runtimeTick: (() => void) | null = null;
  let releaseSceneResize: (() => void) | null = null;
  let soullinkLocalEngine: SoullinkLocalEngineAdapter | null = null;
  let heartbeatPhase = 0;

  /**
   * 统一换算链（源码级）：
   * 1) 模型内部画布尺寸 = internalModel.width/height（Cubism 画布 × 布局，miku 为 2976×4175）；
   * 2) 世界坐标映射（已由渲染链路验证）：world = modelVertex × scale + position，anchor=0.5 时
   *    centeringTransform 的平移与 pivot 抵消，内容以 position 为基准向右下展开；
   * 3) 因此模型显示尺寸 = internalModel 尺寸 × baseScale × config.scale，与卡片 260×380×scale 恒成比例。
   */
  const computeModelCanvasSize = (live2dModel: Live2DModel) => {
    live2dModel.scale.set(1);
    return {
      modelWidth: Math.max(live2dModel.width || 1, 1),
      modelHeight: Math.max(live2dModel.height || 1, 1),
    };
  };

  const computeBaseScale = (live2dModel: Live2DModel) => {
    const { modelWidth, modelHeight } = computeModelCanvasSize(live2dModel);
    baseScale = Math.min(
      (MODEL_REFERENCE_WIDTH * MODEL_REFERENCE_FILL_RATIO) / modelWidth,
      (MODEL_REFERENCE_HEIGHT * MODEL_REFERENCE_FILL_RATIO) / modelHeight,
    );
    return { modelWidth, modelHeight, baseScale };
  };

  /**
   * 内容居中（源码级）：Live2D 的 anchor 仅影响 Pixi pivot，而 Cubism drawingMatrix 中
   * centeringTransform 的画布中心平移与 pivot 完全抵消（cubism5.es.js onAnchorChange + updateTransform），
   * 因此模型内容恒以 position 为左上角向右下展开。要令内容几何中心落在画布中心，
   * 必须把 position 反推为：屏幕中心 − 内容尺寸/2。
   */
  const centerModel = (live2dModel: Live2DModel) => {
    const screenW = Math.max(live2dScene.app.screen.width || 360, 1);
    const screenH = Math.max(live2dScene.app.screen.height || 520, 1);
    const contentW = Math.max(live2dModel.width || 1, 1) * Math.max(live2dModel.scale.x, 0.01);
    const contentH = Math.max(live2dModel.height || 1, 1) * Math.max(live2dModel.scale.y, 0.01);
    live2dModel.x = screenW / 2 - contentW / 2;
    live2dModel.y = screenH / 2 - contentH / 2;
  };

  const applyModelScale = (live2dModel: Live2DModel, scale: number) => {
    live2dModel.scale.set(baseScale * Math.max(scale, 0.01));
    centerModel(live2dModel);
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
      if (model) {
        this.unload();
      }

      const { Live2DModel: L2DModel } = await import("@naari3/pixi-live2d-display/cubism5");
      const normalizedModelJson = await loadNormalizedModel3Json(modelUrl);
      configureLive2DTextureLoading();
      await unloadCachedModelTextures(modelUrl, normalizedModelJson);
      const loaded = await L2DModel.from(normalizedModelJson, { autoHitTest: false, autoFocus: false, autoUpdate: false, ticker: live2dScene.app.ticker });

      model = loaded as Live2DModel;
      const currentModel = model;
      configureTextureQuality(currentModel);
      (currentModel as unknown as { setRenderer?: (renderer: unknown) => void }).setRenderer?.(live2dScene.app.renderer);
      patchTransparentCanvasDraw(currentModel, live2dScene);
      currentModel.anchor.set(0.5, 0.5);
      // 交互由外层 React/DOM 拖动按钮负责；禁用 Pixi hitTest，避免 Pixi v8 递归 Live2D 内部对象树时抛
      // `currentTarget.isInteractive is not a function`（Live2D 内部节点并非完整 Pixi v8 Container）。
      disablePixiHitTesting(live2dScene.stage);
      disablePixiHitTesting(live2dScene.backgroundLayer);
      disablePixiHitTesting(live2dScene.particleLayer);
      disablePixiHitTesting(live2dScene.characterLayer);
      disablePixiHitTesting(currentModel);

      const placement = computeBaseScale(currentModel);
      // 先以 baseScale 建立初始布局，避免 load 完成前的首帧以原始画布尺寸（miku 2976×4175）巨大展开；
      // 随后 React 侧 setScale(config.scale) 再按滑块比例线性叠加。
      currentModel.scale.set(placement.baseScale, placement.baseScale);
      centerModel(currentModel);

      releaseSceneResize?.();
      releaseSceneResize = live2dScene.onResize(() => {
        if (model !== currentModel) return;
        // 缩放只由 setScale 按滑块线性驱动；视口变化仅保持居中，避免“适配视口”与滑块互相覆盖导致 Y 轴跳动。
        centerModel(currentModel);
      });

      if (characterLayer) {
        characterLayer.addChild(currentModel as unknown as Container);
      }
      ensureModelVisible(currentModel, live2dScene);
      live2dScene.app.render();

      if (currentModel.internalModel) {
        const core = getCoreModelParameterApi(currentModel);
        if (core) {
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
          patchAquariusCopyrightTextureDraw(currentModel, () => aquariusCopyrightHidden && model === currentModel);
          aquariusCopyrightHandler = () => {
            if (aquariusCopyrightHidden && model === currentModel) {
              applyAquariusCopyrightNoticeHidden(currentModel);
            }
          };
          currentModel.internalModel.on("beforeModelUpdate", aquariusCopyrightHandler);
        }

        if (isMikuModel(modelUrl)) {
          hideMikuWatermark(core);
          mikuWatermarkHandler = () => {
            if (model === currentModel) {
              hideMikuWatermark(getCoreModelParameterApi(currentModel));
            }
          };
          currentModel.internalModel.on("beforeModelUpdate", mikuWatermarkHandler);
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

      if (mikuWatermarkHandler && model.internalModel) {
        model.internalModel.off("beforeModelUpdate", mikuWatermarkHandler);
        mikuWatermarkHandler = null;
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
        applyModelScale(model, scale);
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


