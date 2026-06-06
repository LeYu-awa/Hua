**简体中文** | [繁體中文](README_zh-HK.md) | [English](README_en-US.md)

# 花笺 Floral Notepaper

轻量、优雅、现代化的本地便签工具，基于 Tauri 2 + React 构建。

## 功能特点

- Markdown 编辑与预览
- 快捷便签窗口
- 磁贴模式
- 导入导出 `.md` 文件

## 应用场景

- 快速记录灵感和临时内容
- 作为桌面便签或待办清单
- 随时复制、整理和查看笔记

## 下载安装

前往 [GitHub Releases](https://github.com/Achilng/floral-notepaper/releases) 下载最新版本。

## 从源码构建

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri CLI 2](https://tauri.app/)

### 步骤

```bash
git clone https://github.com/Achilng/floral-notepaper.git
cd floral-notepaper
npm install
npm run tauri dev
```

构建发布版本：

```bash
npm run tauri build
```

## 许可证

[MIT](LICENSE)
