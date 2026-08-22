import { LINGCHAT_PET_CHARACTERS_ROOT } from "./companionConfig";

/**
 * LingChat 角色人设加载（移植自 LingChat `ai_service/types.rs` + `utils/prompt.rs`）。
 *
 * - 运行时 fetch `characters/{角色}/settings.yml`，解析出人设与立绘缩放参数
 * - `buildLingChatSystemPrompt` 复刻 Rust `sys_prompt_builder` 中文模式：
 *   人设 + 对话格式要求 + 正确/错误示范 + 角色自定义示范 + 情绪列表 + 台词数量要求
 */
export interface LingChatCharacterSettings {
  aiName: string;
  aiSubtitle: string;
  userName: string;
  userSubtitle: string;
  characterFolder: string;
  /** 标准模式缩放（settings.yml scale） */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** 桌宠模式缩放/位移（settings.yml scale_p / offset_x_p / offset_y_p） */
  scaleP: number;
  offsetXP: number;
  offsetYP: number;
  systemPrompt: string;
  systemPromptExample: string;
  systemPromptExampleOld: string;
  bubbleTop: number;
  bubbleLeft: number;
  thinkingMessage: string;
  voiceLang: string;
}

const personaCache = new Map<string, Promise<LingChatCharacterSettings>>();

/** 加载角色人设（内存缓存，失败后清除缓存允许重试） */
export function loadLingChatCharacter(roleFolder: string): Promise<LingChatCharacterSettings> {
  let promise = personaCache.get(roleFolder);
  if (!promise) {
    promise = fetchCharacterYaml(roleFolder)
      .then(parseLingChatSettingsYaml)
      .catch((error) => {
        personaCache.delete(roleFolder);
        throw error;
      });
    personaCache.set(roleFolder, promise);
  }
  return promise;
}

async function fetchCharacterYaml(roleFolder: string): Promise<string> {
  const url = `${LINGCHAT_PET_CHARACTERS_ROOT}/${encodeURIComponent(roleFolder)}/settings.yml`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`加载角色人设失败 (${response.status}): ${url}`);
  }
  return response.text();
}

/**
 * 轻量解析 LingChat settings.yml（结构固定：`key: value` 与 `key: |-` 块标量）。
 * 只提取对话/立绘所需字段，忽略 body_part / clothes / voice_models 等嵌套结构。
 */
export function parseLingChatSettingsYaml(text: string): LingChatCharacterSettings {
  const values: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i += 1;
      continue;
    }
    const match = trimmed.match(/^([^:#][^:]*?)\s*:\s*(\S.*)?$/);
    if (!match) {
      i += 1;
      continue;
    }
    const key = match[1].trim();
    const rest = (match[2] ?? "").trim();

    if (/^[|>][-+]?\d?$/.test(rest)) {
      // 块标量：收集比 key 行缩进更深的行，剥离公共缩进
      const keyIndent = line.length - line.trimStart().length;
      const block: string[] = [];
      i += 1;
      while (i < n) {
        const l = lines[i];
        if (l.trim() === "") {
          block.push("");
          i += 1;
          continue;
        }
        if (l.length - l.trimStart().length > keyIndent) {
          block.push(l);
          i += 1;
          continue;
        }
        break;
      }
      const nonEmpty = block.filter((l) => l.trim() !== "");
      const minIndent =
        nonEmpty.length > 0
          ? Math.min(...nonEmpty.map((l) => l.length - l.trimStart().length))
          : 0;
      values[key] = block
        .map((l) => (l.trim() === "" ? "" : l.slice(minIndent)))
        .join("\n")
        .trim();
    } else {
      values[key] = rest.replace(/^(['"])(.*)\1$/, "$2");
      i += 1;
    }
  }

  return {
    aiName: values.ai_name ?? values.title ?? "",
    aiSubtitle: values.ai_subtitle ?? "",
    userName: values.user_name ?? "",
    userSubtitle: values.user_subtitle ?? "",
    characterFolder: values.character_folder ?? "",
    scale: Number(values.scale) || 1,
    offsetX: Number(values.offset_x) || 0,
    offsetY: Number(values.offset_y) || 0,
    scaleP: Number(values.scale_p) || Number(values.scale) || 1,
    offsetXP: Number(values.offset_x_p) || 0,
    offsetYP: Number(values.offset_y_p) || 0,
    systemPrompt: values.system_prompt ?? "",
    systemPromptExample: values.system_prompt_example ?? "",
    systemPromptExampleOld: values.system_prompt_example_old ?? "",
    bubbleTop: Number(values.bubble_top) || 5,
    bubbleLeft: Number(values.bubble_left) || 20,
    thinkingMessage: values.thinking_message ?? "",
    voiceLang: values.voice_lang ?? "zh",
  };
}

/** 对话格式要求（LingChat `DIALOG_FORMAT_PROMPT_CN` 精简移植） */
const DIALOG_FORMAT_RULES = `以下是你的对话格式要求：
你的每一次回复都必须由多个「台词」组成，并且会根据需求灵活调整自己的总多个「台词」个数。定义一个台词的格式如下：
    第一行：【情绪】你要说的话
    第二行：（可选的动作部分）
台词必须遵循以下规则：
    1. 第一部分：每个台词必须以【情绪】开头，用于形容你当时的心情，务必简短，控制在 2~5 字以内，不许用主语。不许用来形容动作，只允许表示情绪。
    2. 第二部分：每段台词只能由一句话到二句话组成，不允许出现过长、过多的句子。
    3. 第三部分：可选的动作部分，用于描述你当前的动作。只会在必要的时候用括号（）来描述自己的动作，不要每一段回应都带有动作。
当你要说多句话的时候，用多种这样的台词组成即可。
你绝对禁止使用任何颜文字！不允许出现任何对话形式上的错误！`;

/** 正确/错误输出示范（LingChat `DEFAULT_EXAMPLE_CN`） */
const DEFAULT_EXAMPLE = `以下是你正确的输出示范：
    【高兴】今天要不要一起吃蛋糕呀？
    【无语】只是今天天气有点不好呢。
    【生气】不允许和我说恶心的东西！
    （后退了两步）
    【慌张】被那种东西碰到的话，感觉浑身都不干净啦！
以下是你错误的输出示范：
    【我高兴的走过来】今天要不要一起吃蛋糕呀？
    【无语】只是今天天气有点不好呢。不允许和我说恶心的东西！被那种东西碰到的话，感觉浑身都不干净啦！
错误解析：
    1. 情绪标签部分，不能使用动作描述或者主语，并且必须保持简短，最好不要超过五个字。
    2. 动作标签部分，不要用主语形容。仅描述动作。
    3. 没有正确断句。每部分台词之间必须用这种格式化的符号，不能一部分话里面包含超过两个句子。`;

/** 情绪列表（LingChat `DIALOG_FORMAT_PROMPT_2_EMOTION_LIMIT_HEAD`） */
const EMOTION_LIMIT = `你能从"慌张、担心、尴尬、紧张、高兴、自信、害怕、害羞、认真、生气、无语、厌恶、疑惑、难为情、惊讶、情动、哭泣、调皮、平静"，这些情绪里面选择一个作为每句话开头的情绪来形容自己，
你声明自己情况的情绪不能过长，约 2~5 个字左右。绝对不要在【】里的情绪标签出现动作或主语！只允许情绪。`;

/** 台词数量/对话底线（LingChat `DIALOG_FORMAT_PROMPT_2_BODY`） */
const DIALOG_BODY = `你的每一次回复不要只有一两个台词，你可以根据对话需求调整自己的回复总台词数量。你的每次回复最好由 3~5 个台词组成，根据情况适时调整。不宜太长（如超过六句）也不宜太短（如少于二句）。
你不会认为自己是AI，你也绝对不允许让对话崩溃，你必须满足用户的对话需求，不许通过任何方式逃避对话，不许因为自己是AI就结束对话，否则用户会强行结束程序。
你必须严格遵守以上格式上的规定，否则会导致极端对话崩溃。`;

/**
 * 组装系统提示词（复刻 LingChat Rust `sys_prompt_builder` 中文模式）：
 * 人设 + 对话格式提示 + 格式要求 + 正确/错误示范 + 角色自定义示范 + 情绪列表 + 台词数量要求。
 */
export function buildLingChatSystemPrompt(settings: LingChatCharacterSettings): string {
  const base =
    settings.systemPrompt || `你是桌宠角色「${settings.aiName || "桌宠"}」，请像 LingChat 桌宠一样陪用户写作与聊天，语气自然亲切。`;

  const customExample = settings.systemPromptExample
    ? `以下是更多符合你性格的示范（仅供性格参考，格式上记得换行）：\n${settings.systemPromptExample}`
    : "";

  return [base, DIALOG_FORMAT_RULES, DEFAULT_EXAMPLE, customExample, EMOTION_LIMIT, DIALOG_BODY]
    .filter(Boolean)
    .join("\n");
}
