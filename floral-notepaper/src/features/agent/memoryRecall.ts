import { ragRetrieve } from "./api";
import { getBaseline } from "./profileApi";

/**
 * 对话记忆召回（记忆层闭环：写入 → 检索 → 引用）
 *
 * 用户在 SidebarChat 发消息时，用消息文本召回本地记忆
 * （历史笔记 / 日记 / Agent 产出，均已由 Rust 侧自动索引进向量库），
 * 并把相关片段注入 LLM 系统上下文——实现"角色记得你写过/聊过什么"。
 *
 * 全部 best-effort：无 embedding 供应商或检索失败时返回空串，不打扰对话。
 */

/** 按用户消息召回相关记忆片段，拼成系统上下文块；失败返回空串 */
export async function recallMemory(query: string, topK = 4): Promise<string> {
  try {
    const chunks = await ragRetrieve(query, topK);
    if (!chunks || chunks.length === 0) return "";
    const lines = chunks
      .map((chunk) => {
        const text = chunk.text.trim();
        if (!text) return "";
        return `- 「${text}」（记忆：${chunk.sourceId}）`;
      })
      .filter(Boolean);
    if (lines.length === 0) return "";
    return `\n\n相关记忆（来自用户的历史笔记/日记/产出，供你参考，不要编造）：\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

/** 召回用户写作画像（baseline），注入系统上下文；无画像或失败返回空串 */
export async function recallBaseline(): Promise<string> {
  try {
    const baseline = await getBaseline();
    if (!baseline) return "";
    const parts: string[] = [];
    if (typeof baseline.deleteRatio === "number") {
      parts.push(`删改比 ${Math.round(baseline.deleteRatio * 100)}%`);
    }
    if (typeof baseline.pausePerMin === "number") {
      parts.push(`停顿 ${baseline.pausePerMin.toFixed(1)} 次/分`);
    }
    if (parts.length === 0) return "";
    return `\n\n用户写作画像：${parts.join("、")}。据此调节陪伴语气（如删改较多时多鼓励、少评价）。`;
  } catch {
    return "";
  }
}
