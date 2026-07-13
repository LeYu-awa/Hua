import type { ProviderConfig } from "../settings/types";
import type { CoWriteIdentity, CoWriteSession } from "./types";
import { buildCoWriteMessages } from "./prompts";

function getActiveApiConfig(providers: ProviderConfig[]): {
  apiUrl: string;
  apiKey: string;
  modelId: string;
} | null {
  const enabled = providers.filter((p) => p.enabled && p.models.length > 0);
  if (enabled.length === 0) return null;

  // 优先选 DeepSeek
  const ds = enabled.find((p) => p.name.toLowerCase().includes("deepseek"));
  const provider = ds ?? enabled[0];
  const model = provider.models[0];
  if (!model) return null;

  const apiUrl = provider.baseUrl.replace(/\/+$/, "") + provider.apiPath;

  return {
    apiUrl,
    apiKey: provider.apiKey,
    modelId: model.modelId,
  };
}

export async function callChatCompletion(
  providers: ProviderConfig[],
  messages: Array<{ role: string; content: string }>,
  temperature = 0.8,
): Promise<string> {
  const config = getActiveApiConfig(providers);
  if (!config) {
    throw new Error("没有可用的 AI 供应商，请先在设置中配置");
  }

  console.log("[coWriteAI] request", {
    url: config.apiUrl,
    model: config.modelId,
    temperature,
    messages,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.modelId,
      messages,
      stream: false,
      temperature,
      max_tokens: 500,
    }),
  });

  console.log("[coWriteAI] response status", response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[coWriteAI] response error body", errorText);
    throw new Error(`AI 响应错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  console.log("[coWriteAI] response data", data);

  const content: string = data.choices?.[0]?.message?.content ?? "（未收到回复）";

  console.log("[coWriteAI] extracted content", content);
  return content.trim();
}

export async function requestCoWriteAITurn(
  session: CoWriteSession,
  identity: CoWriteIdentity,
  customPrompt: string | undefined,
  providers: ProviderConfig[],
  temperature = 0.8,
  canvasContext?: string,
): Promise<string> {
  const messages = buildCoWriteMessages(session, identity, customPrompt, canvasContext);
  return callChatCompletion(providers, messages, temperature);
}

export async function regenerateCoWriteAITurn(
  session: CoWriteSession,
  identity: CoWriteIdentity,
  customPrompt: string | undefined,
  providers: ProviderConfig[],
  canvasContext?: string,
): Promise<string> {
  const messages = buildCoWriteMessages(session, identity, customPrompt, canvasContext);
  const lastMessage = messages[messages.length - 1];
  if (lastMessage && lastMessage.role === "user") {
    lastMessage.content += "\n\n换一种写法：";
  }
  return callChatCompletion(providers, messages, 1.0);
}

export function extractJsonArray<T>(text: string): T[] {
  // 先尝试直接从文本中解析 JSON
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as T[];
  } catch {
    // ignore
  }

  // 再尝试从 markdown 代码块中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      // ignore
    }
  }

  // 兜底：尝试匹配第一个 [ ... ] 数组
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      // ignore
    }
  }

  throw new Error("AI 返回的灵感格式无法解析");
}

export interface CoWriteInspiration {
  title: string;
  snippet: string;
}

export async function generateInspirations(
  noteContent: string,
  providers: ProviderConfig[],
): Promise<CoWriteInspiration[]> {
  const prompt = `基于以下笔记内容，生成 3 个不同方向的写作思路建议。
每个建议包含一个简短标题和一句话的示例开头。
用 JSON 格式返回：[{"title": "...", "snippet": "..."}]

笔记内容：
${noteContent || "（暂无内容）"}`;

  const messages = [
    { role: "system", content: "你是一个写作灵感助手。" },
    { role: "user", content: prompt },
  ];

  const text = await callChatCompletion(providers, messages, 0.9);
  const inspirations = extractJsonArray<CoWriteInspiration>(text);

  if (inspirations.length === 0) {
    throw new Error("AI 未返回任何灵感");
  }

  // 只取前 3 条，并确保字段存在
  return inspirations.slice(0, 3).map((item, index) => ({
    title: item.title || `灵感 ${index + 1}`,
    snippet: item.snippet || "从这里开始写……",
  }));
}
