import * as PIXI from "pixi.js";

(window as unknown as { PIXI?: typeof PIXI }).PIXI = PIXI;

// #region debug-point B:scene-report
const reportSceneDebug = (hypothesisId: string, location: string, msg: string, data: Record<string, unknown> = {}) => {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "live2d-cubism5", runId: "post-fix", hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() }),
  }).catch(() => undefined);
};
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
  });

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
