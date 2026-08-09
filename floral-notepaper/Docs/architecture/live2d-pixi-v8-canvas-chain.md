# Live2D Pixi v8 画布全链路存档

> 存档时间：2026-08-10\
> 基线提交：`c662398`\
> 目标：在排查 Live2D 画布 bug 前，固定记录当前“自研 Pixi v8 画布”的运行链路、构成、材质加载、DPR/像素比、CSS 结合方式、调试入口与不可随意改变的约束。本文只描述当前事实，不提出修复方案。

## 0. 先区分两套“画布”

项目里当前容易混淆的画布至少有两类：

1. **写作/流程画布**
   - 入口示例：`src/components/CanvasPage.tsx`、`src/components/workflow/LiteGraphWorkflow.tsx`。
   - CSS 示例：`src/components/canvas/CanvasMode.css`、`src/components/workflow/LiteGraphWorkflow.css`。
   - 作用：编辑器、节点/工作流、文档画布，不负责 Live2D 模型。
2. **Live2D 陪伴画布（本文重点）**
   - React 入口：`src/features/live2d/Live2DCompanionLayer.tsx`。
   - Pixi v8 场景：`src/features/live2d/scene.ts`。
   - 模型控制器：`src/features/live2d/modelController.ts`。
   - Cubism 初始化：`src/features/live2d/cubismSetup.ts`。
   - 当前模型选择：`src/features/companion/companionConfig.ts`。
   - 当前实际渲染后端：统一走项目自研 Pixi v8 后端，类型名仍叫 `legacy`，见 `src/features/live2d/moc3Version.ts`。

**本文里的“v8 画布”只指第二类 Live2D 陪伴画布。**

## 1. 顶层挂载链路

### 1.1 主窗口 embedded 模式

主窗口在 `src/app/AppShell.tsx` 里挂载：

```tsx
<Live2DCompanionLayer surface="embedded" providers={providers} />
```

位置：`src/app/AppShell.tsx`。该层被放在 `WindowFrame` 内、主内容之后，使用 `position: fixed` 覆盖在主界面之上。

### 1.2 floating 模式边界

`Live2DCompanionLayer` 支持 `surface="embedded" | "floating"`：

- `embedded`：DOM 层自身 `position: fixed`，用 `config.position.x/y` 控制屏幕位置。
- `floating`：DOM 层自身 `position: relative`，通常由单独 Tauri 窗口/宿主控制窗口位置。

注意：`BongoCompanionLayer.tsx` 是 sprite/Bongo Cat 系统。它在 `config.renderer === "live2d"` 时直接返回 `null`，因此 Live2D 和 Bongo sprite 不会同时显示。

## 2. 配置与模型选择

配置入口在 `src/features/companion/companionConfig.ts`：

- 默认配置：`DEFAULT_COMPANION_CONFIG`。
- 存储 key：`hanasu_bongocat_companion_config`。
- 变更事件：`companion-config-changed`。
- 内置 Live2D 模型列表：`BUILT_IN_LIVE2D_MODEL_OPTIONS`。

当前内置模型包括：

```ts
Haru      -> /live2d/haru/Haru.model3.json
Hiyori    -> /live2d/hiyori/Hiyori.model3.json
水瓶座之恋 -> /live2d/aquarius-love/model-4096/aquarius.model3.json
Miku      -> /live2d/miku/miku.model3.json
```

`Live2DCompanionLayer` 通过 `subscribeCompanionConfig()` 监听配置变化，并保存到：

- React state：`config`
- 同步引用：`configRef.current`

加载条件集中在 `Live2DCompanionLayer.tsx`：

```ts
config.enabled
config.visible
config.renderer === "live2d"
isSurfaceActive
config.modelPath
```

当 `modelPath` 变化、renderer 变化、enabled/visible 变化时，会触发卸载/加载模型。

## 3. 后端选择：当前只走自研 Pixi v8

`src/features/live2d/moc3Version.ts` 保留了 MOC3 版本检测函数 `detectMoc3Version()`，但当前选择函数固定返回：

```ts
export type Live2DRenderBackend = "legacy";
export async function pickLive2DRenderBackend(_modelUrl: string): Promise<Live2DRenderBackend> {
  return "legacy";
}
```

这里的 `legacy` 命名容易误导。当前事实是：

- `legacy` = 项目自研 Pixi v8 + `@naari3/pixi-live2d-display/cubism5` 后端。
- 旧的 `officialController.ts` / `@soullink-emotion/live2d-pixi` 官方 SDK 栈存在，但当前 `pickLive2DRenderBackend()` 不会选它。
- 注释里说明：之前按 MOC3 版本分流会让 Hiyori 进入错误路径，因此现在统一走 v8。

## 4. 初始化时序

Live2D 的初始化由 `Live2DCompanionLayer.tsx` 的主 `useEffect` 驱动。

### 4.1 初始化流程

简化时序：

```text
Live2DCompanionLayer mounted
  -> subscribeCompanionConfig
  -> 检查 enabled/visible/renderer/surface
  -> 等待 1 帧 requestAnimationFrame，120ms 超时兜底
  -> canvasRef 必须存在
  -> waitForCanvasLayout(canvas)
  -> pickLive2DRenderBackend(modelPath)  // 当前固定 legacy/v8
  -> buildController(backend)
       -> ensureCubismCore()
       -> WebGL 探测
       -> createLive2DScene(canvas, config.scale)
       -> createLive2DModelController(scene)
  -> loadCurrentModel()
       -> validateLive2DModelAssets(modelPath)
       -> controller.load(modelPath, characterLayer)
       -> enableEyeFollow(true)
       -> setMouseFollowStrength(...)
       -> setScale(config.scale)
```

### 4.2 布局等待

`waitForCanvasLayout(canvas)` 解决 Tauri 透明窗口首帧 0x0 的问题：

- 判断 canvas 是否已连接 DOM。
- 判断 canvas rect、parent clientWidth/clientHeight 是否 > 0。
- 使用 `ResizeObserver` 监听 parent、canvas、`document.documentElement`。
- 默认超时 5000ms。
- 如果不 ready，会显示 `Live2D canvas layout not ready`，并 3 秒后重试。

这一步是排查裁切、黑屏、0x0 canvas 时的第一道关口。

## 5. DOM / CSS 构成

Live2D DOM 结构由 `Live2DCompanionLayer.tsx` 返回：

```text
<aside ref=layerRef>
  <div class="live2d-companion-card">
    <button>拖动/聊天按钮</button>
    <canvas ref=canvasRef class="live2d-canvas" />
    <div>loadError</div>
    <div class="live2d-bubble">气泡</div>
  </div>
</aside>
<form>聊天输入框</form>
```

### 5.1 aside 外层

外层 style 当前直接内联控制：

```ts
position: surface === "embedded" ? "fixed" : "relative"
left/top: embedded 时来自 config.position
width/height: getScaledLive2DSize(config.scale)
zIndex: 999
opacity: clamp(config.opacity, 0.2, 1)
pointerEvents: draggingEmbedded || showDragHandle || chatOpen ? "auto" : "none"
overflow: "visible"
background: "transparent"
backgroundColor: "transparent"
isolation: "isolate"
```

这里有两个关键点：

1. **外层尺寸会随 config.scale 改变**：`width = 260 * scale`，`height = 380 * scale`。
2. **Pixi 内部也会随 config.scale 调整 qualityScale 和 model scale**，因此排查缩放 bug 时要同时看 CSS 外层尺寸和 Pixi 内部尺寸。

### 5.2 live2d-companion-card

卡片 div 只作为 canvas 宿主：

```ts
width/height: 100%
position: relative
background: transparent
border: none
boxShadow: none
outline: none
backdropFilter: none
overflow: visible
pointerEvents: none
```

`scene.ts` 创建 Pixi 应用时，会取 `canvas.parentElement` 作为 parent。当前 parent 就是 `.live2d-companion-card`。

### 5.3 live2d-canvas

canvas style：

```ts
width: "100%"
height: "100%"
display: "block"
background: "transparent"
backgroundColor: "transparent"
pointerEvents: "none"
```

`scene.ts` 初始化后又会把 canvas 的 CSS width/height 写成 parent 的像素尺寸：

```ts
canvas.style.width = `${initialSize.width}px`;
canvas.style.height = `${initialSize.height}px`;
```

所以 canvas 的 CSS 尺寸最终以 `scene.ts` 的 `getCanvasCssSize()` / `resizeToParent()` 为准。

## 6. Pixi v8 场景构成

`src/features/live2d/scene.ts` 是 v8 画布核心。

### 6.1 全局 PIXI 注入

```ts
import * as PIXI from "pixi.js";
(window as unknown as { PIXI?: typeof PIXI }).PIXI = PIXI;
```

这给依赖全局 PIXI 的 Live2D runtime 提供兼容。

### 6.2 Application 初始化

`createLive2DScene(canvas, qualityScale)`：

```ts
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
```

关键不变量：

- WebGL 优先：`preference: "webgl"`。
- 透明背景：`backgroundAlpha: 0`，后续也强制 `renderer.background.alpha = 0`。
- Pixi 事件系统关闭：避免 Pixi v8 对 Live2D 内部对象树做 hitTest。
- `autoDensity: true`：canvas backing store 会结合 `resolution` 放大。

### 6.3 Stage 层级

`scene.ts` 创建三个 Pixi Container：

```text
app.stage
  ├─ backgroundLayer
  ├─ particleLayer
  └─ characterLayer
       └─ Live2DModel
```

当前 Live2D 模型由 `modelController.ts` 加入 `characterLayer`：

```ts
characterLayer.addChild(currentModel as unknown as Container);
```

### 6.4 透明清屏

初始化后强制透明：

```ts
canvas.style.background = "transparent";
canvas.style.backgroundColor = "transparent";
app.renderer.background.color = 0x000000;
app.renderer.background.alpha = 0;
app.renderer.clear({ clearColor: [0, 0, 0, 0], clear: true });
```

`modelController.ts` 还 patch 了 Live2D 内部 draw：

```ts
patchTransparentCanvasDraw(currentModel)
```

该 patch 在 Live2D 内部 draw 后恢复 WebGL framebuffer、viewport、scissor，并设置 `gl.clearColor(0,0,0,0)`，避免透明 canvas 状态被 Live2D 内部渲染污染。

## 7. DPR / 像素比 / 分辨率链路

### 7.1 基础函数

`scene.ts`：

```ts
const MAX_LIVE2D_RENDER_RESOLUTION = 4;

function getLive2DDevicePixelRatio() {
  return Math.max(window.devicePixelRatio || 1, 1);
}

function getLive2DRenderResolution(qualityScale: number) {
  return Math.min(MAX_LIVE2D_RENDER_RESOLUTION, getLive2DDevicePixelRatio() * Math.max(qualityScale, 1));
}
```

也就是说：

```text
renderer.resolution = min(4, window.devicePixelRatio * max(config.scale, 1))
```

注意：`config.scale < 1` 时，qualityScale 被拉回 1；`config.scale > 1` 时会增加渲染 resolution，最高 4。

### 7.2 逻辑尺寸 vs CSS 尺寸 vs 像素尺寸

`getCanvasCssSize()` 从 parent/card 的实际布局取 CSS 尺寸：

```ts
width = round(parent rect/clientWidth/canvas rect/canvas clientWidth/360 fallback)
height = round(parent rect/clientHeight/canvas rect/canvas clientHeight/520 fallback)
```

`getCanvasLogicalSize()` 当前把 logicalWidth/logicalHeight 设为 CSS 尺寸一致：

```ts
logicalWidth = cssWidth
logicalHeight = cssHeight
```

Pixi resize：

```ts
app.renderer.resize(logicalWidth, logicalHeight, nextResolution);
canvas.style.width = `${cssWidth}px`;
canvas.style.height = `${cssHeight}px`;
```

因此常见关系应为：

```text
app.screen.width  ≈ CSS width
app.screen.height ≈ CSS height
canvas.width      ≈ CSS width  * renderer.resolution
canvas.height     ≈ CSS height * renderer.resolution
```

文档里的 `backingStoreScaleX/Y` 就是：

```ts
canvas.width / canvas.clientWidth
canvas.height / canvas.clientHeight
```

正常情况下应接近 `app.renderer.resolution`。

### 7.3 缩放有两层

用户 `config.scale` 同时影响两件事：

1. **外层 DOM 尺寸**：

```ts
width = 260 * scale
height = 380 * scale
```

1. **Pixi/模型内部缩放**：

```ts
scene.setQualityScale(scale)
controller.setScale(scale)
```

`controller.setScale(scale)` 最终：

```ts
model.scale.set(baseScale * scale)
```

而 `baseScale` 来自 `fitModelToViewport()`：

```ts
availableWidth = app.screen.width - 32
availableHeight = app.screen.height - 32
baseScale = min(availableWidth / modelWidth, availableHeight / modelHeight) * 0.98
model.x = screenWidth / 2
model.y = screenHeight / 2
anchor = 0.5, 0.5
```

排查画面变大/裁切/模糊时，必须同时检查：

- aside/card CSS width/height
- canvas CSS width/height
- canvas backing store width/height
- app.screen width/height
- renderer.resolution
- model baseScale
- model final scale = baseScale \* config.scale

## 8. 材质/纹理/资源加载链路

### 8.1 资源预校验

加载模型前，`Live2DCompanionLayer.tsx` 先跑：

```ts
validateLive2DModelAssets(modelPath)
```

流程：

1. fetch `modelPath`。
2. 解析 `.model3.json`。
3. 必须有 `FileReferences.Moc` 和至少一个 texture。
4. 组合资源：`Moc + Textures + Physics + DisplayInfo`。
5. 用 `resolveLive2DAssetPath()` 把相对路径转成站点 pathname。
6. 并发 fetch，每个都必须 `response.ok`。

如果某张纹理缺失，会在这里或 Pixi loader 阶段报错，例如：

```text
Live2D resource not found: /live2d/miku/miku.4096/texture_05.png (404)
[Loader.load] Failed to load ... texture_05.png
```

### 8.2 model3.json 归一化

`modelController.ts` 的 `loadNormalizedModel3Json(modelUrl)`：

- fetch model3.json。
- 写入 `json.url = modelUrl`。
- `HitAreas` 不存在时置为空数组。
- `Expressions` 只保留带合法 `File` 的项；没有则删除。
- `Motions` 不存在则置为 `{}`。

这一步是为了让 `@naari3/pixi-live2d-display/cubism5` 以对象方式加载，而不是自己再 fetch 一次 model settings。

### 8.3 Pixi cache 清理

加载新模型前会执行：

```ts
unloadCachedModelTextures(modelUrl, normalizedModelJson)
```

对 model3.json 里的 texture 路径生成候选 URL：

- `new URL(texture, modelUrl).href`
- `new URL(resolved, window.location.href).href`

如果 `PIXI.Cache.has(url)`：

- 优先 `Assets.unload(url)`
- 失败则 `Cache.remove(url)`

这是为了避免同路径纹理变更后 Pixi 缓存仍使用旧图，例如 Miku 的 `texture_05.png` 从水印图换成透明占位图。

### 8.4 纹理加载质量配置

加载前调用：

```ts
configureLive2DTextureLoading()
```

当前配置：

```ts
loadTextures.config.preferWorkers = false;
loadTextures.config.preferCreateImageBitmap = false;
TextureSource.defaultOptions.autoGenerateMipmaps = true;
TextureSource.defaultOptions.magFilter = "linear";
TextureSource.defaultOptions.minFilter = "linear";
TextureSource.defaultOptions.mipmapFilter = "linear";
TextureSource.defaultOptions.maxAnisotropy = 16;
```

加载后再次逐 texture 调用：

```ts
configureTextureQuality(live2dModel)
```

对每张 `texture.source` 设置：

- `autoGenerateMipmaps = true`
- `magFilter = "linear"`
- `minFilter = "linear"`
- `mipmapFilter = "linear"`
- `maxAnisotropy = 16`
- `source.style?.update?.()`
- `source.updateMipmaps()`

### 8.5 当前 Miku 材质情况

Miku 模型路径：`public/live2d/miku/miku.model3.json`。

`FileReferences.Textures` 当前声明 6 张：

```text
miku.4096/texture_00.png
miku.4096/texture_01.png
miku.4096/texture_02.png
miku.4096/texture_03.png
miku.4096/texture_04.png
miku.4096/texture_05.png
```

`texture_05.png` 是水印材质，目前在项目中被替换为 4096×4096 全透明 PNG 占位，避免 404，同时让该 drawable 不显示内容。

另外 `modelController.ts` 对 Miku 加了参数双保险：

```ts
Param137 = 0
```

并在 `beforeModelUpdate` 每帧保持隐藏。

## 9. 模型加载与运行时循环

### 9.1 动态导入 Cubism5 runtime

`modelController.ts` 加载时：

```ts
const { Live2DModel: L2DModel } = await import("@naari3/pixi-live2d-display/cubism5");
const loaded = await L2DModel.from(normalizedModelJson, {
  autoHitTest: false,
  autoFocus: false,
  autoUpdate: false,
  ticker: live2dScene.app.ticker,
});
```

当前不使用 autoUpdate，而是在项目自己的 ticker 中手动调用：

```ts
model.update(deltaMs)
```

### 9.2 setRenderer 与交互关闭

加载后：

```ts
currentModel.setRenderer?.(live2dScene.app.renderer)
currentModel.anchor.set(0.5, 0.5)
disablePixiHitTesting(stage/backgroundLayer/particleLayer/characterLayer/currentModel)
```

禁用 hitTesting 的原因：Pixi v8 递归 Live2D 内部对象树时，部分内部节点不是完整 Pixi v8 Container，可能触发：

```text
currentTarget.isInteractive is not a function
```

因此 Live2D 本体不处理 Pixi pointer events，拖拽/点击由外层 DOM button 完成。

### 9.3 每帧循环

`startRuntimeLoop()` 将 `runtimeTick` 添加到 `app.ticker`：

```ts
deltaMs = min(app.ticker.deltaMS || 16.67, 66.67)
model.update(deltaMs)
if (core && soullinkLocalEngine) {
  soullinkLocalEngine.update(core, deltaMs)
} else {
  applyHeartbeat(deltaMs)
}
if (mouthValue > 0) mouthValue -= deltaMs / 420
```

### 9.4 fallback heartbeat

如果没有 Soullink engine，则手动写参数：

```ts
ParamBreath
ParamBodyAngleX
ParamAngleZ
```

### 9.5 口型

TTS 通过 `subscribeMouthValue()` 推送 RMS 音量包络，`Live2DCompanionLayer` 调：

```ts
controller.setMouthValue(value)
```

`modelController.ts` 在 `beforeModelUpdate` 写：

```ts
ParamMouthOpenY = mouthValue
```

## 10. CSS 事件/拖动/聊天与画布的关系

### 10.1 pointer-events 设计

- canvas：`pointerEvents: "none"`。
- card：`pointerEvents: "none"`。
- aside：默认 `pointerEvents: "none"`，只有拖动按钮可见、正在拖动或聊天框打开时为 `auto`。
- 拖动按钮：只有 `showDragHandle/chatOpen/draggingEmbedded` 时才接收事件。

原因：Live2D 层覆盖主界面，如果一直 `pointer-events: auto` 会挡住编辑器/画布/按钮。

### 10.2 拖动定位

拖动仅移动 `config.position`：

- 长按按钮 50ms 后进入 dragging。
- window pointermove 更新位置。
- pointerup 保存到 localStorage。
- 位置 clamp 到 viewport，safe margin 为 8。

### 10.3 缩放快捷键

`Ctrl/Cmd + +` 和 `Ctrl/Cmd + -`：

- 更新 `config.scale`。
- 通过 `getCenteredScalePosition()` 保持中心不跳。
- 调 `sceneRef.current?.setQualityScale(next.scale)`。
- 后续 `scaleEffect` 调 `controller.setScale(config.scale)`。

## 11. Cubism Core 加载链路

`src/features/live2d/cubismSetup.ts`：

1. 检查 `window.Live2DCubismCore`。
2. 必须是 Cubism Core major version 5。
3. 如未加载，则插入脚本：

```text
/vendor/live2dcubismcore-v5.min.js
```

1. patch `csmSetLogFunction`。
2. 动态导入：

```ts
@naari3/pixi-live2d-display/cubism5
```

1. 调用 `cubism5Ready()`。

不变量：当前 v8 后端依赖 Cubism 5 Core。MOC3 v5 模型（如 Miku）需要这个链路成功。

## 12. Vite / 依赖解析边界

`vite.config.ts` 里同时服务两套 Live2D 依赖树：

### 12.1 Pixi v8 自研栈

根依赖：

- `pixi.js` v8
- `@naari3/pixi-live2d-display/cubism5`
- `/vendor/live2dcubismcore-v5.min.js`

为兼容 Pixi v8 物理加载，配置了：

- `optimizeDeps.exclude: ["pixi.js", "@pixi/utils"]`
- `@xmldom/xmldom` alias 到 `shims/xmldom-shim.mjs`
- `gifuct-js` alias 到 `shims/gifuct-js-shim.mjs`
- `url` alias 到 `shims/url-shim.mjs`
- include 一批 CJS/深路径依赖：`parse-svg-path`、`tiny-lru`、`@xmldom/xmldom/lib/index.js` 等

### 12.2 官方 SDK / Pixi v7 栈

`@soullink-emotion/live2d-pixi` 被 alias 到 `soullink-emotion-sdk/packages/live2d-pixi/dist/index.js`，意图是让官方 SDK 使用自己物理路径下的 Pixi v7 依赖。

当前 v8 画布不走 `officialController.ts`，但这些配置仍存在，排查依赖冲突时不能忽略。

## 13. 调试日志和可观测点

当前有三类 debug 上报，统一 POST 到：

```text
http://127.0.0.1:7778/event
```

### 13.1 Live2DCompanionLayer.tsx

函数：`reportLive2DDebug()`。

重要事件：

- mount/config changed
- init effect evaluated/skipped
- canvas layout not ready
- canvas resolved before init
- picking/resolved backend
- validating model asset references
- model assets validated
- render backend switched
- model load completed/failed
- scale shortcut applied
- scaleEffect layer crop snapshot

### 13.2 scene.ts

函数：`reportSceneDebug()`。

重要事件：

- creating Pixi application
- Pixi application initialized
- manual DPR renderer resize applied
- resize snapshot
- canvas transparency snapshot after renderer clear
- setQualityScale DPR snapshot

### 13.3 modelController.ts

函数：`reportModelDebug()`。

重要事件：

- importing cubism5 runtime
- cached model textures invalidated
- model3 json normalized
- Live2DModel.from resolved
- transparent canvas draw guard applied
- model placement computed
- model bounds after layout
- render quality configuration applied
- canvas pixel sample after first render
- Aquarius/Miku 特殊隐藏逻辑

### 13.4 最重要的排查快照字段

排查裁切/模糊/黑底/尺寸错误时，优先看：

```text
layer/card/canvas rect
canvas clientWidth/clientHeight
canvas width/height
renderer.resolution
app.screen width/height
backingStoreScaleX/Y
gl.viewport
model bounds
model position/scale/anchor/pivot
sourceSize loadedWidth/loadedHeight/core canvasWidth/canvasHeight
textureQuality sourcePixelWidth/sourcePixelHeight/mipmap/filter/anisotropy
```

## 14. 当前已知特殊逻辑

### 14.1 Aquarius 版权隐藏

`modelController.ts` 中对 `aquarius-love`：

- 延迟 1000ms 设置 `ParamTrans = 0`、`ParamSite = 0`。
- patch renderer 的 `drawMeshWebGL`，当 drawable texture index 为 3 时跳过绘制。

### 14.2 Miku 水印隐藏

对 modelUrl 包含 `miku`：

- `texture_05.png` 是透明占位图。
- `水印.exp3.json` 中 `Param137` 已改为 `0.0`。
- `modelController.ts` 加载时和每帧 `beforeModelUpdate` 都强制 `Param137 = 0`。

### 14.3 表情/动作缺口

Miku 的动作/表情主要在 `miku.vtube.json` 中，当前项目不解析 VTube Studio hotkey 配置。

`miku.model3.json` 当前没有 `FileReferences.Expressions` 或 `FileReferences.Motions`，因此 app 内通用 `setExpression()` / `motion()` 对 Miku 默认没有完整动作表情可用。

## 15. 生命周期与销毁

`Live2DCompanionLayer` effect cleanup：

```ts
cancelled = true
cancelAnimationFrame(frameId)
clear retryTimer
controller.destroy()
scene.destroy()
sceneRef/controllerRef/backendRef/loadedModelPathRef 清空
loadingModelRef = false
```

`modelController.unload()`：

- 清 idle timer。
- 清 Aquarius timer。
- 停 app ticker 上的 runtimeTick。
- 清 mouthTimer。
- 释放 resize listener。
- off `beforeModelUpdate` mouth/Aquarius/Miku handler。
- 从 parent removeChild(model)。
- `model.destroy({ children: true, texture: true, baseTexture: true })`。
- stop Soullink engine。
- 重置 mouthValue/baseScale。

`scene.destroy()`：

- `ResizeObserver.disconnect()`。
- `app.destroy({ removeView: false }, { children: true, texture: true })`。

注意：`removeView: false` 表示 canvas DOM 不被 Pixi 销毁，由 React 继续管理。

## 16. 排查前不变量清单

在修 Live2D v8 画布 bug 前，不建议随意破坏这些不变量：

1. `pickLive2DRenderBackend()` 当前固定走 `legacy`/v8，不要重新启用按 MOC3 分流，除非明确验证 Hiyori/Miku/Aquarius 都不回归。
2. canvas/card/aside 背景必须保持 transparent。
3. Pixi renderer `backgroundAlpha` 必须为 0。
4. `autoHitTest/autoFocus/autoUpdate` 当前为 false，事件与更新由项目自己接管。
5. Pixi hit testing 被禁用，DOM button 负责点击/拖动。
6. `renderer.resolution = min(4, DPR * max(scale, 1))` 是当前画质策略。
7. 外层 DOM scale 与模型内部 scale 同时存在，排查尺寸时必须同时看。
8. 纹理加载前会清 Pixi cache，避免同路径透明占位图不生效。
9. Tauri 透明窗口首帧可能 0x0，必须保留 `waitForCanvasLayout()` 或同等机制。
10. 不用 browser 页面作为最终 UI 验证来源，Tauri WebView 行为才是准。

## 17. 下一步排查建议顺序

这部分只记录排查顺序，不执行修复：

1. 先用 HTTP 验证 `model3.json`、moc3、所有 textures、physics、cdi 是否 200。
2. 看 `canvas resolved before init`：确认 CSS rect/client size 非 0。
3. 看 `Pixi application initialized` 和 `manual DPR renderer resize applied`：确认 canvas backing store 与 resolution 对齐。
4. 看 `model placement computed`：确认 `baseScale/displayWidth/displayHeight` 合理。
5. 看 `model bounds after layout`：确认模型 bounds 没被 anchor/pivot/scale 推出 screen。
6. 看 `render quality configuration applied`：确认 texture 尺寸、filter、mipmap、anisotropy。
7. 看 `canvas pixel sample after first model render`：确认是否有非透明像素。
8. 如果是裁切，优先查 CSS 外层 `overflow`、canvas CSS size、app.screen、gl.viewport。
9. 如果是模糊，优先查 renderer.resolution、backingStoreScale、texture mipmap/filter。
10. 如果是黑底，优先查 renderer background alpha、canvas background、patchTransparentCanvasDraw 是否生效。

## 18. 文件索引

核心文件：

- `src/features/live2d/Live2DCompanionLayer.tsx`
- `src/features/live2d/scene.ts`
- `src/features/live2d/modelController.ts`
- `src/features/live2d/cubismSetup.ts`
- `src/features/live2d/moc3Version.ts`
- `src/features/live2d/officialController.ts`
- `src/features/live2d/index.ts`
- `src/features/companion/companionConfig.ts`
- `src/features/companion/components/Live2DCompanionSettings.tsx`
- `src/features/companion/components/BongoCompanionLayer.tsx`
- `src/features/companion/useCompanionEvents.ts`
- `src/features/live2d/soullinkLocalEngine.ts`
- `vite.config.ts`

当前 Miku 资源：

- `public/live2d/miku/miku.model3.json`
- `public/live2d/miku/miku.moc3`
- `public/live2d/miku/miku.physics3.json`
- `public/live2d/miku/miku.cdi3.json`
- `public/live2d/miku/miku.4096/texture_00.png` \~ `texture_05.png`
- `public/live2d/miku/水印.exp3.json`
- `public/live2d/miku/miku.vtube.json`

## 19. 当前工作树备注

存档时主仓库 HEAD：`c662398`。

当时 `git status --short` 仅显示上级子模块 `../VibeVoice-FastAPI` 有未提交改动；Live2D 主仓库改动已在上一轮提交并推送。
