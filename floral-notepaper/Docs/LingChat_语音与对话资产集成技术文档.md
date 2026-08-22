# LingChat 语音与对话资产集成技术文档（花笺项目）

> 版本：v1.0 ｜ 日期：2026-08-22 ｜ 适用项目：`floral-notepaper`（花笺）
> 本档基于对源项目 `LingChat`（Tauri 2 + Vue 3 + Rust）语音/对话/桌宠子系统的资产核查，是后续功能集成（语音下载、流式对话、情绪表情、桌宠模式）的技术基线。

---

## 一、文档目的与范围

1. 全量核查已下载/已缓存的资产（推理包、日语语音模型、情绪模型、词典），明确其功能定位、版本、依赖与授权。
2. 定义资产在花笺项目中的存储路径规范与环境依赖。
3. 输出资产调用的前置条件、接口参数与错误处理逻辑。
4. 输出资产集成到花笺项目的兼容性验证报告与集成路线图。

---

## 二、已下载资产全量核查

### 2.1 推理包（Rust 代码库，源码形式）

#### 2.1.1 `sbv2-api`（Style-Bert-VITS2 推理引擎）

| 项 | 值 |
|---|---|
| 仓库 | `neodyland/sbv2-api`（本地镜像：`D:\花箴\Aigalgame\sbv2-api-local`） |
| 版本 | `0.2.0`（workspace：`sbv2_api` / `sbv2_core` / `sbv2_bindings` / `sbv2_wasm`） |
| License | MIT |
| 定位 | SBV2（Style-Bert-VITS2）语音合成**推理库**，将文本 → 日语语音 WAV |
| 核心依赖 | `ort =2.0.0-rc.13`（ONNX Runtime）、`jpreprocess 0.13.2`（naist-jdic）、`tokenizers 0.22.2`、`ndarray 0.17.1`、`hound 3.5.1`（WAV 输出）、`tar + zstd`（模型包解压）、`regex / serde / npyz` |
| 硬件适配 | feature 矩阵：`std`（CPU）、`cuda`、`cuda_tf32`、`directml`（Windows GPU）、`tensorrt`、`coreml`（macOS）、`webgpu`。花笺 Windows 集成建议 `std`（CPU 通用）或 `directml`（GPU 加速） |
| 集成方式 | LingChat 以 `sbv2_core = { git = "file:///D:/花箴/Aigalgame/sbv2-api-local", default-features = false, features = ["std"] }` 引用 |

#### 2.1.2 `jpreprocess`（日语文本预处理 / 分词）

| 项 | 值 |
|---|---|
| 仓库 | `jpreprocess/jpreprocess`（本地镜像：`D:\花箴\Aigalgame\jpreprocess-local`） |
| 版本 | `0.13.2`（OpenJTalk 的 Rust 重写） |
| License | BSD-3-Clause |
| 定位 | 日语分词、NJD 形态素分析、音素序列生成（TTS 前置文本处理） |
| 核心依赖 | `lindera ~1.4.1`、`yada 0.5.1`（双数组字典）、`encoding_rs`、`jpreprocess-naist-jdic 0.13.2`（词典 crate） |
| 硬件适配 | 纯 CPU |
| 集成方式 | 因 registry 版 `build.rs` 无词典缓存（下载超时问题），LingChat 通过 `[patch]` 用本地 git 版替换：`jpreprocess-naist-jdic = { git = "file:///D:/花箴/Aigalgame/jpreprocess-local", branch = "main" }` |

#### 2.1.3 `ort`（ONNX Runtime）

| 项 | 值 |
|---|---|
| 版本 | `=2.0.0-rc.13`（锁定） |
| 定位 | SBV2 与 DeBERTa 模型推理运行时 |
| 集成方式 | `ort = { version = "=2.0.0-rc.13", default-features = false, features = ["std", "ndarray", "download-binaries"] }`；Windows GPU 时换 `features = ["directml"]` |
| 注意 | `download-binaries` 会在构建期自动拉取 ONNX Runtime 动态库 |

#### 2.1.4 `esaxx-rs`（本地 patch）

| 项 | 值 |
|---|---|
| 问题 | tokenizers 的 `esaxx` 依赖默认静态 CRT（/MT），Windows 下与 `ort` 等动态 CRT 库冲突（LNK2038/LNK2005） |
| 修复 | 本地 patch 移除 `.static_crt(true)`，以 path 补丁替换 crates.io 版本 |

### 2.2 日语语音合成资产（ModelScope，已下载落盘）

#### 2.2.1 `DeBERTa.onnx`（日语语义编码器）

| 项 | 值 |
|---|---|
| 仓库 | `lingchat-research-studio/DeBERTa.onnx`（搬运自 `ku-nlp/deberta-v3-base-japanese`，已转 ONNX + int8 量化） |
| 文件 | `deberta.onnx`（397,409,158 B，LFS）、`tokenizer.json`（430,981 B）、`configuration.json`（45 B）、`README.md` |
| 定位 | **语音合成管线的文本编码器**（非语音识别）：将日语文本/音素编码为语义向量，供 SBV2 合成器条件生成。属"多语言/语义适配组件" |
| 授权 | 仓库未标注 LICENSE（需追溯 ku-nlp 原始授权） |
| 调用依赖 | ONNX Runtime（ort） |

#### 2.2.2 `sbv2api-model-Ling-v2-onnx`（日语 TTS 音色包）

| 项 | 值 |
|---|---|
| 仓库 | `lingchat-research-studio/sbv2api-model-Ling-v2-onnx` |
| 文件 | `sbv2api-model-Ling-v2-onnx.onnx`（249,408,679 B，LFS）、`style_vectors.json`（7,126 B）、`configuration.json` |
| 定位 | **语音合成音色包（voice）**：SBV2 合成器主模型（Ling v2 日语女声），`style_vectors.json` 为内嵌风格向量（SBV2 `.sbv2` 式音色，无需额外 style 目录） |
| 授权 | **Apache License 2.0**（README 元数据标注） |
| 任务类型 | text-to-speech |
| 调用依赖 | ONNX Runtime + DeBERTa 编码器 + jpreprocess 分词 |

### 2.3 情绪分类模型（未下载，待补）

| 项 | 值 |
|---|---|
| 仓库 | `lingchat-research-studio/Emotion_model_19emo_small_onnx` |
| 文件 | 7 个：`config.json`、`label_mapping.json`、`model.onnx`（int8 o2 量化）、`special_tokens_map.json`、`tokenizer.json`、`tokenizer_config.json`、`vocab.txt` |
| 定位 | 19 类情绪文本分类器（BERT 架构 ONNX），用于将 LLM 回复中的情绪标签归一化预测 |
| 状态 | `data/third_party/emotion_model_19emo/` 目前仅 `.gitkeep`，**尚未下载**；下载脚本 `LingChat/scripts/download_emotion_model.mjs`（含 SHA-256 一致性校验） |

### 2.4 词典缓存（本地缓存）

| 项 | 值 |
|---|---|
| NAIST-JDic | 8 个文件（`metadata.json` / `char_def.bin` / `matrix.mtx` / `dict.da` / `dict.vals` / `unk.bin` / `dict.wordsidx` / `dict.words`），缓存于 `%USERPROFILE%\.cache\jpreprocess\dict` |
| 用途 | jpreprocess 形态素分析词典；registry 版 build.rs 无缓存检测，git 版有，故用 git 版 |

---

## 三、存储路径规范

> 花笺开发模式 data 根目录 = `D:\花箴\floral-notepaper\data`（`resolve_data_dir`：debug 用项目根 `data/`，release portable 用 exe 旁 `data/`）。

```
data/
├── models/
│   └── tts-local/                  # 本地 TTS 资产根
│       ├── assets/
│       │   └── deberta/            # 共享 BERT 资产（跨音色复用）
│       │       ├── deberta.onnx
│       │       └── tokenizer.json
│       └── voices/
│           └── ling-v2/            # 每个音色一个子目录
│               ├── model.onnx
│               └── style_vectors.json
└── third_party/
    └── emotion_model_19emo/        # 情绪分类模型（待下载）
        ├── model.onnx
        ├── tokenizer.json
        ├── vocab.txt
        └── ...
```

- 下载临时文件位于 `app_cache_dir/tts-local-cache/`（不属于永久模型目录）。
- 语音导入/解包一律先落临时文件，校验通过后原子安装进 `voices/`。

---

## 四、环境依赖与硬件要求

| 依赖 | 最低要求 | 推荐 |
|---|---|---|
| 推理后端 | ONNX Runtime CPU（`std`） | Windows GPU：`directml` |
| 内存 | ≥ 4 GB 可用 | ≥ 8 GB |
| 显存（GPU 推理） | — | ≥ 2 GB（DeBERTa int8 397MB + Ling-v2 238MB 常驻） |
| Rust 工具链 | 1.88+（jpreprocess 要求） | stable 最新 |
| 网络 | 构建期可访问 rsproxy.cn / crates.io 镜像 | — |
| 首次运行 | 需下载 4 个模型文件（约 640MB 落盘） | — |

> 注意：`ort =2.0.0-rc.13` 与 `esaxx-rs` 在 Windows 的 CRT 冲突必须通过 path patch 规避，否则链接失败（LNK2005/LNK1169）。

---

## 五、资产调用链路（SBV2 语音合成）

```
文本 ──▶ jpreprocess（分词/NJD/音素） ──▶ DeBERTa（语义编码 int8）
        ──▶ SBV2 合成器（Ling-v2.onnx + style_vectors） ──▶ WAV（hound 写出）
```

- 引擎加载：DeBERTa 全套就位 → `engine.init()`；语音按需 `load_voice(voice_id)`。
- 角色侧：`tts_type: localsbv2api` + `sbv2_local_voice_id: ling-v2` 即启用本地合成。

---

## 六、前置条件与接口说明（复刻自 LingChat 下载方案）

### 6.1 前置条件

1. 资产目录可创建（`data/models/tts-local/`、`assets/`、`voices/`）。
2. 应用持有 Tauri `AppHandle`（store / emit / path 能力）。
3. 首次使用前完成 4 个模型文件下载（deberta + tokenizer + ling-v2 + style_vectors）。

### 6.2 Tauri 命令（Rust → 前端 invoke）

| 命令 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `tts_local_list_catalog` | — | `AssetEntry[]` | 目录（隐藏被捆绑子资产） |
| `tts_local_list_installed` | — | 已安装资产 | 含 `installed_voice_count` |
| `tts_local_download` | `asset_id: string` | `()` | 下载主资产 + 捆绑资产，完成后 `engine.init()` 并 emit `tts://download-complete` |
| `tts_local_import_from_path` | 路径 | `()` | 本地文件导入，emit `tts://install-complete` |
| `tts_local_delete_voice` | `voice_id` | `()` | 删除 `voices/<id>`，带路径穿越校验 |
| `tts_local_import_style_vectors` | `voice_id, jsonPath` | `()` | 导入风格向量 |
| `tts_local_set_enabled` | `enabled: bool` | `()` | 持久化开关键；关闭时 `engine.unload_all()` |
| `tts_local_set_device` | `device` | `()` | 热切换推理设备（DirectML 等） |
| `tts_local_synthesize_preview` | 文本 | WAV 字节 | 合成预览 |

### 6.3 事件（Rust → 前端）

| 事件 | payload | 触发时机 |
|---|---|---|
| `tts://download-progress` | `{ asset_id, bytes_done, total_bytes, percent }` | 下载中（200ms / 1MB 节流） |
| `tts://download-complete` | `asset_id` | 主资产（含捆绑）完成 |
| `tts://install-complete` | — | 导入/安装完成 |
| `tts://status-changed` | — | 启用状态变化 |

### 6.4 断点续传的如实说明

LingChat 下载方案**并非 HTTP Range 断点续传**，而是：`.part` 临时文件 + 进度回调节流 + 取消令牌（`CancellationToken`）+ 完成后原子 `rename`。失败/取消会清理 `.part`。花笺落地时沿用该语义（可取消、可重试、无损坏半成品）。

---

## 七、错误处理逻辑

| 场景 | 处理 |
|---|---|
| 网络中断 / HTTP 错误 | 删除 `.part`，下次重试全量重新下载 |
| 用户取消 | 通过取消令牌中止，清理临时文件 |
| 目录穿越（导入路径） | canonical path 校验，拒绝 `../` 逃逸 |
| 模型缺失 | 启动时 `setup` 检测资产缺失 → `skip preload` 并停用本地 TTS（不阻断应用） |
| 路径不可创建 | 弹错误对话框，本次启动停用本地 TTS |
| 语音 ID 非法（空格/中文/斜杠） | 安装前校验，拒绝 |
| 情绪模型缺失 | 分类器 passthrough（不阻断对话） |

---

## 八、兼容性验证报告

### 8.1 已验证（LingChat 侧，2026-08-22）

| 项 | 结果 |
|---|---|
| `cargo build`（Windows） | 通过（6m07s），无 LNK 错误 |
| `.part` 原子安装链路 | 通过（含 `tar + zstd` 解包） |
| NAIST-JDic 离线缓存 | 通过（git 版 build.rs 缓存检测） |
| 4 个模型文件下载 | 完成，SHA/大小与 ModelScope 仓库一致 |
| `ort` 2.0.0-rc.13 + esaxx-rs patch | 通过（CRT 冲突已规避） |

### 8.2 花笺项目集成兼容性

| 维度 | 结论 |
|---|---|
| 后端框架 | 同为 Tauri 2 + Rust，`sbv2_core` / `ort` / `jpreprocess` 依赖可整体加入 `floral-notepaper/src-tauri/Cargo.toml`，无框架冲突 |
| 前端框架 | LingChat 为 Vue 3 + Element Plus，花笺为 React 19 + Zustand → 下载 UI、进度条、事件订阅需**用 React 重写**（复用协议与状态机，不复用组件） |
| 依赖版本 | 花笺 Rust 侧需新增 `sbv2_core`、`ort`、`jpreprocess`、`tokenizers` 及 `[patch]`（esaxx-rs、jpreprocess-naist-jdic），与现有 `reqwest/rusqlite/rmcp` 无冲突预期 |
| 存储机制 | 花笺已有 `localStorage` + SQLite 持久化；TTS 配置键（`elysia_tts_config`）与下载状态需新增对应持久化 |
| 事件机制 | Tauri `emit/listen` 通用，直接复用事件名与 payload 结构 |
| 风险点 | ① `ort` 构建拉取二进制需网络；② 词典缓存需沿用 git 版 jpreprocess；③ DeBERTa 仓库无 LICENSE 需规避商用风险；④ 首次构建时间显著增加 |

---

## 九、集成路线图（花笺项目）

| 阶段 | 内容 | 产出 |
|---|---|---|
| 1. 资产核查（本档） | 完成 | 本技术文档 |
| 2. 语音下载集成 | Rust 下载命令 + 事件 + 依赖锁版（`sbv2_core`/`ort`/`jpreprocess`/patch）；React 下载 UI（进度/取消/持久化） | 花笺内可点击下载 ling-v2 + deberta |
| 3. 对话模式 | DeepSeek 流式改造（token 级渲染）+ 情绪标签协议迁移 | 花笺聊天流式输出 + 情绪数据 |
| 4. 情绪表情 | 情绪 → 表情映射算法 + 素材归档接入 Live2D | 回复情绪触发 Live2D 表情切换 |
| 5. 桌宠模式 | 透明置顶悬浮窗 + 点击穿透 + 拖拽 + 持久化，对接花笺 Live2D | 花笺桌宠完整可用 |

---

## 附录 A：模型文件 SHA-256（ModelScope 仓库官方值）

| 文件 | SHA-256 |
|---|---|
| `deberta.onnx` | `4b54f7f30d24aa0956063ac833ebed784eb16c9fa2a5d1fd26ae2a570664f4f1` |
| `tokenizer.json` | `21a17e4d0032739e82dc60f155b4ae37e94519103e0d399657fdd249ec3e7905` |
| `sbv2api-model-Ling-v2-onnx.onnx` | `15926d8e9e51fc8e35136cb72b5fbd5b4d3d4c2c31c918d22e9afcb5d572a40b` |
| `style_vectors.json` | `66cd7d4c518350dabe2652e8410840b0468253f8872deb7b695c029943e61863` |
