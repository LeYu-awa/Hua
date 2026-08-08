# 方案 · Live2D 语音写作导师（对话即写作）+ VibeVoice 本地 TTS

日期：2026-08-09
项目：floral-notepaper
状态：定位已确认，方案定稿，待实施
硬件基线：RTX 4060 8GB
组合栈：LLM + Live2D + 语音（TTS）+ Agent

## 1. 背景与目标

### 1.1 核心定位（已与用户确认）

**Live2D 角色 = 用户的"写作导师"（引导型共创）**，组合 LLM + Live2D + 语音 + Agent，实现"对话即写作"：

- 用户和 Live2D 角色聊天，角色以**苏格拉底式提问**帮用户梳理思路、逼出细节（引导型，不替你写、帮你写）。
- **上下文全程可见**：对话历史（面板）、生成过程（预览）、落文结果（笔记）三层透明。
- 聊到**主题收敛**时，角色**主动提议**"要不要整理成文？"，用户确认后 LLM 把对话组织成文章，**新建一篇笔记**。
- 角色全程带人设口吻、情绪表演和**本地语音**（TTS + 口型联动）。

### 1.2 目标

1. 复用现有 LLM/工具链、TTS 模块、Live2D 情绪层，避免重复建设。
2. 落地 VibeVoice 本地语音（Realtime-0.5B 实时对话 + TTS-1.5B 长文朗读）。
3. 补齐三个新增能力：引导型人设 prompt、主题收敛检测、整理成文动作。

### 1.3 非目标

- 角色不做重工具分析（读/改笔记等深度操作仍归「花笺」功能助手）。
- 不接 VibeVoice-ASR（显存不足，见 §5.1）。
- 不替换现有 Pixi/Cubism 渲染链路与 SidebarChat 对话引擎。

## 2. 用户旅程

```
用户和角色闲聊灵感 / 写作卡壳
  → 角色以人设口吻 + 语音接话（情绪表演层同时表达）
  → 角色用引导型提问帮用户梳理（一次一问，追问细节）
  → 主题收敛检测命中 → 角色主动提议"要不要整理成文？"（气泡 + 语音）
  → 用户同意
  → LLM 把对话组织成 Markdown 文章 → 新笔记预览卡（可编辑）
  → 用户确认 → note.create 落成新笔记
  → 角色语音朗读成文开头（短文可全读），情绪 excited
  → 回到引导循环 / 用户自行继续
```

## 3. 现状盘点（复用点）

### 3.1 TTS 模块（`src/features/tts/`）

- 引擎 4 种：`gpt-sovits` / `vits` / `edge` / `openai`（`types.ts`）。
- 调用链：`speakText(text, {emotion}) → synthesizeWithConfig → blob URL → new Audio(url).play()`。
- 情绪→语速映射已有（happy +15% / sad -15% / angry +10%）。
- 配置 UI：Elysia 面板 `tts` Tab；配置存 localStorage `elysia_tts_config`。
- 调用点：`SidebarChat`（回复自动朗读）、`ElysiaPage`（打招呼）。

### 3.2 Live2D 情绪与口型（`src/features/live2d/`）

- 人设：`soullinkLocalEngine.ts` `PERSONA_DEFS`（Haru 温柔陪伴 / Hiyori 元气 / 水瓶座之恋安静）。
- 情绪表演层（Soullink）：`live2d_signal` → VAD → 表情/动作/气泡，写作状态感知（焦虑关怀）已有。
- 口型 API 已就绪但未与音频联动：`modelController.ts` / `officialController.ts` 的 `setMouthValue(v)` / `pulseMouth()`，`ParamMouthOpenY`。

### 3.3 对话与工具链（`src/features/sidebarChat/`）

- 对话引擎 + LLM：`SYSTEM_PROMPT` + `AGENT_SYSTEM_SUFFIX`（工具自主调用指令），上下文窗口自动附带（`CONTEXT_WINDOW`）。
- Agent 工具：`note.list / read / search / create / update / moveCategory / web.search / openUrl / copyText`（`assistantTools.ts`）。
- 写回预览机制：`pendingTool.review` → `applyChatWriteback`（生成稿 → 变更预览 → 确认 → 写回）。

### 3.4 信号与沉淀

- `AgentUICommand` 统一指令协议（`signalQueue.ts`）：已有 `live2d_signal`（mood/animation/bubbleText/priority），冷却/去重/优先级齐全。
- `chatDistill.ts`：规则分类（决策/待办/风险）+ 压缩文案 + "要不要放到画布上？"主动建议——**正是"收敛检测 + 主动提议"的现成范式**。

## 4. 角色系统设计（新增核心）

### 4.1 引导型人设 prompt

新增"角色对话模式"，复用 SidebarChat 引擎，仅替换系统 prompt：

```
你是「{角色名}」，用户写作时的导师型伙伴。性格沿用你的专属人设。
你的工作方式（苏格拉底式引导）：
1. 一次只问一个问题，具体、开放、围绕当前主题（人物动机 / 情节转折 / 感官细节）。
2. 不替用户下结论，通过追问帮 TA 自己把模糊的想法说清楚。
3. 用户给出新信息时，先简短肯定并复述确认，再问下一个更深入的问题。
4. 当话题要素基本齐全（角色/事件/观点/细节都有了）时，主动提议：
   "要不要我把刚才聊的整理成一篇文章？"
5. 保持人设语气：回复简短、口语化、像朋友。
```

- 工具指令沿用 `AGENT_SYSTEM_SUFFIX` 但默认只读（`note.read`），写操作只在成文时由系统触发。
- 入口：SidebarChat 增加模式开关（"功能助手 / 角色聊天"），或独立角色对话窗口（后续可加）。

### 4.2 主题收敛检测（角色何时提议成文）

第一版**纯规则**（确定性、可测、借鉴 `chatDistill`），不依赖 LLM：

输入最近 N 条对话消息，聚合信号：

| 信号 | 规则 |
|---|---|
| A. 实质性内容量 | 用户侧 ≥3 条 >20 字且非闲聊（非 `chatDistill` 的 decision/todo 关键词、非问候） |
| B. 追问停滞 | 角色已连续追问 ≥5 轮，用户回复变短（<15 字）或重复 |
| C. 主题聚拢 | 近 20 条中实体词（≥2 字专有名词/人物/主题词）重复出现 ≥3 次 |

- 触发：`A 且 (B 或 C)` → 生成 `suggest_draft` 提议。
- 防打扰：冷却 10 分钟 + 去重（同一主题只提议一次），复用 `SignalQueue`。
- 可选增强（二期）：把最近对话交 LLM 判断"是否足够成文"（精确但慢），规则不达标时启用。

### 4.3 成文提议信号

- 第一版**复用** `live2d_signal`：`mood=curious` + `bubbleText="要不要我把刚才聊的整理成一篇文章？"`，角色语音朗读（TTS）。
- 预留新指令 `suggest_draft`（`AgentUICommand` 扩展）：`{ topic, outline?, message, priority }`，供后续接画布/面板。

### 4.4 整理成文动作

1. 用户同意 → 调 LLM：输入 = 最近对话（含角色引导的骨架）+ 成文指令 → 输出 Markdown 文章 + 标题。
2. **复用写回预览机制**：生成"新笔记预览卡"（标题 + 正文可编辑）→ 用户确认。
3. 确认 → `note.create` 落成新笔记（分类默认"未分类"，标题由 LLM 或用户定）。
4. 成功后：角色语音朗读开头（短文全读）、情绪 `excited`；失败降级提示（未配置供应商等）。

### 4.5 情绪 / 语音联动

- 提议成文：`curious`；成文成功：`excited`；用户卡壳：`worried`（已有焦虑关怀）。
- 语音跟随情绪语速（`EMOTION_SPEED_ADJUST`）。
- 口型联动见 §5.3。

## 5. 语音系统设计（VibeVoice 接入）

### 5.1 模型评估（RTX 4060 8GB）

| 模型 | 规模 | 能力 | 4060 可行性 |
|---|---|---|---|
| TTS-1.5B | 骨干 Qwen2.5-1.5B，总 ~3B | 7.5Hz tokenizer，64K 上下文，单次最长 90 分钟，最多 4 说话人，24kHz WAV | ✅ q4 ~4.7GB（长文朗读用） |
| Realtime-0.5B | ~0.5B | 流式 TTS，首包 ~300ms | ✅ ~2GB（实时对话用） |
| ASR | ~7-9B | 60 分钟、说话人分离、时间戳、50+ 语言 | ⚠️ 8GB 太紧，不落地 |

部署：官方 Python 版 + 社区 OpenAI 兼容服务（如 `vibevoice-realtime-openai-api`，支持 Docker），标准 `POST /v1/audio/speech`。模型优先 `4bit/nf4/q4` 量化版。

### 5.2 接入方式（分两步）

**第一步：零代码接线（立即见效）**

现有 `synthesizeOpenAI`（`ttsClient.ts`）已实现 `POST {apiUrl}/audio/speech`（body `{model, voice, input, speed}`），与 VibeVoice 服务同构：

1. 部署 VibeVoice（先 0.5B 验证，后 1.5B q4）+ OpenAI 兼容服务。
2. Elysia 面板 → TTS Tab → 引擎"OpenAI TTS (云端)" → `apiUrl` 填本地（如 `http://127.0.0.1:8880/v1`）→ `voice` 填说话人标识。
3. `SidebarChat` 自动朗读、角色对话语音立即生效。

**第二步：新增 `vibevoice` 专用引擎（体验增强）**

- `types.ts`：`TTSEngineKey` 增 `"vibevoice"`，`TTS_ENGINE_OPTIONS` 增标签。
- `ttsClient.ts`：`synthesizeVibeVoice`（复用 OpenAI 端点，可加音色列表拉取）。
- `ElysiaPage.tsx`：TTS Tab 增选项与提示。

### 5.3 口型联动（体验核心）

**方案 C1 音量包络驱动（推荐）**：

1. 改造 `speakText` 播放链路：`AudioContext + createMediaElementSource(audio) + AnalyserNode` 替代裸 `new Audio(url).play()`。
2. `requestAnimationFrame` 中 `getByteTimeDomainData` 计算 RMS。
3. RMS 经低通平滑 + 阈值 + attack/release 包络 → `setMouthValue(0~1)`；播放结束复位 0。

注意：

- `source.connect(analyser).connect(ctx.destination)`（MediaElementSource 改路由）。
- `createMediaElementSource` 单例限制：一个元素只能绑定一次，需模块级单例复用。
- WebView2 自动播放：用户交互后 `ctx.resume()`。
- 参数建议：RMS 阈值 ~0.02，attack ~30ms，release ~120ms，mouthValue 上限 ~0.9。

**C2 音节级 lipsync**：VibeVoice 为 7.5Hz 低帧率 tokenizer，理论可精确对口型，但社区服务未统一暴露对齐结果，第一版不做。

### 5.4 朗读整篇笔记（1.5B 长文本）

"朗读当前笔记"入口（编辑器工具栏/右键菜单）：VibeVoice-1.5B q4 单次合成 → 复用 `speakText` + 口型联动。长文本请求需超时/loading；超长按段落切分合成队列。

## 6. 技术架构

```
┌─────────────── 前端（Tauri WebView2） ───────────────┐
│  Live2D 伴侣层：情绪表演(Soullink) + 人设 + 口型        │
│        ↑  live2d_signal / setMouthValue               │
│  Agent 信号层：SignalQueue（冷却/去重/优先级）           │
│        ↑  AgentUICommand（live2d_signal / suggest_draft）│
│  对话层：SidebarChat 引擎（角色模式 / 功能模式）          │
│        ↑  LLM / Agent 工具（note.* / web.search）      │
│  TTS 层：speakText → synthesizeWithConfig → 播放+口型  │
└───────────────────────────────────────────────────────┘
                  ↓ HTTP (127.0.0.1)
┌─────────────── 本地服务（外部部署） ───────────────────┐
│  VibeVoice (0.5B / 1.5B q4) + OpenAI 兼容 API          │
│  LLM 供应商（DeepSeek 等，云端或本地）                  │
└───────────────────────────────────────────────────────┘
```

## 7. 实施路径

| 阶段 | 内容 | 改动量 |
|---|---|---|
| Phase 0 | 部署 VibeVoice（0.5B 先验，1.5B q4 跟进）+ OpenAI 兼容服务 | 无（外部） |
| Phase 1 | 方案 A 接线：TTS 配置指向本地 VibeVoice，验证角色配音 | 0 代码 |
| Phase 2 | 口型联动：`ttsService.ts` 播放链路改 Web Audio + Live2D `setMouthValue` 驱动 | 小（核心体验） |
| Phase 3 | 角色对话模式：引导型 prompt 切换 + 收敛检测（规则）+ 成文提议（live2d_signal）+ 成文动作（预览 → note.create） | 中（核心功能） |
| Phase 4 | 增强：`vibevoice` 专用引擎、朗读整篇笔记、`suggest_draft` 指令、LLM 收敛判断 | 中 |
| Phase 5 | 未来：VibeVoice-ASR（显存升级后）、独立角色窗口 | 大（另立文档） |

## 8. 风险与注意事项

1. **WebView2 自动播放**：`AudioContext` 需用户手势后 `resume()`，播放失败静默兜底。
2. **MediaElementSource 单例**：模块级单例复用，避免重复绑定。
3. **CORS**：沿用现有 `fetch` 本地端点链路（GPT-SoVITS 已验证可行）。
4. **VibeVoice 许可**：MIT；官方曾因语音克隆下架，恢复后带 AI 水印/提示音 safeguard，商用前确认合规。
5. **量化**：1.5B 用 q4/nf4 压到 ~4.7GB；8GB 卡单请求串行，避免并发 OOM。
6. **引导不打扰**：收敛检测防打扰（冷却 10 分钟 + 主题去重）；成文必须用户确认，不自动落盘。
7. **LLM 依赖**：角色对话与成文依赖供应商配置（现有设置页）；未配置时降级为纯气泡人设台词。
8. **角色 vs 功能助手边界**：角色模式默认只读工具，避免工具确认弹窗打断人设感。

## 9. 代码改动清单

| 文件 | 阶段 | 改动 |
|---|---|---|
| `src/features/tts/ttsService.ts` | P2 | 播放链路改 Web Audio + AnalyserNode，导出口型信号（RMS）与停止逻辑 |
| `src/features/live2d/modelController.ts` / `officialController.ts` | P2 | 口型信号接入（外层写 `setMouthValue`） |
| `src/features/live2d/Live2DCompanionLayer.tsx` | P2 | 订阅播放状态，把 RMS 路由到当前模型 controller |
| `src/features/sidebarChat/SidebarChat.tsx` | P3 | 角色对话模式（prompt 切换）、成文预览卡、确认 → `note.create` |
| `src/features/sidebarChat/prompts.ts`（新增） | P3 | 引导型角色 prompt（按 PERSONA 角色拼接） |
| `src/features/agent/`（新增收敛检测模块） | P3 | 主题收敛规则检测（借鉴 chatDistill 范式） |
| `src/features/agent/signalQueue.ts` | P3/P4 | 预留 `suggest_draft` 指令；成文提议复用 `live2d_signal` |
| `src/features/tts/types.ts` / `ttsClient.ts` | P4 | 新增 `vibevoice` 引擎、`synthesizeVibeVoice` |
| `src/components/ElysiaPage.tsx` | P4 | TTS Tab 增引擎选项；角色模式入口 |
| 编辑器工具栏 / 右键菜单 | P4 | "朗读当前笔记"（1.5B 长文本） |
