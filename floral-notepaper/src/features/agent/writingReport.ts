import { callChatCompletion } from "../cowrite/coWriteAI";
import { analyzeInkSession } from "../ink/analyze";
import { getInkSession, listInkSessions } from "../ink/api";
import { getNote } from "../notes/api";
import type { ProviderConfig } from "../settings/types";
import { callEmbedding, cosineSimilarity } from "./embeddingService";
import { addHistoricalDoc } from "./profileApi";

export interface WritingReport {
  summary: string;
  insights: string[];
  flowPeriods: Array<{ startMs: number; endMs: number; description: string }>;
  stuckPoints: Array<{ timeMs: number; description: string }>;
  stats: {
    totalDurationMs: number;
    totalWords: number;
    deleteRatio: number;
  };
  suggestions: string[];
}

interface ReportInput {
  title: string;
  contentLength: number;
  totalDurationMs: number;
  sessionCount: number;
  deleteRatio: number;
  pauseCount: number;
  longestFlowMs: number;
  longestStuckMs: number;
}

function countWords(text: string): number {
  // 简单统计：中文字符 + 英文单词
  const cn = (text.match(/[一-龥]/g) || []).length;
  const en = (text.match(/[a-zA-Z0-9_]+/g) || []).length;
  return cn + en;
}

export async function generateWritingReport(
  noteId: string,
  providers: ProviderConfig[],
  options: { historicalDocs?: HistoricalDoc[] } = {},
): Promise<WritingReport | null> {
  if (!noteId || providers.length === 0) return null;

  const [note, sessionSummaries] = await Promise.all([getNote(noteId), listInkSessions(noteId)]);

  if (sessionSummaries.length === 0) return null;

  const sessions = await Promise.all(sessionSummaries.map((s) => getInkSession(noteId, s.id)));

  const analyzedSessions = sessions.map((s) => analyzeInkSession(s.events));

  const totalDurationMs = analyzedSessions.reduce((sum, a) => sum + a.durationMs, 0);
  const totalWords = countWords(note.content);

  let totalDeletes = 0;
  let totalInserts = 0;
  let pauseCount = 0;
  let longestFlowMs = 0;
  let longestStuckMs = 0;

  for (const analyzed of analyzedSessions) {
    for (const interval of analyzed.intervals) {
      if (interval.type === "流畅创作") {
        longestFlowMs = Math.max(longestFlowMs, interval.endMs - interval.startMs);
      } else if (interval.type === "停顿思考") {
        longestStuckMs = Math.max(longestStuckMs, interval.endMs - interval.startMs);
      }
    }

    for (const kp of analyzed.keyPoints) {
      if (kp.type === "pause") pauseCount++;
    }
  }

  // 从原始事件统计删除/插入
  for (const session of sessions) {
    for (const event of session.events) {
      if (event.type === "delete") totalDeletes += event.length ?? 0;
      if (event.type === "insert" || event.type === "paste") {
        totalInserts += event.text?.length ?? 0;
      }
    }
  }

  const deleteRatio = totalInserts > 0 ? totalDeletes / (totalDeletes + totalInserts) : 0;

  const input: ReportInput = {
    title: note.title,
    contentLength: note.content.length,
    totalDurationMs,
    sessionCount: sessions.length,
    deleteRatio: Math.round(deleteRatio * 100),
    pauseCount,
    longestFlowMs,
    longestStuckMs,
  };

  // RAG：检索历史同类文档做对比（可降级：无历史或无 embedding 时为空）
  const comparison = await buildHistoricalComparison(
    note.content,
    input.deleteRatio,
    options.historicalDocs ?? [],
    providers,
  );

  const prompt = `你是一位温柔的写作教练。请基于以下写作数据生成一份复盘报告。
语气要求：只描述、不评价、不指责，用"这次…""相比…"等中性表达。
输出 JSON 格式：
{
  "summary": "一段 50 字以内的总体描述",
  "insights": ["3-5 条关键洞察"],
  "flowPeriods": [{"startMs": 0, "endMs": 600000, "description": "流畅期描述"}],
  "stuckPoints": [{"timeMs": 600000, "description": "卡顿点描述"}],
  "stats": {"totalDurationMs": 数字, "totalWords": 数字, "deleteRatio": 数字},
  "suggestions": ["2-3 条下一次写作建议"]
}

写作数据：
- 标题：${input.title}
- 字数：${totalWords}
- 总写作时长：${Math.round(input.totalDurationMs / 60000)} 分钟
- 写作次数：${input.sessionCount} 次
- 删除占比：${input.deleteRatio}%
- 长停顿次数：${input.pauseCount}
- 最长连续流畅写作：${Math.round(input.longestFlowMs / 60000)} 分钟
- 最长一次停顿：${Math.round(input.longestStuckMs / 1000)} 秒${comparison}`;

  try {
    const messages = [
      { role: "system", content: "你是一个温柔、不评价用户的写作教练。" },
      { role: "user", content: prompt },
    ];
    const text = await callChatCompletion(providers, messages, 0.7);

    // 尝试解析 JSON 对象
    let report: Partial<WritingReport> | null = null;
    let parseError: unknown = null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        report = parsed as Partial<WritingReport>;
      }
    } catch (e) {
      parseError = e;
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        try {
          const parsed = JSON.parse(codeBlockMatch[1]);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            report = parsed as Partial<WritingReport>;
            parseError = null;
          }
        } catch (e2) {
          parseError = e2;
        }
      }
    }

    if (!report) {
      const preview = text.slice(0, 120).replace(/\s+/g, " ");
      throw new Error(
        `AI 返回内容无法解析为报告（${parseError ? String(parseError) : "格式不符"}）。原始回复: "${preview}${text.length > 120 ? "…" : ""}"`,
      );
    }

    // 把本次文档存入用户画像，供未来复盘做 RAG 对比（可降级：失败静默忽略）
    await addHistoricalDoc({
      noteId,
      title: note.title,
      summary: note.content.slice(0, 500),
      deleteRatio: input.deleteRatio,
    });

    return {
      summary: report.summary || "",
      insights: Array.isArray(report.insights) ? report.insights.slice(0, 5) : [],
      flowPeriods: Array.isArray(report.flowPeriods) ? report.flowPeriods.slice(0, 3) : [],
      stuckPoints: Array.isArray(report.stuckPoints) ? report.stuckPoints.slice(0, 3) : [],
      stats: {
        totalDurationMs: report.stats?.totalDurationMs ?? totalDurationMs,
        totalWords: report.stats?.totalWords ?? totalWords,
        deleteRatio: report.stats?.deleteRatio ?? deleteRatio,
      },
      suggestions: Array.isArray(report.suggestions) ? report.suggestions.slice(0, 3) : [],
    };
  } catch (err) {
    // LLM 调用失败或解析失败：向上抛出真实错误，而不是静默返回 null
    throw new Error(
      err instanceof Error
        ? `生成复盘报告失败：${err.message}`
        : `生成复盘报告失败：${String(err)}`,
    );
  }
}

export async function generateWritingReportForAllNotes(
  providers: ProviderConfig[],
): Promise<WritingReport | null> {
  if (providers.length === 0) return null;
  const notes = await listInkSessionsForAllNotes();
  if (notes.length === 0) return null;
  // 先只做单篇笔记的复盘，跨项目画像在 P3
  return generateWritingReport(notes[0].noteId, providers);
}

async function listInkSessionsForAllNotes(): Promise<Array<{ noteId: string; title: string }>> {
  // 这里无法直接列出所有 noteId，因为 ink 目录按 noteId 分。
  // 简单方案：返回空，后续如需跨项目画像再扩展。
  return [];
}

// ─── RAG：历史同类文档对比（issue 场景五） ───

/** 历史文档档案，用于复盘时做同类对比。持久化由调用方负责。 */
export interface HistoricalDoc {
  noteId: string;
  title: string;
  /** 文档内容摘要，用于计算主题向量 */
  summary: string;
  /** 历史删改率（百分比，0-100） */
  deleteRatio: number;
}

/**
 * 在历史文档中检索与当前文档主题最相似的一篇。
 * 无历史、无 embedding 供应商或调用失败时返回 null（可降级）。
 */
export async function findSimilarHistoricalDoc(
  currentText: string,
  history: HistoricalDoc[],
  providers: ProviderConfig[],
): Promise<{ doc: HistoricalDoc; similarity: number } | null> {
  if (history.length === 0 || !currentText.trim()) return null;
  try {
    const vectors = await callEmbedding(providers, [
      currentText.slice(0, 500),
      ...history.map((h) => h.summary.slice(0, 500)),
    ]);
    const currentVec = vectors[0];
    let best: { doc: HistoricalDoc; similarity: number } | null = null;
    history.forEach((doc, i) => {
      const sim = cosineSimilarity(currentVec, vectors[i + 1]);
      if (!best || sim > best.similarity) best = { doc, similarity: sim };
    });
    return best;
  } catch {
    return null;
  }
}

/**
 * 构造注入 prompt 的历史对比文本。找不到相似文档时返回空串。
 * 相似度过低（< 0.6）视为不同类文档，不做对比。
 */
async function buildHistoricalComparison(
  currentText: string,
  currentDeleteRatio: number,
  history: HistoricalDoc[],
  providers: ProviderConfig[],
): Promise<string> {
  const match = await findSimilarHistoricalDoc(currentText, history, providers);
  if (!match || match.similarity < 0.6) return "";
  const delta = currentDeleteRatio - match.doc.deleteRatio;
  const trend = delta < -3 ? "有所下降" : delta > 3 ? "有所上升" : "基本持平";
  return `

历史同类文档对比（供参考，请自然融入 insights）：
- 最相似的历史文档：《${match.doc.title}》（主题相似度 ${match.similarity.toFixed(2)}）
- 该文档历史删除占比：${match.doc.deleteRatio}%
- 本次相比历史${trend}`;
}
