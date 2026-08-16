# Live2D 缩放体系 Bug 源码级排查与修复（Case Study）

> 项目：花箴（floral-notepaper）— Tauri v2 + Vue3/React + Vite 桌面应用
> 技术栈：Pixi v8 自研 Live2D 画布 + `@naari3/pixi-live2d-display/cubism5` + Cubism5 Core
> 关联文档：[live2d-pixi-v8-canvas-chain.md](./live2d-pixi-v8-canvas-chain.md)（V8 画布全链路存档）

---

## 1. 问题背景

桌面伴侣中嵌入了 Live2D 模型（Miku，MOC3 v5），用户通过 UI 滑块调节"调大小"（scale），期望：卡片与模型按同一比例同步缩放、模型始终居中、缩放过程平滑无跳变。

## 2. 症状（用户原始反馈）

| #   | 症状                                               | 表面猜测   | 真实原因（最终定位）                                                      |
| --- | -------------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| 1   | 模型渲染盒检测非常大，模型只显示在左下角           | 像素比问题 | 缩放/居中体系混乱：anchor 语义误用 + 物理/逻辑像素错位                    |
| 2   | 缩放比例 > 1.2 视觉无变化，调到 1.7 需刷新才生效   | 渲染未刷新 | 两套比例换算互相覆盖：`fitModelToViewport` 重算 baseScale 后 scale 被重置 |
| 3   | 放大后头脚被裁剪，可视区不变                       | 画布不够大 | Live2D 内部 viewport 使用 renderer.width，与物理 canvas 不一致            |
| 4   | 放大时卡片变大快于模型，模型偏左下角，Y 轴上下跳动 | 时序问题   | 模型缩放与卡片缩放不是同一线性函数；每次缩放都"适配视口"重定位            |

**核心矛盾**：模型存在两套独立换算体系（DOM 卡片的 CSS 缩放 + WebGL 模型的世界变换），一旦两者非线性耦合，就会出现"卡片快于模型 / 位置漂移 / 跳动"。

## 3. 排查方法论（如何下手）

### 3.1 第一步：先存档、再排查

动手前先把 V8 画布的全链路（运行链路、渲染构成、材质加载、像素比、与 CSS 结合方式）写成文档
（`live2d-pixi-v8-canvas-chain.md`）。**对不熟悉的渲染链路动手前，先建立完整的心智模型，避免盲改。**

关键结论（存档文档确认）：

- `app.screen` = CSS/逻辑像素尺寸；`canvas.width = screen.width × resolution`（物理像素）。
- `renderer.resize(w, h, resolution)` 才真正设置 canvas backing store，`screen` 保持逻辑尺寸。
- `autoDensity: true` 使 canvas CSS 尺寸等于逻辑尺寸。

### 3.2 第二步：运行时证据采集（不在浏览器里猜）

项目是 Tauri 桌面应用（WebView2），**禁止用浏览器看页面效果**——vite 页面行为 ≠ Tauri WebView 行为。
因此在代码里植入调试上报：

```ts
const reportModelDebug = (hypothesisId, location, msg, data) => {
  fetch("http://127.0.0.1:7778/event", {
    method: "POST",
    body: JSON.stringify({ sessionId, hypothesisId, location, msg, data }),
  });
};
```

在 load / setScale / resize 关键路径上报：逻辑尺寸、物理 canvas 尺寸、DPR、模型 bounds、position、scale、viewport 等。

**日志给出的决定性证据**（Tauri 内实测）：

```
W=逻辑=768，canvasW=物理=1536（DPR=2）
screen 中心 = 384×384
模型 position 左上角 = 372×210
miku 画布 = 2976×4175，中心 = 1488×2087.5
物理映射：1488×1.273 ≈ 1164.6 → world: 372 + 1164.6 − 1536 ≈ 0.4
```

结论：**模型左边缘恰好贴在画布左边缘**——模型没有居中，而是从某个固定基点向右下展开。

### 3.3 第三步：追溯到源码级换算（拒绝参数微调）

用户明确要求"追溯到源码级的转换来修改"。于是直接读 `@naari3/pixi-live2d-display/dist/cubism5.es.js` 的变换链：

```js
// L5091-5097  anchor 仅影响 Pixi pivot
onAnchorChange() {
  this.pivot.set(this.anchor.x * this.internalModel.width,
                 this.anchor.y * this.internalModel.height);
}

// L11416  centeringTransform：先缩放 PPU，再平移到画布中心
this.centeringTransform.scale(this.pixelsPerUnit, this.pixelsPerUnit)
                        .translate(this.originalWidth / 2, this.originalHeight / 2);

// L11466-11467  最终 drawingMatrix 链
this.drawingMatrix.copyFrom(this.centeringTransform)   // × centering
                  .prepend(this.localTransform)        // × local（姿态）
                  .prepend(transform);                 // × Pixi transform
```

**推导 world 坐标**（假设 PPU=1、无姿态 localTransform=Identity）：

```
world = transform × localTransform × centeringTransform × vertex
      = T(position) × S(scale) × T(-pivot) × [S(PPU) × T(w/2, h/2)] × vertex
```

取画布左上角 vertex=(0,0)：
`centeringTransform` 先把它平移到 `(w/2, h/2)`（画布中心），然后 `T(-pivot)` 用 `anchor=0.5` 时的 pivot=`(w/2, h/2)` **恰好抵消**，最终落到 `position`。

**结论（源码级）**：`anchor=0.5` 在 Live2D 的 drawingMatrix 链中**完全无效**——模型内容恒以 `model.position` 为左上角向右下展开。这与日志证据完全吻合。

### 3.4 第四步：失败方案的教训（为什么不能"适配视口"）

排查中尝试过：

1. **`fitModelToViewport`**：每次 setScale 都把模型缩放到"刚好装进可视区"并居中。
   → **失败**：它会反向覆盖用户滑块比例，导致每次缩放后 baseScale 随视口波动，Y 轴连续跳动、位置漂移。
2. **model3.json 加 Layout（CenterX/CenterY）**：→ **失败**：两套体系的比例换算问题不在 Layout，纯参数微调无效。

**教训**：当 bug 的本质是"两套坐标系/换算链相互覆盖"时，任何在业务层补参数的行为都是在给根因打补丁，必须在换算链层面统一。

## 4. 根因总结

1. **双重缩放体系互相覆盖**：`setScale` 用 `baseScale × config.scale`，而 `fitModelToViewport` 又 `scale.set(1)` 重算 baseScale——两套换算打架，导致缩放非线性、刷新才生效、Y 轴跳动。
2. **居中语义错误**：误以为 `anchor=0.5` 能居中，实际被 centeringTransform 抵消，内容从 position 向右下展开 → 模型偏角。
3. **viewport 与物理 canvas 不一致**：Live2D 渲染回调用 `renderer.width`（或 screen）当 viewport，与物理像素 canvas 存在 DPR 偏差 → 渲染盒检测偏差、裁剪。
4. **渲染分辨率与缩放滑块耦合**：`setQualityScale(next.scale)` 把 DPR 和缩放绑定，造成">1.2 无变化 / 1.7 需刷新"。

## 5. 修复方案（源码级）

### 5.1 统一换算链：模型与卡片恒成比例

```ts
// 参照卡片尺寸（与 DOM 卡片 LIVE2D_WIDTH/LIVE2D_HEIGHT 一致）
const MODEL_REFERENCE_WIDTH = 260;
const MODEL_REFERENCE_HEIGHT = 380;
const MODEL_REFERENCE_FILL_RATIO = 0.96;

// load 时只算一次，与视口/分辨率完全解耦
const computeBaseScale = (live2dModel: Live2DModel) => {
  const modelWidth = Math.max(live2dModel.width || 1, 1); // 2976
  const modelHeight = Math.max(live2dModel.height || 1, 1); // 4175
  baseScale = Math.min(
    (MODEL_REFERENCE_WIDTH * MODEL_REFERENCE_FILL_RATIO) / modelWidth,
    (MODEL_REFERENCE_HEIGHT * MODEL_REFERENCE_FILL_RATIO) / modelHeight,
  );
  return { modelWidth, modelHeight, baseScale };
};

const applyModelScale = (live2dModel: Live2DModel, scale: number) => {
  live2dModel.scale.set(baseScale * Math.max(scale, 0.01));
  centerModel(live2dModel);
};
```

卡片 = `260×scale × 380×scale`，模型 = `2976×baseScale×scale × 4175×baseScale×scale`。
**两者都是严格线性 ×scale，比例恒定**——卡片快于模型的症状从根上消除。

### 5.2 修正居中语义（按内容尺寸反推 position）

```ts
const centerModel = (live2dModel: Live2DModel) => {
  const screenW = Math.max(live2dScene.app.screen.width || 360, 1);
  const screenH = Math.max(live2dScene.app.screen.height || 520, 1);
  const contentW = Math.max(live2dModel.width || 1, 1) * Math.max(live2dModel.scale.x, 0.01);
  const contentH = Math.max(live2dModel.height || 1, 1) * Math.max(live2dModel.scale.y, 0.01);
  live2dModel.x = screenW / 2 - contentW / 2;
  live2dModel.y = screenH / 2 - contentH / 2;
};
```

既然内容以 position 为左上角展开，那么令 **position = 屏幕中心 − 内容尺寸/2**，内容几何中心即落在画布中心。

### 5.3 视口变化只居中、不重算缩放

```ts
releaseSceneResize = live2dScene.onResize(() => {
  if (model !== currentModel) return;
  centerModel(currentModel); // 不再 fitModelToViewport
});
```

缩放由滑块线性驱动；视口变化只补偿居中——彻底切断"适配视口与滑块互相覆盖"的循环。

### 5.4 viewport 源码级补丁（透明窗口渲染盒修正）

在 `InternalModel.draw` 前把 Live2D 内部 viewport 覆盖为 canvas 物理像素，draw 后恢复 GL 状态：

```ts
internalModel.draw = (gl) => {
  const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const viewport = gl.getParameter(gl.VIEWPORT);
  const scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
  const scissorBox = gl.getParameter(gl.SCISSOR_BOX);
  internalModel.viewport = [0, 0, canvas.width, canvas.height]; // 物理像素
  originalDraw(gl);
  // 恢复 framebuffer / viewport / scissor / clearColor ...
};
```

### 5.5 渲染分辨率与缩放解耦

`setQualityScale(1)` 固定渲染 DPR，不再随滑块变化——消除">1.2 无变化、1.7 需刷新"。

## 6. 修复前后换算对照

| 维度          | 修复前                                   | 修复后                                     |
| ------------- | ---------------------------------------- | ------------------------------------------ |
| 模型缩放      | `baseScale × scale` 与"适配视口"互相覆盖 | `baseScale × scale`，baseScale 恒定        |
| 卡片/模型同步 | 卡片 260×scale，模型缩放非线性           | 均严格线性 ×scale，比例恒定                |
| 居中          | 误用 anchor=0.5（被抵消）                | position 按内容尺寸反推，内容中心=画布中心 |
| 视口变化      | 重算 baseScale + 重定位 → 跳动           | 只重新居中                                 |
| viewport      | 用 renderer.width（逻辑/物理不一致）     | 覆盖为 canvas 物理像素                     |
| 渲染 DPR      | 随滑块 scale 变化                        | 固定 DPR                                   |

## 7. 验证

- `npx tsc --noEmit` 通过（清理插桩后复验）。
- Tauri 内复测：模型始终居中、与卡片同步缩放、不再上下跳动、不再拦腰斩断。

## 8. 复盘与工程沉淀

1. **坐标系意识**：WebGL 渲染中至少存在三套坐标（CSS 逻辑像素 / Pixi screen / 物理 backing store），任何一处用错都会产生"检测盒大、显示偏角、裁剪"这类症状。
2. **先读源码、再动手**：用户拒绝参数微调、要求源码级修改是正确的——两次业务层补丁（fitModelToViewport、Layout）都以失败告终，只有追溯到 drawingMatrix 变换链才找到根因。
3. **运行时证据 > 静态猜测**：Tauri 项目禁用浏览器验证，用插桩上报把"逻辑/物理尺寸、position、bounds"打成结构化日志，让根因从数据里"跳出来"。
4. **单一缩放源**：当 DOM 与 WebGL 需要视觉同步时，必须保证它们是同一线性函数的两个输出，而不是各自适配。
5. **调试插桩要可清理**：用 `#region debug-point` + 独立函数组织，排查完成后整体删除，交付干净代码（本次全部移除并通过 tsc）。

---

## 修订记录

| 日期       | 版本 | 说明                             |
| ---------- | ---- | -------------------------------- |
| 2026-08-10 | v1.0 | 初版：源码级排查与修复全过程归档 |
