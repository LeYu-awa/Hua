[简体中文](README.md) | **繁體中文** | [English](README_en-US.md)

# 花箋 Floral Notepaper

輕巧、優雅、現代化的本機便箋工具，基於 Tauri 2 + React 構建。

## 功能特點

- Markdown 編輯與預覽
- 快速便箋視窗
- 磁貼模式
- 匯入匯出 `.md` 檔案

## 應用場景

- 快速記錄靈感和臨時內容
- 作為桌面便箋或待辦清單
- 隨時複製、整理和查看筆記

## 下載安裝

前往 [GitHub Releases](https://github.com/Achilng/floral-notepaper/releases) 下載最新版本。

## 從原始碼構建

### 環境需求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri CLI 2](https://tauri.app/)

### 步驟

```bash
git clone https://github.com/Achilng/floral-notepaper.git
cd floral-notepaper
npm install
npm run tauri dev
```

構建發佈版本：

```bash
npm run tauri build
```

## 授權條款

[MIT](LICENSE)
