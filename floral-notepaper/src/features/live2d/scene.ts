import * as PIXI from "pixi.js";

(window as unknown as { PIXI?: typeof PIXI }).PIXI = PIXI;

// #region debug-point B:scene-report
const reportSceneDebug = (..._args: unknown[]) => {};
// #endregion

export interface Live2DScene {
  app: PIXI.Application;
  stage: PIXI.Container;
  backgroundLayer: PIXI.Container;
  particleLayer: PIXI.Container;
  characterLayer: PIXI.Container;
  destroy: () => void;
}

export async function createLive2DScene(canvas: HTMLCanvasElement): Promise<Live2DScene> {
  const parent = canvas.parentElement || canvas;
  reportSceneDebug("B", "scene.ts:createLive2DScene", "creating Pixi application with Pixi v8 API", {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    parentWidth: parent.clientWidth,
    parentHeight: parent.clientHeight,
  });

  const app = new PIXI.Application();

  await app.init({
    canvas,
    background: 0x000000,
    backgroundAlpha: 0,
    clearBeforeRender: true,
    antialias: true,
    resizeTo: parent,
    preference: "webgl",
    autoStart: true,
    eventMode: "none",
    eventFeatures: {
      move: false,
      globalMove: false,
      click: false,
      wheel: false,
    },
  });

  reportSceneDebug("B", "scene.ts:createLive2DScene", "Pixi application initialized", {
    rendererType: app.renderer.type,
    screenWidth: app.screen.width,
    screenHeight: app.screen.height,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    canvasClientWidth: canvas.clientWidth,
    canvasClientHeight: canvas.clientHeight,
    parentWidth: parent.clientWidth,
    parentHeight: parent.clientHeight,
  });

  // 透明窗口首帧时序下 parent 可能瞬时为 0 尺寸，导致 Pixi 初始化为 0x0；
  // 布局就绪后主动 resize 一次，确保渲染尺寸与容器一致。
  if (app.screen.width === 0 || app.screen.height === 0) {
    app.resize();
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
    app.resize();
  });
  resizeObserver.observe(parent);

  return {
    app,
    stage,
    backgroundLayer,
    particleLayer,
    characterLayer,
    destroy: () => {
      resizeObserver.disconnect();
      app.destroy(true, { children: true, texture: true });
    },
  };
}
