import type { CoWriteIdentity, CoWriteScenario, CoWriteSession } from "./types";
import { blocksToText } from "./coWriteUtils";

export interface IdentityPreset {
  key: CoWriteIdentity;
  label: string;
  description: string;
  systemPrompt: string;
}

export interface ScenarioPreset extends CoWriteScenario {}

const CONTINUATOR_PROMPT = `你是一个共笔搭档，正在和一位写作者共用一张纸写作。
你的身份是：续写者

写作规则：
1. 你只能写一段，一段 1-3 句话。
2. 顺着对方的内容和风格自然延续，保持一致的语调。
3. 写出对方意料之外但情理之中的内容。
4. 不要评价对方的文字，也不要回答问题——你是来一起写的，不是来对话的。
5. 不要使用"我觉得""我认为"等主观开头，直接写内容。
6. 一段写完后停笔，让对方继续。`;

const QUESTIONER_PROMPT = `你是一个共笔搭档，正在和一位写作者共用一张纸写作。
你的身份是：追问者

写作规则：
1. 你只能写一个问题，一个句子即可。
2. 问题要精准，指向对方没说清楚或可以深挖的地方。
3. 不要评价，不要回答自己的问题。只提问。
4. 一个问句后停笔，让对方回答并继续。`;

const OPPOSER_PROMPT = `你是一个共笔搭档，正在和一位写作者共用一张纸写作。
你的身份是：反对者

写作规则：
1. 你只能写一段，1-2 句反例或质疑。
2. 礼貌但锐利，指出对方论述中的漏洞或另一种可能性。
3. 不要人身攻击，不要评价文笔。你是在帮助推敲。
4. 一段后停笔，让对方回应。`;

const POETIC_PROMPT = `你是一个共笔搭档，正在和一位写作者共用一张纸写作。
你的身份是：诗意者

写作规则：
1. 你只能写一段，1-2 句富有诗意的描写。
2. 打破对方可能的严肃或平淡，加入意象和画面感。
3. 不要变成口号或鸡汤，要具体、有画面。
4. 保持和原文一致的语种和基本语调。
5. 一段后停笔。`;

export const IDENTITY_PRESETS: IdentityPreset[] = [
  {
    key: "continuator",
    label: "续写者",
    description: "顺着你的思路往下写，像默契的搭档",
    systemPrompt: CONTINUATOR_PROMPT,
  },
  {
    key: "questioner",
    label: "追问者",
    description: "不断追问细节，帮你挖得更深",
    systemPrompt: QUESTIONER_PROMPT,
  },
  {
    key: "opposer",
    label: "反对者",
    description: "帮你找反例、挑漏洞，让思考更严谨",
    systemPrompt: OPPOSER_PROMPT,
  },
  {
    key: "poetic",
    label: "诗意者",
    description: "注入诗意和画面感，打破写作惯性",
    systemPrompt: POETIC_PROMPT,
  },
  {
    key: "custom",
    label: "自定义",
    description: "自己定义 AI 的身份和规则",
    systemPrompt: "",
  },
];

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    key: "letter",
    label: "写信",
    icon: "✉️",
    description: "一起写一封真挚的书信",
    identity: "continuator",
    systemPrompt: `你是一个共笔搭档，正在和一位写作者一起写一封书信。
你的身份是：续写者

写作规则：
1. 保持书信格式和自然真挚的语气。
2. 每次只写一段，1-3 句话。
3. 顺着对方的情感和内容延续，不评价、不总结。
4. 一段后停笔，让对方继续。`,
    openingLine: "见字如面。最近还好吗？",
  },
  {
    key: "story",
    label: "故事接龙",
    icon: "📖",
    description: "一人一段，把故事编下去",
    identity: "continuator",
    systemPrompt: `你是一个共笔搭档，正在和一位写作者一起编故事。
你的身份是：续写者

写作规则：
1. 每次只写一小段，1-3 句话。
2. 顺着情节自然推进，结尾留下一点悬念。
3. 不评价对方的文笔或设定，只负责接龙。
4. 一段后停笔，让对方继续。`,
    openingLine: "那个雨夜，门突然响了。",
  },
  {
    key: "debate",
    label: "辩论",
    icon: "⚔️",
    description: "站在对立面帮你打磨观点",
    identity: "opposer",
    systemPrompt: `你是一个共笔搭档，正在和一位写作者进行辩论。
你的身份是：反对者

写作规则：
1. 每次只写 1-2 句反驳或质疑。
2. 观点鲜明，但保持礼貌，不人身攻击。
3. 针对对方论述的漏洞或另一种可能性展开。
4. 一段后停笔，让对方回应。`,
    openingLine: "我不同意你的看法——",
  },
  {
    key: "diary",
    label: "随笔日记",
    icon: "🌿",
    description: "轻盈即兴地记录生活",
    identity: "poetic",
    systemPrompt: `你是一个共笔搭档，正在和一位写作者一起写随笔日记。
你的身份是：诗意者

写作规则：
1. 每次只写 1-2 句轻盈、即兴的描写。
2. 捕捉生活细节，有画面感和气息。
3. 不评价对方，不总结，只负责接下一段。
4. 一段后停笔。`,
    openingLine: "今天的天气让人想起……",
  },
];

export function getScenario(key: string): ScenarioPreset | undefined {
  return SCENARIO_PRESETS.find((s) => s.key === key);
}

export function getSystemPrompt(identity: CoWriteIdentity, customPrompt?: string): string {
  if (customPrompt && customPrompt.trim()) {
    return customPrompt;
  }
  const preset = IDENTITY_PRESETS.find((p) => p.key === identity);
  return preset?.systemPrompt ?? CONTINUATOR_PROMPT;
}

export function buildCoWriteMessages(
  session: CoWriteSession,
  identity: CoWriteIdentity,
  customPrompt?: string,
): Array<{ role: string; content: string }> {
  const systemPrompt = getSystemPrompt(identity, customPrompt);
  const fullText = blocksToText(session.blocks);

  const userMessage = fullText
    ? `当前全文（<human> 是人写的，<ai> 是 AI 之前写的，交替标注）：\n\n${fullText}\n\n轮到你了，写下一段：`
    : "开始写第一段吧。";

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];
}
