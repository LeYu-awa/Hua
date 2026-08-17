---
name: "github-auto-archive"
description: "对话/任务完成后自动把工作区改动提交并推送到 GitHub 做存档。每轮对话结束、修复完成、或用户说「上传到 GitHub / 提交推送 / 自动存档 / 刷新绿码」时自动调用，无需再询问。"
---

# GitHub 自动存档

本项目的用户习惯：**每完成一轮对话就把改动上传到 GitHub 存档**（也可用于刷新贡献绿码）。本 skill 定义标准存档流程，默认自动执行，不需要额外询问。

## 何时触发

- 一轮对话/任务完成，工作区存在未提交的代码改动
- 用户说「上传到 GitHub」「先上传」「提交推送」「自动存档」「刷新绿码」「随便更新个东西」
- 修复 bug、新增功能、文档更新完成后

## 执行步骤

1. **并行摸底**：`git status`、`git diff --stat`、`git log --oneline -5`（确认改动范围与既有提交风格）。
2. **审查 diff**：对意外改动（如无关格式化、子模块、Cargo.lock/package-lock 异常）先 `git diff <file>` 确认再决定是否包含。
3. **按文件暂存**：逐个 `git add <path>`。
   - 跳过子模块（如 `../VibeVoice-FastAPI`）与无关格式化改动
   - 禁止 `git add .` / `git add -A`，避免夹带 .env / 凭据 / 大体积二进制
4. **提交**：Conventional Commits 风格 `<type>(<scope>): <subject>`，副段说明「为什么改」。用 PowerShell 单行 `-m` 传参（heredoc 不支持）。
5. **推送**：`git push`；若本地领先远端多个提交，一并推送并确认远端分支已同步。
6. **汇报**：给出提交 hash、推送范围与结果（如 `c83f7a2..ed67714 main -> main`）。

## 硬性规则

- 不修改 git config，不 force push 到 main
- 触发后不再追问"是否提交"，直接存档
- 提交信息聚焦「为什么」，不罗列文件清单
- 用户明确要求暂不推送的例外，尊重用户决定
