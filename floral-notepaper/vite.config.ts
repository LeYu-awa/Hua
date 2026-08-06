import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: [
      // 官方 Live2D SDK 包必须从 soullink-emotion-sdk 物理路径加载，确保其 pixi.js /
      // pixi-live2d-display peer imports 向上解析到 SDK 自带 Pixi v7，而不是项目根 Pixi v8。
      // 否则 Pixi v8 EventBoundary 会递归 Cubism4 模型树并触发
      // `currentTarget.isInteractive is not a function`。
      { find: /^@soullink-emotion\/live2d-pixi$/, replacement: fileURLToPath(new URL("./soullink-emotion-sdk/packages/live2d-pixi/dist/index.js", import.meta.url)) },
      // pixi.js v8 被 exclude 后物理加载，其 WebWorkerAdapter.mjs / GifSource.mjs 以具名导入
      // 方式 import 这两个 CJS 包，而 esbuild 预打包只能产出 default 导出，导致浏览器报
      // "does not provide an export named 'DOMParser'/'parseGIF'" 整页白屏。
      // 用 ESM shim 显式 re-export 具名导出，绕过 esbuild 的 CJS 静态分析缺陷。
      // 用精确匹配正则，避免误伤 shim 内部的深路径导入（@xmldom/xmldom/lib/index.js）。
      { find: /^@xmldom\/xmldom$/, replacement: fileURLToPath(new URL("./shims/xmldom-shim.mjs", import.meta.url)) },
      { find: /^gifuct-js$/, replacement: fileURLToPath(new URL("./shims/gifuct-js-shim.mjs", import.meta.url)) },
      // 官方 SDK 栈内嵌 Pixi v7 的 @pixi/utils/lib/url.mjs 具名导入 Node `url`（npm
      // CJS polyfill），esbuild 预打包无具名导出 → "does not provide an export named
      // 'format'"。alias 到基于原生 URL API 的 ESM shim（需配合 optimizeDeps.exclude
      // 使 @pixi/utils 物理加载，alias 才能拦截裸导入）。
      { find: /^url$/, replacement: fileURLToPath(new URL("./shims/url-shim.mjs", import.meta.url)) },
      // soullink live2d-pixi dist 内用动态 import("pixi-live2d-display/cubism4")，
      // 但项目实例化为 @naari3/pixi-live2d-display 且其 cubism4 已重命名为 cubism。
      { find: /^pixi-live2d-display\/cubism4$/, replacement: fileURLToPath(new URL("./node_modules/@naari3/pixi-live2d-display/dist/cubism.es.js", import.meta.url)) },
    ],
  },
  optimizeDeps: {
    // 官方 SDK 渲染器需要 Pixi v7（位于 soullink-emotion-sdk/node_modules），
    // legacy 后端需要 Pixi v8（项目根）。dev 优化器会按裸说明符 "pixi.js"
    // 去重为单份预打包（根 v8 胜出），导致 SDK 渲染器拿到 v8 而构造失败；
    // 排除后各 import 按物理路径解析为各自版本（生产构建走 rollup 物理解析，无此问题）。
    exclude: ["pixi.js", "@pixi/utils"],
    // SDK 的 v7 依赖树走「裸发」路径，其中 eventemitter3 / ismobilejs / earcut
    // 是 CommonJS 包，浏览器原生 ESM 无法做 CJS 互操作（"does not provide an export
    // named 'default'"）。显式预打包为 ESM，import-analysis 会把所有裸导入重写指向
    // 预打包产物，兼容 SDK 嵌套副本与根 hoisted 副本。
    //
    // pixi.js 被 exclude 后（见上）物理加载，其 lib/index.mjs 无论浏览器环境都会
    // 静态 import webworker 环境树，连同 parse-svg-path / tiny-lru 等根依赖也需要
    // 显式预打包为 ESM。
    // 注：@xmldom/xmldom 与 gifuct-js 已通过 resolve.alias 指向 ESM shim；shim 内部以
    // 「裸深路径」导入真实实现，这里把深路径也预打包（default 即完整 exports 对象），
    // 使 dev 下 shim 的导入被 import-analysis 重写为预打包 ESM，而非原样输出的 CJS。
    include: ["eventemitter3", "ismobilejs", "earcut", "parse-svg-path", "tiny-lru", "@xmldom/xmldom/lib/index.js", "gifuct-js/lib/index.js"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    setupFiles: ["./src/locales/test-setup.ts"],
  },
}));
