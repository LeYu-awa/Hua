// src/Live2DRenderer.ts
import * as PIXI from "pixi.js";

// src/motionParameters.ts
function parseCDIParameterMeta(cdi) {
  const groups = /* @__PURE__ */ new Map();
  for (const group of cdi.ParameterGroups ?? []) {
    if (group.Id) groups.set(group.Id, group.Name ?? "");
  }
  const result = {};
  for (const parameter of cdi.Parameters ?? []) {
    if (!parameter.Id) continue;
    result[parameter.Id] = {
      name: parameter.Name || parameter.Id,
      groupId: parameter.GroupId || void 0,
      groupName: parameter.GroupId ? groups.get(parameter.GroupId) || void 0 : void 0
    };
  }
  return result;
}
function parseModel3DisplayInfo(model3) {
  return model3.FileReferences?.DisplayInfo?.trim() || null;
}
function resolveRelativeURL(modelUrl, relativePath, documentBaseUrl) {
  const pageUrl = documentBaseUrl || globalThis.location?.href;
  const absoluteModelUrl = pageUrl ? new URL(modelUrl, pageUrl) : new URL(modelUrl);
  return new URL(relativePath, absoluteModelUrl).toString();
}
function deriveCDIUrl(modelUrl) {
  const match = modelUrl.match(/^(.*)\.model3\.json(?:[?#].*)?$/u);
  return match ? `${match[1]}.cdi3.json` : null;
}
async function loadCDIParameterMeta(modelUrl, options = {}) {
  const cdiUrl = await resolveCDIUrl(modelUrl, options);
  if (!cdiUrl) return {};
  const fetchMetadata = resolveFetch(options);
  if (!fetchMetadata) {
    warn(options, "[Live2D] fetch is unavailable; cannot load cdi3 parameter metadata");
    return {};
  }
  try {
    const response = await fetchMetadata(cdiUrl);
    if (!response.ok) return {};
    return parseCDIParameterMeta(await response.json());
  } catch (error) {
    warn(options, "[Live2D] failed to load cdi3 parameter metadata", error);
    return {};
  }
}
async function resolveCDIUrl(modelUrl, options = {}) {
  const fetchMetadata = resolveFetch(options);
  if (fetchMetadata) {
    try {
      const response = await fetchMetadata(modelUrl);
      if (response.ok) {
        const displayInfo = parseModel3DisplayInfo(await response.json());
        if (displayInfo) {
          return resolveRelativeURL(modelUrl, displayInfo, options.documentBaseUrl);
        }
      }
    } catch (error) {
      warn(options, "[Live2D] failed to read model3 DisplayInfo", error);
    }
  }
  return deriveCDIUrl(modelUrl);
}
function buildMotionParameters(model, cdiMeta = {}) {
  const coreModel = model.internalModel?.coreModel;
  const result = {};
  if (!coreModel) return result;
  const count = coreModel.getParameterCount?.();
  if (typeof count === "number" && count > 0 && coreModel.getParameterId) {
    for (let index = 0; index < count; index += 1) {
      const id = normalizeParameterId(coreModel.getParameterId(index));
      if (!id) continue;
      const fallback = defaultParameterInfo(id);
      addMotionParameter(result, id, {
        min: coreModel.getParameterMinimumValue?.(index) ?? fallback.min,
        max: coreModel.getParameterMaximumValue?.(index) ?? fallback.max,
        default: coreModel.getParameterDefaultValue?.(index) ?? fallback.default
      }, cdiMeta[id]);
    }
  }
  const rawParameters = coreModel._model?.parameters;
  const ids = rawParameters?.ids ?? [];
  ids.forEach((rawId, index) => {
    const id = normalizeParameterId(rawId);
    if (!id || result[id]) return;
    const fallback = defaultParameterInfo(id);
    addMotionParameter(result, id, {
      min: rawParameters?.minimumValues?.[index] ?? fallback.min,
      max: rawParameters?.maximumValues?.[index] ?? fallback.max,
      default: rawParameters?.defaultValues?.[index] ?? fallback.default
    }, cdiMeta[id]);
  });
  return result;
}
function resolveFetch(options) {
  if (options.fetch) return options.fetch;
  if (typeof globalThis.fetch !== "function") return void 0;
  return (url) => globalThis.fetch(url);
}
function warn(options, message, cause) {
  if (options.onWarning) {
    options.onWarning(message, cause);
    return;
  }
  console.warn(message, cause ?? "");
}
function addMotionParameter(result, id, range, meta) {
  const min = Number.isFinite(range.min) ? range.min : defaultParameterInfo(id).min;
  const max = Number.isFinite(range.max) ? range.max : defaultParameterInfo(id).max;
  const normalizedMin = Math.min(min, max);
  const normalizedMax = Math.max(min, max);
  result[id] = {
    name: meta?.name || id,
    groupId: meta?.groupId,
    groupName: meta?.groupName,
    min: normalizedMin,
    max: normalizedMax,
    default: clampNumber(range.default, normalizedMin, normalizedMax)
  };
}
function normalizeParameterId(id) {
  if (typeof id === "string") return id;
  const value = id?.getString?.();
  if (typeof value === "string") return value;
  return typeof value?.s === "string" ? value.s : null;
}
function defaultParameterInfo(id) {
  const normalized = id.replace(/\s+/gu, "").replace(/[＿_\-　]/gu, "").toLowerCase();
  if (normalized.includes("opacity")) return { min: 0, max: 1, default: 1 };
  if (normalized.includes("angle")) return { min: -30, max: 30, default: 0 };
  if (normalized.includes("eyeball") || normalized.includes("mouthform") || normalized.includes("brow")) {
    return { min: -1, max: 1, default: 0 };
  }
  if (normalized.includes("eyeopen")) return { min: 0, max: 1, default: 1 };
  return { min: 0, max: 1, default: 0 };
}
function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

// src/Live2DRenderer.ts
var Live2DRenderer = class {
  app = null;
  container;
  deps;
  model = null;
  latestParams = {};
  lastNativeAnimToken = -1;
  suppressedParamIds = /* @__PURE__ */ new Set();
  viewScale = 1;
  viewOffset = { x: 0, y: 0 };
  beforeModelUpdate = () => this.applyParametersNow();
  resizeObserver = null;
  constructor(container, deps = {}) {
    this.container = container;
    this.deps = deps;
    window.PIXI = PIXI;
  }
  async load(modelUrl) {
    if (!this.deps.cubismLoader) {
      throw new Error(
        "[Live2DRenderer] No cubismLoader provided. Pass a CubismCoreLoader via the constructor deps (e.g. createScriptTagCubismLoader(coreUrl)) so the Cubism Core runtime can be loaded."
      );
    }
    const app = await this.ensureApplication();
    await this.deps.cubismLoader();
    const { Live2DModel } = await import("@naari3/pixi-live2d-display");
    this.removeModel();
    const cdiMeta = await loadCDIParameterMeta(modelUrl);
    const modelSettings = await loadSanitizedModelSettings(modelUrl);
    const model = await Live2DModel.from(modelSettings, {
      autoHitTest: false,
      autoFocus: false,
      autoUpdate: true
    });
    this.model = model;
    this.model.alpha = 1;
    this.model.visible = true;
    this.model.renderable = true;
    app.stage.alpha = 1;
    app.stage.visible = true;
    app.stage.renderable = true;
    this.disableInternalEyeBlink();
    this.model.internalModel?.on?.("beforeModelUpdate", this.beforeModelUpdate);
    this.model.anchor?.set(0.5, 0.52);
    app.stage.addChild(this.model);
    this.resizeRenderer(app);
    this.fitModel();
    app.render();
    return buildMotionParameters(this.model, cdiMeta);
  }
  setParameters(params) {
    this.latestParams = params;
  }
  get suppressedParameterIds() {
    return this.suppressedParamIds;
  }
  applyNativeAnimation(directive) {
    this.suppressedParamIds = new Set(directive?.suppressParamIds ?? []);
    if (directive === null) {
      this.lastNativeAnimToken = 0;
      return;
    }
    if (!this.model) return;
    if (directive.token === this.lastNativeAnimToken) return;
    if (directive.expression !== null) {
      this.applyExpression(directive.expression);
    }
    if (directive.motion !== null) {
      this.applyMotion(
        directive.motion.group,
        directive.motion.index ?? 0,
        priorityFor(directive.motion.priority ?? "normal")
      );
    }
    this.lastNativeAnimToken = directive.token;
  }
  setViewScale(scale) {
    this.viewScale = Math.min(2.2, Math.max(0.45, scale));
    this.fitModel();
  }
  setViewOffset(offset) {
    this.viewOffset = { ...offset };
    this.fitModel();
  }
  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.removeModel();
    this.app?.destroy(true, {
      children: true,
      texture: true,
      baseTexture: true
    });
    this.app = null;
  }
  async ensureApplication() {
    if (this.app) return this.app;
    const app = new PIXI.Application();
    await app.init({
      canvas: this.deps.canvas,
      resizeTo: this.container,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      antialias: true,
      backgroundAlpha: 0
    });
    const canvas = app.canvas;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.background = "transparent";
    canvas.style.backgroundColor = "transparent";
    canvas.style.pointerEvents = "none";
    if (!canvas.parentElement) this.container.appendChild(canvas);
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeRenderer(app);
      this.fitModel();
    });
    this.resizeObserver.observe(this.container);
    this.app = app;
    return app;
  }
  applyExpression(name) {
    if (!name) return;
    const expression = this.model?.expression;
    if (typeof expression !== "function") return;
    try {
      const result = expression.call(this.model, name);
      void Promise.resolve(result).catch((cause) => {
        console.warn("[Live2DRenderer] Failed to apply native expression", cause);
      });
    } catch (cause) {
      console.warn("[Live2DRenderer] Failed to apply native expression", cause);
    }
  }
  applyMotion(group, index, priority) {
    const motion = this.model?.motion;
    if (typeof motion !== "function") return;
    try {
      void Promise.resolve(motion.call(this.model, group, index, priority)).catch((cause) => {
        console.warn("[Live2DRenderer] Failed to apply native motion", cause);
      });
    } catch (cause) {
      console.warn("[Live2DRenderer] Failed to apply native motion", cause);
    }
  }
  removeModel() {
    if (!this.model) return;
    this.model.internalModel?.off?.("beforeModelUpdate", this.beforeModelUpdate);
    this.app?.stage.removeChild(this.model);
    this.model.destroy({
      children: true,
      texture: true,
      baseTexture: true
    });
    this.model = null;
    this.lastNativeAnimToken = -1;
    this.suppressedParamIds = /* @__PURE__ */ new Set();
  }
  disableInternalEyeBlink() {
    if (!this.model?.internalModel) return;
    this.model.internalModel.eyeBlink = void 0;
  }
  resizeRenderer(app = this.app) {
    if (!app) return;
    const canvas = app.canvas;
    const width = this.container.clientWidth || canvas.clientWidth || canvas.width || 360;
    const height = this.container.clientHeight || canvas.clientHeight || canvas.height || 520;
    app.renderer.resize(width, height);
  }
  fitModel() {
    if (!this.model) return;
    const app = this.app;
    const canvas = app?.canvas;
    const width = this.container.clientWidth || canvas?.clientWidth || canvas?.width || 360;
    const height = this.container.clientHeight || canvas?.clientHeight || canvas?.height || 520;
    const originalWidth = (this.model.internalModel?.originalWidth ?? this.model.width) || 1;
    const originalHeight = (this.model.internalModel?.originalHeight ?? this.model.height) || 1;
    const scale = Math.min(width / originalWidth, height / originalHeight) * 1.02 * this.viewScale;
    this.model.scale.set(scale);
    this.model.x = width * 0.5 + this.viewOffset.x;
    this.model.y = height * 0.56 + this.viewOffset.y;
    this.model.alpha = 1;
    this.model.visible = true;
    this.model.renderable = true;
    app?.render();
  }
  applyParametersNow() {
    const coreModel = this.model?.internalModel?.coreModel;
    if (!coreModel?.setParameterValueById) return;
    for (const [id, value] of Object.entries(this.latestParams)) {
      if (this.suppressedParamIds.has(id)) continue;
      if (isOpacityParameter(id)) continue;
      if (coreModel.getParameterIndex && coreModel.getParameterIndex(id) < 0) {
        this.deps.onMissingParameter?.(id);
        continue;
      }
      coreModel.setParameterValueById(id, value, 1);
    }
  }
};
function isOpacityParameter(id) {
  return id.replace(/[＿_\-\s　]/gu, "").toLowerCase().includes("opacity");
}
async function loadSanitizedModelSettings(modelUrl) {
  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error(`Live2D model settings not found: ${modelUrl} (${response.status})`);
  }
  const settings = await response.json();
  settings.url = modelUrl;
  settings.HitAreas = Array.isArray(settings.HitAreas) ? settings.HitAreas : [];
  if (settings.FileReferences) {
    const expressions = Array.isArray(settings.FileReferences.Expressions) ? settings.FileReferences.Expressions.filter((expression) => typeof expression.File === "string" && expression.File.trim().length > 0) : [];
    if (expressions.length > 0) {
      settings.FileReferences.Expressions = expressions;
    } else {
      delete settings.FileReferences.Expressions;
    }
    settings.FileReferences.Motions = settings.FileReferences.Motions && typeof settings.FileReferences.Motions === "object" ? settings.FileReferences.Motions : {};
  }
  return settings;
}
function priorityFor(priority) {
  if (priority === "idle") return 1;
  if (priority === "force") return 3;
  return 2;
}

// src/cubismCore.ts
function createScriptTagCubismLoader(coreUrl) {
  let cubismCoreReady = null;
  return () => {
    if (window.Live2DCubismCore) return Promise.resolve();
    cubismCoreReady ??= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = coreUrl;
      script.async = true;
      script.onload = () => {
        if (window.Live2DCubismCore) resolve();
        else reject(new Error("Cubism Core script loaded, but window.Live2DCubismCore is missing."));
      };
      script.onerror = () => reject(new Error("Failed to load Live2D Cubism Core."));
      document.head.appendChild(script);
    });
    return cubismCoreReady;
  };
}
export {
  Live2DRenderer,
  buildMotionParameters,
  createScriptTagCubismLoader,
  deriveCDIUrl,
  loadCDIParameterMeta,
  parseCDIParameterMeta,
  parseModel3DisplayInfo,
  resolveCDIUrl,
  resolveRelativeURL
};
//# sourceMappingURL=index.js.map