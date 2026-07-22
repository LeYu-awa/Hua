# AI2D — AI-Native 2D Character Animation Compiler

> 设计文档 · 2026-07-17 · v0.1

---

## 1. 项目命名

| 层级 | 名称 | 说明 |
|------|------|------|
| 项目品牌 | **AI2D** | 全称 `AI-native 2D character animation`，简短、可搜索、npm 可用 |
| CLI 包 | `@ai2d/cli` | CLI + 核心编译逻辑，将分层角色图编译为 IR（第一版主推入口） |
| 运行时包 | `@ai2d/runtime` | Canvas 2D 播放器，零依赖消费 IR |
| Demo 应用 | `ai2d-demo` | Vite + vanilla TS 单页，展示 5 个动画场景 |
| 中文品牌 | **AI2D**（不另起中文名） | README 副标题用「AI 原生 2D 角色动画编译器」 |

> 第一版只发 **两个包**：`@ai2d/cli` + `@ai2d/runtime`。不设 `@ai2d/shared`，Schema 类型放在 `@ai2d/cli` 中 export，runtime 独立维护自身类型。

域名建议：`ai2d.dev`（如果可用），否则 `ai2d.vercel.app`。

---

## 2. Monorepo 包结构

```
ai2d/
├── packages/
│   ├── cli/               # @ai2d/cli
│   │   ├── src/
│   │   │   ├── cli.ts     # CLI 入口 (commander / yargs)
│   │   │   ├── parser/    # 图层解析器 (PSD/PNG 分层 → IR)
│   │   │   ├── ir/        # IR 类型定义 + Schema + 构建器
│   │   │   ├── tps/       # TPS (Thin-Plate Spline) 变形核心
│   │   │   └── exporter/  # IR → JSON 序列化
│   │   ├── __tests__/
│   │   └── package.json
│   │
│   └── runtime/           # @ai2d/runtime
│       ├── src/
│       │   ├── player.ts  # AI2DPlayer 主类
│       │   ├── mesh.ts    # 网格变形渲染
│       │   ├── blend.ts   # 图层混合 (multiply/screen/normal)
│       │   ├── tween.ts   # 插值引擎 (关键帧 → 平滑)
│       │   └── types.ts   # 公开类型（独立维护，不与 cli 共享）
│       ├── __tests__/
│       └── package.json
│
├── apps/
│   └── demo/              # ai2d-demo (Vite + vanilla TS)
│       ├── public/
│       │   └── models/    # 示例角色图 + IR
│       ├── src/
│       │   ├── scenes/
│       │   │   ├── 01-breath.ts     # 呼吸
│       │   │   ├── 02-blink.ts      # 眨眼
│       │   │   ├── 03-mouth.ts      # 嘴开合
│       │   │   ├── 04-mouse.ts      # 鼠标跟随
│       │   │   └── 05-emotion.ts    # 文本框驱动情绪
│       │   ├── main.ts
│       │   └── style.css
│       └── index.html
│
├── docs/                  # 静态站点 (VitePress / Docus)
│   └── guide/
│       ├── quick-start.md
│       └── ir-spec.md
│
├── scripts/               # 构建 / 发布脚本
├── package.json           # (workspace root)
└── pnpm-workspace.yaml    # pnpm monorepo
```

---

## 3. IR JSON Schema

最小第一版 IR（Intermediate Representation），目标是**人类可读、AI 可生成、运行时可直接消费**。

```typescript
// 核心类型（Zod schema，同时也是 TypeScript 类型）

const TextureFormatSchema = z.enum(['png', 'webp', 'jpg']);

const LayerSchema = z.object({
  id: z.string(),                          // 图层唯一 ID，如 "head", "eye-L", "mouth"
  name: z.string(),                        // 图层名（原始 PSD 图层名）
  texture: z.string(),                     // 图片路径（相对 IR JSON 或 data URL）
  textureFormat: TextureFormatSchema,
  width: z.number(),                       // 图层原始宽度 (px)
  height: z.number(),                      // 图层原始高度 (px)
  zIndex: z.number().default(0),           // 绘制顺序，从小到大从后往前绘制
  originX: z.number(),                     // 锚点 X（相对图片左上角，归一化 0-1）
  originY: z.number(),                     // 锚点 Y（相对图片左上角，归一化 0-1）
  blendMode: z.enum(['normal', 'multiply', 'screen']).default('normal'),
  opacity: z.number().min(0).max(1).default(1),
  // 网格变形参数
  mesh: z.object({
    cols: z.number().default(4),          // 网格列数（含边缘，最小 2）
    rows: z.number().default(4),          // 网格行数（含边缘，最小 2）
    // 初始顶点位置（归一化坐标 0-1，对应 texture 宽高）
    // length = cols * rows
    vertices: z.array(z.tuple([z.number(), z.number()])),
    // 三角剖分索引（每 3 个一组 → 一个三角形）
    // 运行时根据 vertices 自动生成，也可显式指定
    triangles: z.array(z.number()).optional(),
  }).optional(),                            // 无 mesh 即为静态图层
});

const ControlPointSchema = z.object({
  id: z.string(),                          // 控制点 ID，如 "eyeL", "mouthOpen"
  label: z.string(),                       // 语义标签，如 "左眼睁开度", "嘴角上扬"
  range: z.tuple([z.number(), z.number()]).default([0, 1]), // 范围
  defaultValue: z.number().default(0.5),
  // 影响矩阵：按图层分组存储，减少重复数据
  // 结构: { layerId: { vertexIndex: [[controlPointId, dx, dy], ...] } }
  // 控制点值为 0 → 不动；为 1 → 顶点偏移 (dx, dy)
  // dx/dy 为归一化值，运行时乘以 texture 宽高得到像素偏移
  influences: z.record(
    z.string(),  // layerId
    z.record(
      z.string(),  // vertexIndex（转为字符串）
      z.array(z.tuple([
        z.number(),  // dx
        z.number(),  // dy
      ]))
    )
  ),
});

const AnimationClipSchema = z.object({
  id: z.string(),
  name: z.string(),                        // 如 "blink", "breath", "surprise"
  duration: z.number(),                    // 毫秒
  // 关键帧列表
  keyframes: z.array(z.object({
    time: z.number(),                      // 相对时间（毫秒，从 0 开始）
    controlPoints: z.record(z.string(), z.number()), // { controlPointId: value }
    easing: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut']).default('easeInOut'),
  })),
  loop: z.boolean().default(true),
});

const CharacterSchema = z.object({
  formatVersion: z.string().default('ai2d-v0.1'),
  name: z.string(),
  width: z.number(),                       // 角色画布宽 (px)
  height: z.number(),                      // 角色画布高 (px)
  layers: z.array(LayerSchema),
  controlPoints: z.array(ControlPointSchema),
  animations: z.array(AnimationClipSchema).optional(),
  defaultAnimation: z.string().optional(), // 默认动画 clip id
});
```

### IR 示例（最小角色）

```json
{
  "formatVersion": "ai2d-v0.1",
  "name": "haru-mini",
  "width": 600,
  "height": 800,
  "layers": [
    {
      "id": "body",
      "name": "身体",
      "texture": "body.png",
      "textureFormat": "png",
      "width": 600,
      "height": 800,
      "originX": 0.5,
      "originY": 0.5,
      "blendMode": "normal",
      "opacity": 1
    },
    {
      "id": "head",
      "name": "头",
      "texture": "head.png",
      "textureFormat": "png",
      "width": 300,
      "height": 350,
      "originX": 0.5,
      "originY": 0.8,
      "mesh": {
        "cols": 4,
        "rows": 4,
        "vertices": [
          [0,0],[0.33,0],[0.66,0],[1,0],
          [0,0.33],[0.33,0.33],[0.66,0.33],[1,0.33],
          [0,0.66],[0.33,0.66],[0.66,0.66],[1,0.66],
          [0,1],[0.33,1],[0.66,1],[1,1]
        ]
      }
    }
  ],
  "controlPoints": [
    {
      "id": "headTilt",
      "label": "头部倾斜",
      "range": [-15, 15],
      "defaultValue": 0,
      "influences": {
        "head": {
          "0": [[0, 0]],
          "4": [[0, 0]]
        }
      }
    }
  ]
}
```

---

## 4. TPS 算法边界

第一版**不使用 Thin-Plate Spline（TPS）**，原因是：

| 方案 | 复杂度 | 精度 | 适用场景 |
|------|--------|------|----------|
| 双线性网格变形 | 低 | 中等 | 面部局部变形（眼、嘴）✅ |
| TPS (Thin-Plate Spline) | 高 | 高 | 全身大幅变形 ❌ 第一版不做 |
| 仿射变换 | 低 | 低 | 整体位移/旋转 ✅ 已有 |

### 第一版的变形策略

1. **基础层**（无 mesh）：直接 drawImage，支持 translate/rotate/scale
2. **网格变形层**（有 mesh）：双线性插值 + Canvas 2D 三角形裁剪渲染
   - 将网格分成 `(cols-1) × (rows-1)` 个四边形
   - 每个四边形拆成 2 个三角形
   - 使用 `ctx.clip()` + `drawImage` 逐三角形绘制：

     ```typescript
     // 方案A（第一版采用）：clip + drawImage，实现简单
     for (const tri of triangles) {
       const [a, b, c] = tri;
       ctx.save();
       ctx.beginPath();
       ctx.moveTo(ax, ay);
       ctx.lineTo(bx, by);
       ctx.lineTo(cx, cy);
       ctx.closePath();
       ctx.clip();
       // 用三角形的 AABB 包围盒做 drawImage 裁剪
       ctx.drawImage(texture, sx, sy, sw, sh, dx, dy, dw, dh);
       ctx.restore();
     }

     // 方案B（v0.2 优化方向）：setTransform 仿射映射，性能更好但实现复杂
     ```

   - 性能目标：在 4×4 网格（8 三角形）× 10 图层 = 80 次 clip/帧 场景下保住 30fps
   - 第一版不提前优化，在 Demo 中用 `performance.now()` 标记性能基线
3. **控制点驱动**：控制点值 → 线性加权 → 顶点偏移
4. **插值**：关键帧之间用线性插值 + easing 函数

### 未来扩展（v0.2+）

- 引入 WASM 加速网格变形
- 引入 TPS 作为可选变形后端（适合布料、头发等大幅柔性变形）
- 引入 WebGPU compute shader（当 Canvas 2D 性能不够时）

---

## 5. Canvas Runtime API

目标：**3 行代码跑通基础动画**。

```typescript
// 导入
import { AI2DPlayer } from '@ai2d/runtime';

// 1. 创建播放器
const player = new AI2DPlayer(document.getElementById('canvas')!, {
  width: 600,
  height: 800,
});

// 2. 加载角色
await player.load('./haru-mini/haru.ir.json');

// 3. 播放动画
player.play('breath');
```

### AI2DPlayer API 设计

```typescript
interface AI2DPlayerOptions {
  width: number;
  height: number;
  fps?: number;            // 默认 30
  backgroundColor?: string;
}

interface ControlPointState {
  [controlPointId: string]: number;  // 0-1 归一化值（会被 range 映射）
}

class AI2DPlayer {
  constructor(canvas: HTMLCanvasElement, options: AI2DPlayerOptions);

  // 加载
  load(irPath: string): Promise<void>;
  loadFromIR(ir: CharacterSchema): void;

  // 播放控制
  play(clipId?: string): void;         // 播放指定动画，不传则播默认动画
  pause(): void;
  resume(): void;
  stop(): void;
  setTime(timeMs: number): void;

  // 实时控制点覆盖（AI 驱动入口）
  setControlPoints(cp: ControlPointState): void;
  getControlPoints(): ControlPointState;
  resetControlPoints(): void;

  // 属性
  get isPlaying(): boolean;
  get duration(): number;

  // 导出（v0.1 只做 API 预留，不实现）
  capture(): ImageData;                      // 截取当前帧
  exportFrames(options: {                    // 导出帧序列（配合 ffmpeg.wasm / gif.js）
    duration: number;
    fps: number;
  }): Promise<ImageData[]>;

  // 事件
  on(event: 'frame', handler: (time: number) => void): void;
  on(event: 'load', handler: () => void): void;
  on(event: 'error', handler: (err: Error) => void): void;

  // 清理
  destroy(): void;
}
```

### 与 Agent 信号桥的对接模式（第二期）

保留你现有 `signalBridge.ts` 的思路，输出对象替换为：

```typescript
// Agent 发送语义命令
agentBus.send({
  type: 'CHARACTER_COMMAND',
  payload: {
    controlPoints: { eyeL: 0.2, mouthOpen: 0.8, headTilt: 5 },
    animation: 'talk',
  },
});

// Runtime 层消费
player.on('frame', (time) => {
  const cp = signalBridge.getLatestControlPoints();
  if (cp) player.setControlPoints(cp);
});
```

---

## 6. Demo 验收标准

### 场景列表

| # | 场景 | 验收标准 |
|---|------|----------|
| 1 | **呼吸** | 角色胸部/肩膀图层以 0.25Hz 频率做微小上下位移，持续循环 |
| 2 | **眨眼** | 每 3-5 秒一次完整眨眼（眼睑图层 0→1→0，约 150ms），随机间隔 |
| 3 | **嘴巴开合** | 鼠标点击或键盘空格触发，嘴巴 0→1→0，约 300ms |
| 4 | **鼠标跟随** | 头部/眼睛网格跟随鼠标位置做小范围偏移（±5px），带有 100ms 延迟平滑 |
| 5 | **情绪文本框** | 文本框输入 `happy/sad/surprise/angry`，触发不同控制点组合 + 动画 clip 切换 |

### 第一版 Demo 技术约束

- 纯 Canvas 2D，不依赖 WebGL
- 所有角色图使用 PNG 分层（非 .moc3）
- IR JSON 手写（第一版不做 PSD 解析器）
- 单 HTML 文件可跑（Vite 构建后）

### 发布目标

| 时间 | 目标 |
|------|------|
| 第一周 | CLI 编译 + IR 格式 + 场景 1-3 可用 |
| 第二周 | 场景 4-5 + 内部测试 + README 打磨 |
| 第三周 | `@ai2d/runtime` NPM 发布 + **Show HN**（收集反馈） |
| 第四周 | 根据 Show HN 反馈迭代 + Twitter 短视频 + 长尾传播 |

> 节奏逻辑：第二周不急着发 Show HN，先把 Demo 体验和 README 磨透。Show HN 只有一次首印象，数据到位了再发。

---

## 7. 开源 README 传播话术

### 英文顶部

```
<h1 align="center">AI2D</h1>
<p align="center">
  <b>AI-native 2D character animation compiler & Canvas runtime.</b><br/>
  Turn layered artwork and semantic control points into real-time animated characters.<br/>
  <b>No Cubism SDK. No WebGL. No proprietary binaries.</b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ai2d/runtime"><img src="..." alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

---

## Why AI2D?

Existing 2D character animation pipelines (Live2D, Spine) were designed for **human artists using GUI editors**, not for **AI agents generating motion data**.

AI2D reimagines the pipeline from the ground up:

```
Input              Compiler          Runtime
━━━━━━━━━          ━━━━━━━━          ━━━━━━━
PNG layers    →    @ai2d/compiler →  @ai2d/runtime
Control data  →    (CLI / API)    →  (Canvas 2D)
└─ AI-generated   └─ .ir.json      └─ < 5KB gzip
```

## Quick Start (3 lines)

```bash
npm install @ai2d/runtime
```

```typescript
import { AI2DPlayer } from '@ai2d/runtime';
const player = new AI2DPlayer(canvas);
await player.load('./character.ir.json');
player.play('breath');
```

## Key Features

- **AI-native IR format** — control points are plain JSON, directly generatable by LLMs
- **Zero GPU dependency** — runs on Canvas 2D, works in any browser, Node.js, or Tauri webview
- **Tiny runtime** — < 5KB gzipped, no WASM required for basic use
- **Semantic control** — control by name ("eyeL": 0.3), not by bone index
- **Extensible** — WASM acceleration and TPS backend available as opt-in

## Roadmap

| Version | Focus |
|---------|-------|
| v0.1    | Mesh deformation (bilinear), clip-based triangle rendering, 5 demo scenes, NPM release |
| v0.2    | TPS backend (opt-in WASM), PSD layer parser, `setTransform` perf optimization |
| v0.3    | GIF/MP4 export, multi-character scenes, editor UI prototype |

> Track progress on the [AI2D Roadmap Project Board](https://github.com/.../projects/1).

## License

MIT
```

### 中文副标题（README 顶部）

```
<p align="center">
  AI 原生 2D 角色动画编译器与 Canvas 运行时。<br/>
  把分层角色图和语义控制点编译成实时动画角色，<br/>
  <b>不依赖 Cubism SDK、WebGL 或私有二进制格式</b>。
</p>
```

### Show HN 标题建议

> Show HN: AI2D – AI-native 2D character animation compiler (no Cubism SDK, no WebGL)

### Twitter/X 短视频脚本（第二周）

```
[0:00-0:05] 展示一张 Stable Diffusion 生成的二次元角色图
[0:05-0:10] 展示该角色的分层 PNG（身体、头、眼、嘴分别拖开）
[0:10-0:20] 运行 `npx @ai2d/compiler clip --layers ./layers/ --output ./character.ir.json`
[0:20-0:30] `canvas` 中出现角色开始呼吸 → 眨眼 → 鼠标跟随
[0:30-0:40] 文本框输入 "sad"，角色表情变化
[0:40-0:45] 打出 "AI2D — AI-native 2D animation" + GitHub star 引导
```

---

## 附录：floral-notepaper 集成时序

```
            ┌──────────────────────────────┐
            │      AI2D 开源项目独立发展      │
            │  (ai2d-compiler + ai2d-runtime)│
            └──────────┬───────────────────┘
                       │ v0.1 稳定发布后
                       ▼
┌──────────────────────────────────────────┐
│      floral-notepaper 消费层              │
│                                          │
│  Live2DCompanionLayer.tsx                │
│    └── 内部实现从 Cubism Core 替换为      │
│        @ai2d/runtime (AI2DPlayer)        │
│                                          │
│  signalBridge.ts (保留，输出目标改变)      │
│    └── Agent 语义命令 → AI2DPlayer        │
│        .setControlPoints() / .play()     │
└──────────────────────────────────────────┘
```

第一阶段：专注 `ai2d/` monorepo，不碰 fl。
第二阶段：`@ai2d/runtime` v0.1 发布后，再回 fl 替换 `Live2DCompanionLayer.tsx`。
