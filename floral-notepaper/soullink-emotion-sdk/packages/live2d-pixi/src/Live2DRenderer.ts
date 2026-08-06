import * as PIXI from "pixi.js";
import type { NativeAnimationDirective } from "@soullink-emotion/engine";
import type { Live2DModelInstance } from "./live2dModel";
import { buildMotionParameters, loadCDIParameterMeta } from "./motionParameters";
import type { Live2DMotionParameterInfo, Live2DParamState, Live2DRendererDeps } from "./types";

/**
 * Renders a Live2D Cubism 4 model into a host element using PIXI v8 and
 * `pixi-live2d-display`. The Cubism Core runtime is supplied by the integrator
 * through `deps.cubismLoader`, keeping this package free of any bundler-specific
 * asset import.
 */
export class Live2DRenderer {
  private app: PIXI.Application | null = null;
  private container: HTMLElement;
  private deps: Live2DRendererDeps;
  private model: Live2DModelInstance | null = null;
  private latestParams: Live2DParamState = {};
  private lastNativeAnimToken = -1;
  private suppressedParamIds: Set<string> = new Set();
  private viewScale = 1;
  private viewOffset = { x: 0, y: 0 };
  private beforeModelUpdate = () => this.applyParametersNow();
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, deps: Live2DRendererDeps = {}) {
    this.container = container;
    this.deps = deps;
    window.PIXI = PIXI;
  }

  async load(modelUrl: string): Promise<Record<string, Live2DMotionParameterInfo>> {
    if (!this.deps.cubismLoader) {
      throw new Error(
        "[Live2DRenderer] No cubismLoader provided. Pass a CubismCoreLoader via the constructor deps " +
          "(e.g. createScriptTagCubismLoader(coreUrl)) so the Cubism Core runtime can be loaded."
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

    this.model = model as Live2DModelInstance;
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
    this.fitModel();
    return buildMotionParameters(this.model, cdiMeta);
  }

  setParameters(params: Live2DParamState) {
    this.latestParams = params;
  }

  get suppressedParameterIds(): ReadonlySet<string> {
    return this.suppressedParamIds;
  }

  applyNativeAnimation(directive: NativeAnimationDirective | null): void {
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

  setViewScale(scale: number) {
    this.viewScale = Math.min(2.2, Math.max(0.45, scale));
    this.fitModel();
  }

  setViewOffset(offset: { x: number; y: number }) {
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

  private async ensureApplication(): Promise<PIXI.Application> {
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

    const canvas = app.canvas as HTMLCanvasElement;
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

  private applyExpression(name?: string): void {
    if (!name) return;

    const expression = (this.model as any)?.expression;
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

  private applyMotion(group: string, index: number, priority: number): void {
    const motion = (this.model as any)?.motion;
    if (typeof motion !== "function") return;

    try {
      void Promise.resolve(motion.call(this.model, group, index, priority)).catch((cause) => {
        console.warn("[Live2DRenderer] Failed to apply native motion", cause);
      });
    } catch (cause) {
      console.warn("[Live2DRenderer] Failed to apply native motion", cause);
    }
  }

  private removeModel() {
    if (!this.model) return;

    this.model.internalModel?.off?.("beforeModelUpdate", this.beforeModelUpdate);
    this.app?.stage.removeChild(this.model);
    this.model.destroy({
      children: true,
      texture: true,
      baseTexture: true
    });
    this.model = null;
    // Reset native animation state so a fresh load re-applies the current directive.
    this.lastNativeAnimToken = -1;
    this.suppressedParamIds = new Set();
  }

  private disableInternalEyeBlink() {
    if (!this.model?.internalModel) return;
    this.model.internalModel.eyeBlink = undefined;
  }

  private resizeRenderer(app = this.app) {
    if (!app) return;

    const canvas = app.canvas as HTMLCanvasElement;
    const width = this.container.clientWidth || canvas.clientWidth || canvas.width || 360;
    const height = this.container.clientHeight || canvas.clientHeight || canvas.height || 520;
    app.renderer.resize(width, height);
  }

  private fitModel() {
    if (!this.model) return;

    const app = this.app;
    const canvas = app?.canvas as HTMLCanvasElement | undefined;
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

  private applyParametersNow() {
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
}

function isOpacityParameter(id: string): boolean {
  return id.replace(/[＿_\-\s　]/gu, "").toLowerCase().includes("opacity");
}

type ModelSettingsLike = {
  url?: string;
  HitAreas?: unknown[];
  FileReferences?: {
    Expressions?: Array<{ Name?: unknown; File?: unknown }>;
    Motions?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

async function loadSanitizedModelSettings(modelUrl: string): Promise<ModelSettingsLike> {
  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error(`Live2D model settings not found: ${modelUrl} (${response.status})`);
  }

  const settings = (await response.json()) as ModelSettingsLike;
  settings.url = modelUrl;
  settings.HitAreas = Array.isArray(settings.HitAreas) ? settings.HitAreas : [];

  if (settings.FileReferences) {
    const expressions = Array.isArray(settings.FileReferences.Expressions)
      ? settings.FileReferences.Expressions.filter((expression) => typeof expression.File === "string" && expression.File.trim().length > 0)
      : [];

    if (expressions.length > 0) {
      settings.FileReferences.Expressions = expressions;
    } else {
      delete settings.FileReferences.Expressions;
    }

    settings.FileReferences.Motions = settings.FileReferences.Motions && typeof settings.FileReferences.Motions === "object" ? settings.FileReferences.Motions : {};
  }

  return settings;
}

function priorityFor(priority: NonNullable<NativeAnimationDirective["motion"]>["priority"]): number {
  // pixi-live2d-display declares MotionPriority as NONE=0, IDLE=1, NORMAL=2, FORCE=3.
  if (priority === "idle") return 1;
  if (priority === "force") return 3;
  return 2;
}
