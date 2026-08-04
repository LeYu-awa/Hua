// ESM 桥接层：pixi.js v8 的 WebWorkerAdapter.mjs 需要 `import { DOMParser } from '@xmldom/xmldom'`，
// 但 esbuild 无法静态分析 CJS 导出链（exports.DOMParser = require('./dom-parser').DOMParser），
// 预打包产物只有 default 导出，导致浏览器报 "does not provide an export named 'DOMParser'"。
// 此 shim 从 CJS 的 default 导出（module.exports 整体）显式具名 re-export。
// 用命名空间导入再取 .default：统一绕过 vite 的 __esModule 互操作判断。
// dev 下 vite 的 import-analysis 会将裸深路径重写为 optimizeDeps 预打包产物。
import * as ns from "@xmldom/xmldom/lib/index.js";

const mod = (ns && ns.default) || ns;

export const DOMParser = mod.DOMParser;
export const XMLSerializer = mod.XMLSerializer;
export const DOMImplementation = mod.DOMImplementation;
export default mod;
