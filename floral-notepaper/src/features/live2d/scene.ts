import * as PIXI from "pixi.js";

(window as unknown as { PIXI?: typeof PIXI }).PIXI = PIXI;

export interface Live2DScene {
  app: PIXI.Application;
  stage: PIXI.Container;
  backgroundLayer: PIXI.Container;
  particleLayer: PIXI.Container;
  characterLayer: PIXI.Container;
  getResolution: () => number;
  setQualityScale: (scale: number) => void;
  onResize: (listener: () => void) => () => void;
  resizeToParent: () => void;
  destroy: () => void;
}

const MAX_LIVE2D_RENDER_RESOLUTION = 4;

function getLive2DDevicePixelRatio() {
  return Math.max(window.devicePixelRatio || 1, 1);
}

function getLive2DRenderResolution(qualityScale: number) {
  return Math.min(
    MAX_LIVE2D_RENDER_RESOLUTION,
    getLive2DDevicePixelRatio() * Math.max(qualityScale, 1),
  );
}

function getCanvasCssSize(canvas: HTMLCanvasElement, parent: HTMLElement) {
  const rect = parent.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  return {
    width: Math.max(
      1,
      Math.round(rect.width || parent.clientWidth || canvasRect.width || canvas.clientWidth || 360),
    ),
    height: Math.max(
      1,
      Math.round(
        rect.height || parent.clientHeight || canvasRect.height || canvas.clientHeight || 520,
      ),
    ),
  };
}

function getCanvasLogicalSize(canvas: HTMLCanvasElement, parent: HTMLElement) {
  const cssSize = getCanvasCssSize(canvas, parent);
  return {
    cssWidth: cssSize.width,
    cssHeight: cssSize.height,
    logicalWidth: cssSize.width,
    logicalHeight: cssSize.height,
  };
}

export async function createLive2DScene(
  canvas: HTMLCanvasElement,
  qualityScale = 1,
): Promise<Live2DScene> {
  const parent = canvas.parentElement || canvas;
  let currentQualityScale = Math.max(qualityScale, 1);
  const resolution = getLive2DRenderResolution(currentQualityScale);

  const initialSize = getCanvasCssSize(canvas, parent);
  canvas.style.width = `${initialSize.width}px`;
  canvas.style.height = `${initialSize.height}px`;

  const app = new PIXI.Application();

  await app.init({
    canvas,
    width: initialSize.width,
    height: initialSize.height,
    resolution,
    autoDensity: true,
    background: 0x000000,
    backgroundAlpha: 0,
    clearBeforeRender: true,
    antialias: true,
    preference: "webgl",
    powerPreference: "high-performance",
    autoStart: true,
    eventMode: "none",
    eventFeatures: {
      move: false,
      globalMove: false,
      click: false,
      wheel: false,
    },
  });

  const resizeListeners = new Set<() => void>();

  const resizeToParent = () => {
    const nextResolution = getLive2DRenderResolution(currentQualityScale);
    const { cssWidth, cssHeight, logicalWidth, logicalHeight } = getCanvasLogicalSize(
      canvas,
      parent,
    );
    app.renderer.resize(logicalWidth, logicalHeight, nextResolution);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    resizeListeners.forEach((listener) => listener());
  };

  const setQualityScale = (scale: number) => {
    currentQualityScale = Math.max(scale, 1);
    resizeToParent();
  };

  resizeToParent();

  // 透明窗口首帧时序下 parent 可能瞬时为 0 尺寸，导致 Pixi 初始化为 0x0；
  // 布局就绪后主动 resize 一次，确保渲染尺寸与容器一致。
  if (app.screen.width === 0 || app.screen.height === 0) {
    resizeToParent();
  }

  canvas.style.background = "transparent";
  canvas.style.backgroundColor = "transparent";
  app.renderer.background.color = 0x000000;
  app.renderer.background.alpha = 0;
  app.renderer.clear({ clearColor: [0, 0, 0, 0], clear: true });

  const stage = app.stage;
  const backgroundLayer = new PIXI.Container();
  const particleLayer = new PIXI.Container();
  const characterLayer = new PIXI.Container();

  stage.addChild(backgroundLayer);
  stage.addChild(particleLayer);
  stage.addChild(characterLayer);

  const resizeObserver = new ResizeObserver(() => {
    resizeToParent();
  });
  resizeObserver.observe(parent);

  return {
    app,
    stage,
    backgroundLayer,
    particleLayer,
    characterLayer,
    getResolution: () => app.renderer.resolution,
    setQualityScale,
    onResize: (listener: () => void) => {
      resizeListeners.add(listener);
      return () => resizeListeners.delete(listener);
    },
    resizeToParent,
    destroy: () => {
      resizeObserver.disconnect();
      app.destroy({ removeView: false }, { children: true, texture: true });
    },
  };
}
