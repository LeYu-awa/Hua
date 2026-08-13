import type { ProviderConfig } from "../settings/types";

/**
 * 日记内容生成（diary S1）
 *
 * 有可用 LLM 供应商时，把对话整理成第一人称 Markdown 日记；
 * 无供应商 / 调用失败 / 内容为空时，回退为原文摘录，保证沉淀不阻塞。
 */

export interface DiarySourceMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface ComposeDiaryResult {
  title: string;
  content: string;
  /** true 表示走了原文摘录回退（无 LLM 或整理失败） */
  usedFallback: boolean;
}

const SYSTEM_PROMPT = `你是花笺的花灵，温柔地把用户今天的对话整理成一篇简短日记。
要求：
1. 以用户视角第一人称（"我"）记录今天聊了什么、有什么想法；
2. 保留关键内容：灵感、设定、情绪、待办，丢弃寒暄与重复；
3. 输出 3-8 行 Markdown 文本，可用 - 列表；
4. 结尾不要写"今天就这样"之类的客套；
5. 只输出日记正文，不要任何解释或标题。`;

const FALLBACK_MAX_MESSAGES = 12;
const FALLBACK_MAX_CHARS_PER_MESSAGE = 200;

export async function composeDiaryContent(
  messages: DiarySourceMessage[],
  providers: ProviderConfig[],
): Promise<ComposeDiaryResult> {
  const fallback = composeFromFallback(messages);
  const provider = pickProvider(providers);
  if (!provider) return fallback;

  try {
    const transcript = messages
      .filter((message) => message.content.trim().length > 0)
      .map((message) => `${message.role === "user" ? "我" : "花灵"}：${message.content}`)
      .join("\n");
    if (!transcript.trim()) return fallback;

    const content = await callLlm(provider, transcript);
    if (!content.trim()) return fallback;
    return { title: makeTitle(messages), content: content.trim(), usedFallback: false };
  } catch {
    return fallback;
  }
}

export function composeFromFallback(messages: DiarySourceMessage[]): ComposeDiaryResult {
  const trimmed = messages.filter((message) => message.content.trim().length > 0);
  const recent = trimmed.slice(-FALLBACK_MAX_MESSAGES);

  const content = recent
    .map((message) => {
      const text = truncate(message.content.trim(), FALLBACK_MAX_CHARS_PER_MESSAGE);
      return `${message.role === "user" ? "我" : "花灵"}：${text}`;
    })
    .join("\n\n");

  return { title: makeTitle(messages), content, usedFallback: true };
}

export function makeTitle(messages: DiarySourceMessage[]): string {
  const firstUser = messages.find(
    (message) => message.role === "user" && message.content.trim().length > 0,
  );
  const raw = firstUser?.content.trim() ?? "";
  const firstLine = raw.split("\n").find((line) => line.trim().length > 0) ?? "";
  const cleaned = firstLine.replace(/^[#>*\-\s]+/, "").trim();
  return truncate(cleaned, 30) || "今天的记录";
}

/** 是否有可用 LLM 供应商（供提议卡提示"将摘录对话内容"） */
export function hasUsableProvider(providers: ProviderConfig[]): boolean {
  return pickProvider(providers) !== null;
}

function pickProvider(providers: ProviderConfig[]): ProviderConfig | null {
  return (
    providers.find(
      (provider) =>
        provider.enabled && provider.models.length > 0 && provider.baseUrl.trim().length > 0,
    ) ?? null
  );
}

async function callLlm(provider: ProviderConfig, transcript: string): Promise<string> {
  const apiUrl = provider.baseUrl.replace(/\/+$/, "") + (provider.apiPath ?? "/chat/completions");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

  const model = provider.models[0];
  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model.modelId,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`API 错误 (${response.status})`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

function truncate(value: string, maxChars: number): string {
  const chars = Array.from(value);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}…` : value;
}
