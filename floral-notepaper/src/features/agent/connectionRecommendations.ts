import { callChatCompletion, extractJsonArray } from "../cowrite/coWriteAI";
import type { ProviderConfig } from "../settings/types";

export interface ConnectionRecommendation {
  /** 推荐连向的笔记/节点 ID */
  targetId: string;
  /** 目标标题 */
  targetTitle: string;
  /** 推荐理由 */
  reason: string;
  /** 相关引文 */
  quote?: string;
}

interface CandidateNote {
  id: string;
  title: string;
  preview: string;
}

/**
 * 基于当前笔记与候选笔记列表，调用 LLM 生成隐含连接推荐。
 * 失败时返回空数组，不抛错。
 */
export async function generateConnectionRecommendations(
  currentNoteId: string,
  currentTitle: string,
  currentContent: string,
  candidates: CandidateNote[],
  providers: ProviderConfig[],
): Promise<ConnectionRecommendation[]> {
  if (!currentContent && !currentTitle) return [];
  if (candidates.length === 0) return [];

  const filtered = candidates.filter((c) => c.id !== currentNoteId).slice(0, 20);
  if (filtered.length === 0) return [];

  const prompt = `你是温柔的写作伙伴。请阅读当前笔记，并从候选笔记中找出 1-3 条与当前笔记语义相关的连接推荐。
推荐理由必须中性、不评价用户，用"好像都在聊……""也许可以先轻轻连起来看看"等温柔表达。
只输出 JSON 数组，不要有多余解释：
[
  {
    "targetId": "候选笔记ID",
    "targetTitle": "候选笔记标题",
    "reason": "简短温柔的推荐理由",
    "quote": "候选笔记中相关的只言片语（可选）"
  }
]

当前笔记《${currentTitle}》：
${currentContent.slice(0, 1500)}

候选笔记：
${filtered.map((c) => `- ID: ${c.id}\n  标题: ${c.title}\n  摘要: ${c.preview.slice(0, 200)}`).join("\n\n")}`;

  try {
    const messages = [
      { role: "system", content: "你是一个温柔、不强迫的写作伙伴。" },
      { role: "user", content: prompt },
    ];
    const text = await callChatCompletion(providers, messages, 0.6);
    const results = extractJsonArray<Partial<ConnectionRecommendation>>(text);

    return results
      .filter((r): r is ConnectionRecommendation =>
        Boolean(r.targetId && r.targetTitle && r.reason),
      )
      .slice(0, 3)
      .map((r) => ({
        targetId: r.targetId,
        targetTitle: r.targetTitle,
        reason: sanitizeReason(r.reason),
        quote: r.quote,
      }));
  } catch {
    return [];
  }
}

function sanitizeReason(reason: string): string {
  return reason
    .replace(/你应该|必须|效率低|遗漏|错误|差|糟糕/g, "")
    .trim()
    .slice(0, 120);
}
