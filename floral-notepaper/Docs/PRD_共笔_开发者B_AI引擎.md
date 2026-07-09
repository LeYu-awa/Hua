# 共笔模式 PRD — 开发者 B：AI 引擎 + 应用接入

## 你的职责

负责 AI 续写的全套 Prompt 工程、DeepSeek API 调用封装、场景模板设计、灵感注入、重新生成，以及把共笔功能接入到应用导航系统。

## 功能清单

| 功能                | 状态      |
| ------------------- | --------- |
| 5 种 AI 身份 Prompt | ✅ 已实现 |
| DeepSeek 共笔调用   | ✅ 已实现 |
| 侧边栏入口 + 导航   | ✅ 已实现 |
| 共笔页面样式        | ✅ 已实现 |
| 重新生成            | 🆕 待实现 |
| 场景模板（4 种）    | 🆕 待实现 |
| 灵感注入            | 🆕 待实现 |

---

## 🆕 新增功能详情

### 功能 1：重新生成

当用户对 AI 的最新一段回复不满意时，可以重新生成：

1. 在 AI 段落右侧显示一个"重新生成"图标按钮（hover 时出现）
2. 点击后调用 `regenerateAITurn(session, identity, customPrompt, providers)`
3. 函数内部：复用 `buildCoWriteMessages` 构建消息，但 **在 user 消息末尾追加一行"换一种写法："**
4. 返回新内容后，替换当前 session 的最后一个 AI block（不是追加）
5. 后端：新增 `cowrite_replace_last_ai(sessionId, newText)` 命令

涉及修改：

- `coWriteAI.ts`：新增 `regenerateCoWriteAITurn(...)` 函数
- `coWritePage.tsx` 中 AI 段落加重新生成按钮（这是 B 告诉 A 做的 UI 改动，B 负责 AI 逻辑即可）

### 功能 2：场景模板

预设 4 种共笔场景，每个场景自带 AI 身份预设和开场白：

| 场景     | 图标 | AI 身份 | System Prompt 核心                               | AI 开场白                |
| -------- | ---- | ------- | ------------------------------------------------ | ------------------------ |
| 写信     | ✉️   | 续写者  | "你正在一起写一封书信。保持书信格式，语气真挚。" | "见字如面。最近还好吗？" |
| 故事接龙 | 📖   | 续写者  | "你正在一起编故事。每次写一小段，留下悬念。"     | "那个雨夜，门突然响了。" |
| 辩论     | ⚔️   | 反对者  | "你站在对立面进行辩论。观点鲜明但不攻击。"       | "我不同意你的看法——"     |
| 随笔日记 | 🌿   | 诗意者  | "你在一起写随笔。轻盈、即兴、有生活气息。"       | "今天的天气让人想起……"   |

数据结构：

```typescript
interface CoWriteScenario {
  key: string; // "letter" | "story" | "debate" | "diary"
  label: string;
  icon: string;
  description: string;
  identity: CoWriteIdentity;
  systemPrompt: string;
  openingLine: string; // AI 自动写的第一段
}
```

在新建立会话弹窗中，身份选择之前先展示 4 个场景卡片。选场景后自动填好身份和 prompt，创建会话后自动写入 AI 开场白作为第一段。

### 功能 3：灵感注入

当用户进入一个空会话（没有任何 blocks）时，显示灵感注入区域：

1. 内容区显示"不知道写什么？AI 可以给你一些灵感"
2. 用户点击"获取灵感"按钮
3. 调用 `generateInspirations(noteContent, providers)` → 基于当前笔记内容生成 3 个写作思路建议
4. 展示为 3 张卡片，每张卡片包含"思路标题"和"一句话示例开头"
5. 用户点击某张卡片 → 自动写入 human 第一段为"示例开头"，并触发 AI 续写

API 调用：

```typescript
async function generateInspirations(
  noteContent: string,
  providers: ProviderConfig[],
): Promise<{ title: string; snippet: string }[]>;
```

内部 prompt：

```
基于以下笔记内容，生成 3 个不同方向的写作思路建议。
每个建议包含一个简短标题和一句话的示例开头。
用 JSON 格式返回：[{"title": "...", "snippet": "..."}]

笔记内容：
{noteContent}
```

---

## 需要你维护的文件

### 新建（已完成）

| 文件                                | 说明                      | 状态      |
| ----------------------------------- | ------------------------- | --------- |
| `src/features/cowrite/prompts.ts`   | AI 身份 Prompt + 场景模板 | 需更新 🆕 |
| `src/features/cowrite/coWriteAI.ts` | DeepSeek 调用             | 需更新 🆕 |

### 修改（已完成）

| 文件                            | 改动              | 状态 |
| ------------------------------- | ----------------- | ---- |
| `src/App.tsx`                   | CoWritePage 路由  | ✅   |
| `src/components/AppSidebar.tsx` | 侧边栏入口 + 图标 | ✅   |
| `src/App.css`                   | 共笔样式          | ✅   |

---

## 新增函数

### prompts.ts 新增

```typescript
// 场景模板列表
export const SCENARIO_PRESETS: CoWriteScenario[];

// 根据 key 获取场景
export function getScenario(key: string): CoWriteScenario | undefined;
```

### coWriteAI.ts 新增

```typescript
// 重新生成 AI 回复（替换最后一个 AI block）
async function regenerateCoWriteAITurn(
  session: CoWriteSession,
  identity: CoWriteIdentity,
  customPrompt: string | undefined,
  providers: ProviderConfig[],
): Promise<string>;

// 生成 3 个写作灵感
async function generateInspirations(
  noteContent: string,
  providers: ProviderConfig[],
): Promise<{ title: string; snippet: string }[]>;

// 调整 temperature（原来的 0.8 改为可配置）
async function requestCoWriteAITurn(
  session: CoWriteSession,
  identity: CoWriteIdentity,
  customPrompt: string | undefined,
  providers: ProviderConfig[],
  temperature?: number,
): Promise<string>;
```

## AI Prompt 设计说明

### 5 种身份（不变）

| 身份   | Prompt 核心规则                 |
| ------ | ------------------------------- |
| 续写者 | 写 1-3 句，顺着风格延续，不评价 |
| 追问者 | 只写 1 个问题，精准深挖，不回答 |
| 反对者 | 写 1-2 句反例或质疑，礼貌锐利   |
| 诗意者 | 写 1-2 句诗意的描写，具体有画面 |
| 自定义 | 用户自行输入完整 system prompt  |

### 4 种场景模板（🆕）

| 场景     | AI 身份 | Prompt 特征          |
| -------- | ------- | -------------------- |
| 写信     | 续写者  | 书信格式、真挚语气   |
| 故事接龙 | 续写者  | 每段留悬念、叙事驱动 |
| 辩论     | 反对者  | 观点鲜明、不攻击     |
| 随笔日记 | 诗意者  | 轻盈即兴、生活气息   |

### 上下文传递格式（不变）

```
当前全文（<human> 是人写的，<ai> 是 AI 之前写的，交替标注）：

<human>今天天气真好，我想出去走走。</human>

<ai>阳光穿过树叶的缝隙，在地上画出了斑驳的影子。</ai>

轮到你了，写下一段：
```

### DeepSeek 调用参数

```
model: 当前选中的模型
temperature: 0.8（默认）/ 重新生成时 1.0
max_tokens: 500
stream: false
```

---

## 验收标准

- [ ] 侧边栏有"共笔"入口，图标清晰，点击后进入共笔页面
- [ ] 5 种 AI 身份 Prompt 正常加载，自定义 Prompt 可输入
- [ ] 🆕 4 种场景模板可选，选场景后自动填入身份和开场白
- [ ] 用户点"轮到 AI"后能正常调用 DeepSeek 返回续写内容
- [ ] 🆕 AI 段落可重新生成，返回新内容替换旧内容
- [ ] 🆕 空会话可获取 3 个灵感建议，点击灵感自动写入并触发续写
- [ ] AI 返回的文字以 bamboo 绿色显示，人类文字以墨色显示
- [ ] 页面样式和现有应用风格高度一致
- [ ] 深色模式下样式正常切换
