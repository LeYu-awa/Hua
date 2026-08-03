# PRD：Soullink 本地 Live2D 情绪表演集成

## 1. 背景

floral-notepaper 已具备 Live2D 伴侣层，当前通过 `@naari3/pixi-live2d-display/cubism5` 加载本地 Haru、Hiyori、水瓶座之恋等模型，并通过 `live2d_signal` 切换表情、动作和气泡文案。

Soullink Emotion SDK 提供框架无关的本地情绪表演引擎，可将离散情绪或连续 VAD 状态转换为 FACS/AU、头部/身体动作、呼吸、眨眼、口型和 Live2D 参数。当前阶段采用“纯本地优先”，不接入 `planner-openai`、`classifier-embedding` 或远程 API。

## 2. 目标

- 在本机完成 Live2D 情绪表演增强，不依赖外部服务、不需要 API Key、不上传模型资产。
- 复用 floral-notepaper 现有 Live2D 渲染、配置、模型选择和 `live2d_signal` 机制。
- 将现有 `happy / neutral / sleepy / excited / worried / curious` 信号映射为 Soullink VAD 情绪状态。
- 对模型参数做安全适配：模型缺少某个参数时跳过，不影响加载和渲染。
- 保留现有表情文件和动作组播放能力，Soullink 作为持续微表演层叠加在现有动作上。

## 3. 非目标

- 不接 OpenAI-compatible Planner。
- 不接 Embedding 情绪分类服务。
- 不接远程 Soullink API。
- 不实现 TTS 或真实音频口型。
- 不替换现有 Pixi/Cubism5 渲染链路。

## 4. 用户故事

- 作为用户，我打开应用后，Live2D 角色能在待机状态下自然呼吸、眨眼、轻微摆动。
- 作为用户，当 Agent 发出情绪信号时，角色能出现更连续、更自然的情绪变化，而不是只切一次表情。
- 作为用户，我可以继续使用当前内置 Live2D 模型，且模型资源只在本地项目中加载。

## 5. 功能需求

### 5.1 本地情绪引擎

- 新增本地 Soullink adapter，封装：
  - 情绪到 VAD 的映射；
  - 每帧参数计算；
  - Live2D 参数写入；
  - 缺失参数跳过；
  - 启停生命周期。

### 5.2 模型参数适配

- 读取当前 Live2D coreModel 的参数 ID。
- 支持常见 Cubism 参数：
  - `ParamAngleX/Y/Z`
  - `ParamBodyAngleX/Y/Z`
  - `ParamEyeLOpen / ParamEyeROpen`
  - `ParamEyeBallX / ParamEyeBallY`
  - `ParamMouthOpenY / ParamMouthForm`
  - `ParamBrow*`
  - `ParamBreath`
- 对 Haru/Hiyori/Aquarius 采用同一套安全映射，后续可扩展为模型专属 profile。

### 5.3 信号接入

- 修改 `signalBridge`：在原有 `setExpression` / `playMotion` / bubble 的基础上，额外触发本地情绪引擎。
- 情绪映射：
  - `happy` → positive / medium arousal
  - `neutral` → neutral / calm
  - `sleepy` → low arousal
  - `excited` → high valence / high arousal
  - `worried` → negative valence / medium-high arousal / low dominance
  - `curious` → mild positive / medium arousal

### 5.4 生命周期

- 模型加载成功后启动本地表演引擎。
- 模型卸载、组件销毁时停止引擎并释放 ticker hook。
- 切换模型时重建参数索引。

## 6. 技术方案

- 新增 `src/features/live2d/soullinkLocalEngine.ts`：本地 adapter。
- 扩展 `Live2DModelController` 接口：增加 `triggerEmotion(mood, intensity?)`。
- 在 `modelController.ts` 的 runtime loop 中调用 adapter tick，并叠加到 coreModel 参数。
- 在 `signalBridge.ts` 处理 `live2d_signal` 时调用 `controller.triggerEmotion(...)`。
- 如 SDK 包 API 与项目依赖冲突，采用轻量本地 adapter 先兼容，后续再替换为官方 engine 调用。

## 7. 验收标准

- `npm run build` 或 TypeScript 检查通过。
- 应用仍能加载 Haru/Hiyori/Aquarius Live2D 模型。
- Agent 情绪信号能触发持续表情/动作变化。
- 不新增外部 API 配置，不引入前端密钥。
- 模型缺失参数时无运行时崩溃。
