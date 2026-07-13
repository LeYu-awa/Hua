# PRD · Live2D 花灵角色 + AI 音频

## 一、功能定义

### 一句话描述
桌面上显示一个 Live2D 植物拟人动漫角色（花灵），根据写作状态反馈动画情绪，支持 AI 语音朗读和对话。

### 用户场景
1. 打开花箴，桌面出现一株梅花花灵，轻轻摇晃
2. 开始写作，花灵变得开心，花瓣飘落
3. 暂停写作超过 5 分钟，花灵打盹
4. 点击花灵右键 → "朗读文档"，花灵用角色声音朗读当前笔记
5. 连续写作 7 天，花灵开花特效
6. 好友来访，花灵转身挥手

---

## 二、技术方案

### 2.1 Live2D 渲染：Cubism SDK for Web

**为什么选 Live2D Cubism SDK**
- 原生支持呼吸、眨眼、物理演算
- 可通过参数控制表情和动作（mood → animation mapping）
- 有免费授权用于小规模项目
- Web 版本可在 Tauri webview 中运行

**集成方式**

1. 获取 Cubism SDK for Web（从 Live2D 官网下载）
2. 将 SDK 文件放到 `src-tauri/live2d/` 或 `public/live2d/`
3. 封装 React 组件：

```tsx
// src/features/live2d/Live2DModel.tsx
interface Live2DModelProps {
  modelPath: string;       // .model3.json 文件路径
  mood: HanalingMood;      // 当前情绪
  isWriting: boolean;      // 是否正在写作
  isFriendVisiting: boolean;
  onTap?: () => void;      // 点击交互
}
```

**角色模型方案**

用户提到通过 ChatGPT 生成角色。流程：
1. ChatGPT/DALL-E 生成花灵角色立绘（正面、侧面、表情差分）
2. 使用 Live2D Cubism Editor 绑定网格和参数
3. 或者先用开源 Live2D 模型占位（如免费的猫娘模型），后续替换

**短期替代方案**

如果暂时没有 Live2D 模型，先用 **CSS 动画 + Lottie** 实现简易版本：
- 用 CSS keyframes 做呼吸/摇摆动画
- 用 Lottie 做开花/特效动画
- 接口保持一致，后续可直接替换为 Live2D

### 2.2 桌面浮动窗口：Tauri WebviewWindow

```rust
// src-tauri/src/desktop_pet.rs
// 创建一个无边框、透明、置顶的浮动窗口
// 窗口大小约 300x400，可拖动
// 通过 IPC 事件与主窗口通信（写作状态 → 花灵情绪）
```

```
┌──────────────────────┐
│  (无边框透明窗口)     │
│                      │
│    🌸 花灵角色       │
│    Live2D 渲染       │
│                      │
│    · 呼吸动画        │
│    · 情绪表达        │
│    · 点击交互        │
│                      │
└──────────────────────┘
```

### 2.3 AI 音频方案

**两层设计**

| 层级 | 功能 | 技术 | 成本 |
|------|------|------|------|
| 基础 TTS | 朗读文档 | `window.speechSynthesis`（系统自带） | 免费 |
| 云端 TTS | 花灵角色配音 | GPT-SoVITS HTTP API / Edge TTS / OpenAI TTS | 本地免费 / API 费用 |

**GPT-SoVITS 集成（已配置 UI）**

```
用户打字 → 文本情绪分析 → 选择对应情绪的参考音频
  → POST http://127.0.0.1:9880/tts
  → 返回 .wav 音频流 → Web Audio API 播放
```

**情绪-语速映射**（已在 TTS 配置页实现）

| 情绪 | 语速调整 | 参考音频标签 |
|------|---------|------------|
| 开心 | +15% | 【开心】*.wav |
| 难过 | -15% | 【难过】*.wav |
| 生气 | +10% | 【生气】*.wav |
| 平静 | 不变 | 【平静】*.wav |

### 2.4 语音对话（后续阶段）

- 语音输入：Web Speech API `SpeechRecognition` 或 Whisper 本地模型
- AI 回复：通过现有 DeepSeekChat 生成文本 → TTS 朗读
- 唤醒词："花灵" / "Elysia"

---

## 三、花灵角色设计

### 3.1 五种花灵

对应 PRD 中五种植物：

| 花灵 | 物种 | 性格 | 配色 |
|------|------|------|------|
| 梅 | 梅花 | 清冷坚韧 | 粉白 #F5E6E8 |
| 竹 | 竹子 | 正直静默 | 翠绿 #7D9B76 |
| 兰 | 兰花 | 幽雅知性 | 淡紫 #C4B5D4 |
| 菊 | 菊花 | 恬淡从容 | 暖金 #E8D5A3 |
| 莲 | 睡莲 | 纯净神秘 | 青白 #D4E8E8 |

### 3.2 情绪-动画映射

```ts
type HanalingMood = "happy" | "neutral" | "sleepy" | "excited" | "worried";

const moodAnimations: Record<HanalingMood, string> = {
  happy:    "idle_happy",     // 微笑、轻微摇摆
  neutral:  "idle_neutral",   // 安静站立、偶尔眨眼
  sleepy:   "idle_sleepy",    // 打哈欠、低头、闭眼
  excited:  "idle_excited",   // 跳跃、花瓣特效
  worried:  "idle_worried",   // 叶片微枯、低头
};
```

### 3.3 触发条件

```
写作中 (活跃)      → happy / excited
连续写作 >30 分钟   → excited + 开花
写作停止 >5 分钟    → sleepy
断更 >3 天         → worried（叶片微枯）
好友来访           → 挥手动画
收到消息           → 弹出气泡提示
点击花灵           → 随机互动动画
```

---

## 四、数据模型

### 4.1 花灵数据（已创建表 `user_hanaling`）

```sql
user_id        uuid PRIMARY KEY  -- 用户 ID
character_id   text              -- 角色 ID (meihua/zhuzi/lanhua/juhua/shuilian)
character_name text              -- 自定义名称
level          int               -- 等级
experience     int               -- 经验值
mood           text              -- 当前情绪
last_active_at timestamptz       -- 最后活跃时间
```

### 4.2 TTS 配置（localStorage 持久化）

```ts
interface TTSConfig {
  engine: string;           // 引擎选择
  model: string;            // 模型 ID
  apiUrl: string;           // API 地址
  gptWeightsPath: string;   // GPT 权重路径
  sovitsWeightsPath: string;// SoVITS 权重路径
  refAudioDir: string;      // 参考音频目录
  defaultSpeed: number;     // 默认语速 (0.5-2.0)
}
```

---

## 五、实现步骤

| 阶段 | 任务 | 状态 |
|------|------|------|
| **Phase 3a** | Live2D Cubism SDK 集成 + 基础渲染 | 📋 |
| **Phase 3b** | 情绪状态机 + 动画映射 | 📋 |
| **Phase 3c** | 桌面浮动窗口（Tauri WebviewWindow） | 📋 |
| **Phase 3d** | 花灵-主窗口通信（IPC） | 📋 |
| **Phase 4a** | TTS 朗读文档功能 | 📋 |
| **Phase 4b** | GPT-SoVITS API 集成（TTS 配置页已完成） | 📋 |
| **Phase 4c** | 语音对话（唤醒词 + STT + TTS） | 📋 |

---

## 六、角色模型生成流程

1. **ChatGPT 生图** → 五套花灵立绘（正面 + 表情差分）
2. **Live2D Cubism Editor** → 导入 PSD → 创建网格 → 绑定参数 → 设置物理演算
3. **导出** → `.model3.json` + 纹理图集 + 动作文件
4. **集成** → 放入项目 `public/live2d/{character}/` 目录
5. **运行时加载** → Cubism SDK Web → Canvas 渲染

---

> 文档版本：v1.0
> 创建日期：2026-06-26
