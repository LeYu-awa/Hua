// ESM 桥接层：pixi.js v8 的 GifSource.mjs 需要 `import { parseGIF, decompressFrames } from 'gifuct-js'`，
// 但 esbuild 预打包只产出 default 导出。此 shim 显式具名 re-export。
// 用命名空间导入再取 .default：gifuct 的 CJS 设了 __esModule 但没 default，
// vite 的互操作包装（__esModule ? .default : module）会得到 undefined，命名空间导入可绕过。
// dev 下 vite 的 import-analysis 会将裸深路径重写为 optimizeDeps 预打包产物。
import * as ns from "gifuct-js/lib/index.js";

const mod = (ns && ns.default) || ns;

export const parseGIF = mod.parseGIF;
export const decompressFrame = mod.decompressFrame;
export const decompressFrames = mod.decompressFrames;
export default mod;
