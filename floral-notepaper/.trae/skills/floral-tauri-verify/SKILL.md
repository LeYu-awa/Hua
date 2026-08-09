---
name: "floral-tauri-verify"
description: "花箴 Tauri 桌面应用的验证/启动/调试铁律。禁止用浏览器验证 UI；exe 用 WMI 启动；单实例僵尸清理；release 构建自包含验证。处理 Tauri 启动、WebView2、验证相关任务时调用。"
---

# 花箴 Tauri 验证铁律

本项目是 **Tauri v2 桌面应用（WebView2）**，验证与复现问题遵循以下铁律。

## 验证方式

- **禁止**用 browser_use / 浏览器截图去看页面效果、验证 UI 或读页面控制台。浏览器 vite 页面行为 ≠ Tauri WebView 行为。
- 合法的验证/复现方式：
  - HTTP 资源验证：`Invoke-WebRequest http://localhost:1420/<path>`（dev 模式）
  - 代码静态分析（cargo check / test、tsc）
  - Tauri 应用内自行验证
  - 项目内调试上报：POST 到 `127.0.0.1:7777/event` 在 Tauri 里采集日志

## 启动 exe（沙箱注意）

- **禁止**用 RunCommand 直接启动 Tauri exe：trae-sandbox 限制对 `%LOCALAPPDATA%\com.floral-notepaper.app\EBWebView` 的写入，WebView2 初始化会永久挂起（进程 0 CPU、内存 ~24-30MB、窗口标题为 `com.floral-notepaper.app-siw`、永远不创建主窗口）。
- 正确启动方式：
  ```powershell
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '"<exe路径>"' }
  ```
  或让用户自己双击 exe。
- 沙箱卡死标志：进程 WorkingSet ~24MB、CPU 0 秒、MainWindowTitle = `com.floral-notepaper.app-siw`。

## 单实例僵尸

- `src-tauri\src\lib.rs` 注册了 `tauri_plugin_single_instance`，新实例会把参数转发给旧实例并退出；一旦有僵尸实例，双击永远打不开。
- 清理：杀光所有 `floral-notepaper.exe` 进程再启动。
- 判断主实例：主实例会创建 SIW 窗口（MainWindowTitle 为 `com.floral-notepaper.app-siw`）。

## 构建与交付

- dev 版 exe 依赖 vite（端口 1420），vite 一死窗口白屏；**release 版内置前端，双击即开**。
- 交付/验证一律用 `npm run tauri build -- --no-bundle` 产物 `src-tauri\target\release\floral-notepaper.exe`（自包含 ~184MB）。
- WebView2 用户数据目录 `C:\Users\zjm\AppData\Local\com.floral-notepaper.app\EBWebView` 仅缓存可删（笔记/配置在 default_store() 的 config 目录）。WebView2 卡死可删该目录重试（沙箱内删不掉，需 WMI 或用户操作）。
- 调试启动问题：release 是 GUI 子系统无控制台输出；debug exe 有控制台。Rust setup 卡死优先查 `setup_desktop`（desktop.rs）：单实例 → RuntimeState/NotepadPool → autostart → global-shortcut → tray → prewarm → show_main_window。

## 前端白屏经验（pixi v8 / SDK 栈）

- pixi.js v8 的 `WebWorkerAdapter.mjs` 静态 import CJS 包 `@xmldom/xmldom` → 用 `shims/xmldom-shim.mjs` + 精确正则 alias + `optimizeDeps.include` 裸深路径。
- 具名导出缺失（`does not provide an export named`）：vite 预打包 CJS 具名导出问题 → shim + 精确 alias + `optimizeDeps.exclude` 组合拳。
