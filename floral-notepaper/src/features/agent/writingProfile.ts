// 跨项目写作画像（issue 场景十二）
// 从历史文档档案聚合长期写作习惯：篇数、平均删改率、删改率趋势。
// 纯函数、可降级：无历史时返回空画像。用于复盘页的「跨项目画像」区块，
// 以及新建同类项目时的轻量建议。

export interface HistoricalDocLike {
  noteId: string;
  title: string;
  summary: string;
  /** 删改率百分比 0-100 */
  deleteRatio: number;
}

export type ProfileTrend = "improving" | "steady" | "worsening" | "unknown";

export interface WritingProfileInsight {
  /** 历史文档篇数 */
  docCount: number;
  /** 历史平均删改率（百分比，四舍五入） */
  avgDeleteRatio: number;
  /** 最近一篇相对历史均值的趋势 */
  trend: ProfileTrend;
  /** 一句温柔、不评价的画像描述 */
  summary: string;
}

/**
 * 聚合历史文档，得到跨项目写作画像。
 * docs 按时间顺序传入（最后一篇为最新）。
 */
export function summarizeWritingProfile(docs: HistoricalDocLike[]): WritingProfileInsight | null {
  if (docs.length === 0) return null;

  const ratios = docs.map((d) => d.deleteRatio);
  const avg = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const avgRounded = Math.round(avg);

  // 趋势：至少 2 篇时，用最新一篇与「除最新外的历史均值」比较
  let trend: ProfileTrend = "unknown";
  if (docs.length >= 2) {
    const latest = ratios[ratios.length - 1];
    const priorRatios = ratios.slice(0, -1);
    const priorAvg = priorRatios.reduce((s, r) => s + r, 0) / priorRatios.length;
    const delta = latest - priorAvg;
    // 删改率下降视为更稳（improving），上升视为更纠结（worsening）
    trend = delta < -3 ? "improving" : delta > 3 ? "worsening" : "steady";
  }

  const trendText =
    trend === "improving"
      ? "最近这篇比以往更稳一些"
      : trend === "worsening"
        ? "最近这篇改动多了一点，很正常"
        : trend === "steady"
          ? "最近的节奏和以往差不多"
          : "";

  const summary =
    `已经陪你写了 ${docs.length} 篇，历史平均删改率约 ${avgRounded}%。` +
    (trendText ? `${trendText}。` : "");

  return {
    docCount: docs.length,
    avgDeleteRatio: avgRounded,
    trend,
    summary,
  };
}
