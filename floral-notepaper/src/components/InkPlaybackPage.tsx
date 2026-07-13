import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { generateAgentReviewReport, listAgentReplayMarkers } from "../features/agent/api";
import type { AgentReplayMarker, AgentReviewReport } from "../features/agent/types";

// ── 类型定义 ──────────────────────────────────────────

type BehaviorType = "流畅创作" | "纠结修改" | "结构调整" | "大量重写" | "润色优化" | "停顿思考";

interface BehaviorInterval {
  startMs: number;
  endMs: number;
  type: BehaviorType;
}

type KeyPointType = "paste" | "delete" | "move" | "newParagraph" | "undo";

interface KeyPoint {
  timeMs: number;
  type: KeyPointType;
  description: string;
}

interface EditRecord {
  id: number;
  noteTitle: string;
  dateLabel: string;  // "今天" | "昨天" | "06-23"
  timeLabel: string;  // "14:30"
  durationMinutes: number;
  summary: string;
  tags: string[];
  intervals: BehaviorInterval[];
  keyPoints: KeyPoint[];
}

// ── 行为类型颜色映射 ──────────────────────────────────

const BEHAVIOR_COLORS: Record<BehaviorType, string> = {
  "流畅创作": "#2a6a42",
  "纠结修改": "#b8860b",
  "结构调整": "#4a8db7",
  "大量重写": "#c45c4a",
  "润色优化": "#8b6bb5",
  "停顿思考": "#999999",
};

const BEHAVIOR_BG: Record<BehaviorType, string> = {
  "流畅创作": "rgba(42,106,66,0.12)",
  "纠结修改": "rgba(184,134,11,0.12)",
  "结构调整": "rgba(74,141,183,0.12)",
  "大量重写": "rgba(196,92,74,0.12)",
  "润色优化": "rgba(139,107,181,0.12)",
  "停顿思考": "rgba(153,153,153,0.08)",
};

// ── 模拟文档内容 ──────────────────────────────────────

const mockDocumentContent = `# 日记 · 2026年6月25日

今天早上六点半就醒了，窗外的阳光透过竹帘洒在桌上，暖洋洋的。泡了一杯龙井，坐在电脑前，突然很想写点什么。

最近在读汪曾祺的《人间草木》，里面有一段写葡萄月令，特别有意思。他说"葡萄藤从土里钻出来，像一条条小蛇"，这种比喻，只有真正种过葡萄的人才写得出来吧。

我突然想到，写作这件事，说到底，就是把自己看到的世界，用一种陌生化的方式重新描述出来。汪曾祺写葡萄，我写什么？

下午出门散步，小区里的栀子花开了，香气浓得有点过分。但很奇怪，这种"过分"反而让人安心——夏天就该是这个味道。`;

// ── 模拟编辑记录 ──────────────────────────────────────

const mockRecords: EditRecord[] = [
  {
    id: 1,
    noteTitle: "日记 · 2026-06-25",
    dateLabel: "今天",
    timeLabel: "08:12",
    durationMinutes: 33,
    summary: "完成了开篇的景物描写和读书感悟部分，反复推敲了开头两段",
    tags: ["流畅创作", "纠结修改"],
    intervals: [
      { startMs: 0, endMs: 480000, type: "流畅创作" },
      { startMs: 480000, endMs: 960000, type: "纠结修改" },
      { startMs: 960000, endMs: 1380000, type: "流畅创作" },
      { startMs: 1380000, endMs: 1740000, type: "润色优化" },
      { startMs: 1740000, endMs: 1980000, type: "停顿思考" },
    ],
    keyPoints: [
      { timeMs: 120000, type: "paste", description: "粘贴了一段关于汪曾祺的读书笔记" },
      { timeMs: 600000, type: "delete", description: "删除了开头一大段，重新写" },
      { timeMs: 1500000, type: "move", description: "把'栀子花'那段从开头移到了结尾" },
    ],
  },
  {
    id: 2,
    noteTitle: "日记 · 2026-06-25",
    dateLabel: "今天",
    timeLabel: "11:30",
    durationMinutes: 40,
    summary: "新增了主体内容，补充了下午散步的细节，调整了段落顺序",
    tags: ["流畅创作", "结构调整"],
    intervals: [
      { startMs: 0, endMs: 720000, type: "流畅创作" },
      { startMs: 720000, endMs: 1200000, type: "结构调整" },
      { startMs: 1200000, endMs: 1800000, type: "流畅创作" },
      { startMs: 1800000, endMs: 2100000, type: "润色优化" },
      { startMs: 2100000, endMs: 2400000, type: "停顿思考" },
    ],
    keyPoints: [
      { timeMs: 300000, type: "newParagraph", description: "新增了'下午散步'段落" },
      { timeMs: 900000, type: "move", description: "把栀子花段落移到文章末尾" },
      { timeMs: 1500000, type: "undo", description: "撤销了一次大段删除" },
    ],
  },
  {
    id: 3,
    noteTitle: "日记 · 2026-06-25",
    dateLabel: "今天",
    timeLabel: "15:05",
    durationMinutes: 47,
    summary: "整体润色修改，优化了多处表达，重新梳理了结尾",
    tags: ["润色优化", "大量重写"],
    intervals: [
      { startMs: 0, endMs: 600000, type: "润色优化" },
      { startMs: 600000, endMs: 1320000, type: "大量重写" },
      { startMs: 1320000, endMs: 1920000, type: "流畅创作" },
      { startMs: 1920000, endMs: 2400000, type: "润色优化" },
      { startMs: 2400000, endMs: 2820000, type: "停顿思考" },
    ],
    keyPoints: [
      { timeMs: 720000, type: "delete", description: "删除了结尾一大段，并开始重写" },
      { timeMs: 1800000, type: "paste", description: "粘贴了一段之前写的素材" },
    ],
  },
];

// ── 辅助函数 ──────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

function markerToBehavior(type: AgentReplayMarker["markerType"]): BehaviorType {
  if (type === "stuck" || type === "conflict") return "停顿思考";
  if (type === "handoff") return "结构调整";
  if (type === "consensus") return "润色优化";
  return "流畅创作";
}

function markerToKeyPointType(type: AgentReplayMarker["markerType"]): KeyPointType {
  if (type === "stuck" || type === "conflict") return "delete";
  if (type === "handoff") return "move";
  if (type === "consensus") return "paste";
  return "newParagraph";
}

function buildAgentRecord(markers: AgentReplayMarker[]): EditRecord | null {
  if (markers.length === 0) return null;

  const sorted = [...markers].sort((a, b) => a.time - b.time);
  const start = sorted[0].time;
  const end = sorted[sorted.length - 1].time;
  const durationMs = Math.max(5 * 60_000, end - start + 5 * 60_000);
  const startDate = new Date(start);
  const intervals: BehaviorInterval[] = sorted.map((marker, index) => {
    const startMs = Math.max(0, marker.time - start);
    const next = sorted[index + 1];
    const endMs = next ? Math.max(startMs + 60_000, next.time - start) : durationMs;
    return { startMs, endMs, type: markerToBehavior(marker.markerType) };
  });

  return {
    id: 10_000,
    noteTitle: "Agent 画布回放",
    dateLabel: "最近",
    timeLabel: startDate.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    durationMinutes: Math.max(1, Math.ceil(durationMs / 60_000)),
    summary: `Agent 已从画布事件中识别 ${sorted.length} 个关键节点`,
    tags: Array.from(new Set(intervals.map((interval) => interval.type))),
    intervals,
    keyPoints: sorted.map((marker) => ({
      timeMs: Math.max(0, marker.time - start),
      type: markerToKeyPointType(marker.markerType),
      description: `${marker.title}：${marker.summary}`,
    })),
  };
}

// ── 组件 ──────────────────────────────────────────────

export function InkPlaybackPage() {
  const [records, setRecords] = useState<EditRecord[]>(mockRecords);
  const [agentReport, setAgentReport] = useState<AgentReviewReport | null>(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number>(mockRecords[0]?.id ?? null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [hoverKeyPoint, setHoverKeyPoint] = useState<KeyPoint | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const conversationId = localStorage.getItem("floral-last-conversation-id");
    if (!conversationId) return;

    setIsReportLoading(true);
    setReportError(null);
    Promise.all([
      listAgentReplayMarkers(conversationId),
      generateAgentReviewReport(conversationId),
    ])
      .then(([markers, report]) => {
        const agentRecord = buildAgentRecord(markers);
        if (agentRecord) {
          setRecords([agentRecord, ...mockRecords]);
          setSelectedId(agentRecord.id);
        }
        setAgentReport(report);
      })
      .catch((error) => {
        console.warn(error);
        setReportError("复盘报告生成失败，请稍后再试");
      })
      .finally(() => setIsReportLoading(false));
  }, []);

  const selectedRecord = useMemo(
    () => records.find((r) => r.id === selectedId) ?? null,
    [records, selectedId],
  );

  const totalMs = useMemo(() => {
    if (!selectedRecord) return 0;
    const last = selectedRecord.intervals[selectedRecord.intervals.length - 1];
    return last?.endMs ?? 0;
  }, [selectedRecord]);

  const handleTimelineMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = timelineRef.current;
      if (!el || !selectedRecord) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ms = ratio * totalMs;
      setHoverMs(ms);

      // 检查是否悬停在关键点上
      const nearPoint = selectedRecord.keyPoints.find(
        (kp) => Math.abs(kp.timeMs - ms) < totalMs * 0.02,
      );
      setHoverKeyPoint(nearPoint ?? null);
    },
    [selectedRecord, totalMs],
  );

  const handleTimelineMouseLeave = useCallback(() => {
    setHoverMs(null);
    setHoverKeyPoint(null);
  }, []);

  // 当前悬停位置所在的行为区间
  const activeInterval = useMemo(() => {
    if (hoverMs === null || !selectedRecord) return null;
    return (
      selectedRecord.intervals.find(
        (inv) => hoverMs >= inv.startMs && hoverMs < inv.endMs,
      ) ?? null
    );
  }, [hoverMs, selectedRecord]);

  // 空状态
  if (records.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-paper">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-ink-ghost select-none px-6">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              className="mx-auto mb-3 opacity-25"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <p className="text-[13px] leading-relaxed">
              暂无编辑记录
            </p>
            <p className="text-[11px] text-ink-ghost/60 mt-1 leading-relaxed">
              之后编辑文档时，这里会展示编辑过程
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper">
      {/* 主体区域 */}
      <div className="flex-1 flex min-h-0">
        {/* ── 左侧：主编辑区 ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 预览提示 */}
          {hoverMs !== null && (
            <div className="shrink-0 mx-5 mt-3 px-3 py-1.5 rounded-lg bg-bamboo-mist/60 border border-bamboo/20 flex items-center gap-2 animate-fade-in">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-bamboo shrink-0">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span className="text-[11px] text-bamboo font-medium">
                正在预览历史编辑状态
              </span>
              {activeInterval && (
                <span className="text-[10px] text-ink-ghost ml-auto">
                  当时正在{activeInterval.type}
                </span>
              )}
            </div>
          )}

          {/* 文档内容 */}
          <div className="flex-1 overflow-y-auto px-8 py-5">
            {(isReportLoading || reportError || agentReport) && (
              <div className="mb-4 rounded-2xl border border-bamboo/20 bg-cloud/70 p-4 shadow-[0_10px_30px_rgba(40,48,38,0.08)] animate-fade-in">
                {isReportLoading && (
                  <p className="text-[11px] leading-relaxed text-ink-faint">
                    Agent 正在生成协作复盘报告…
                  </p>
                )}
                {reportError && (
                  <p className="text-[11px] leading-relaxed text-clay">
                    {reportError}
                  </p>
                )}
                {agentReport && (
                  <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-display font-semibold text-ink-soft">
                      {agentReport.title}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                      {agentReport.summary}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-xl bg-bamboo/10 px-3 py-2 text-center text-bamboo">
                    <p className="text-[10px]">健康度</p>
                    <p className="text-lg font-semibold leading-none">{agentReport.healthScore}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries(agentReport.markerCounts)
                    .filter(([, count]) => count > 0)
                    .map(([type, count]) => (
                      <span key={type} className="rounded-full bg-paper/80 px-2 py-0.5 text-[10px] text-ink-faint">
                        {type} × {count}
                      </span>
                    ))}
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {[
                    ["亮点", agentReport.highlights],
                    ["风险", agentReport.risks],
                    ["下一步", agentReport.nextSteps],
                  ].map(([title, items]) => (
                    <div key={title as string} className="rounded-xl bg-paper/70 p-3">
                      <p className="text-[10px] font-medium text-ink-soft">{title as string}</p>
                      <ul className="mt-1 space-y-1">
                        {(items as string[]).slice(0, 2).map((item) => (
                          <li key={item} className="text-[10px] leading-relaxed text-ink-faint">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                  </>
                )}
              </div>
            )}
            <div
              className={`text-[15px] leading-[2] text-ink-soft font-body whitespace-pre-wrap transition-opacity duration-200 ${
                hoverMs !== null ? "opacity-70" : ""
              }`}
            >
              {mockDocumentContent}
            </div>
          </div>
        </div>

        {/* ── 右侧：编辑记录栏 ── */}
        <div className="w-[280px] shrink-0 border-l border-paper-deep/30 flex flex-col bg-cloud/50">
          <div className="px-4 pt-4 pb-2 shrink-0">
            <h3 className="text-[12px] font-display font-semibold text-ink-soft tracking-wide">
              编辑记录
            </h3>
            <p className="text-[10px] text-ink-ghost mt-0.5">
              共 {records.length} 次编辑
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3">
            <div className="relative pl-5">
              {/* 时间线竖线 */}
              <div className="absolute left-[9px] top-2 bottom-2 w-px bg-paper-deep/40" />

              {records.map((record) => {
                const isSelected = record.id === selectedId;

                return (
                  <div key={record.id} className="relative pb-4 last:pb-0">
                    {/* 时间线圆点 */}
                    <div
                      className={`absolute left-[-17px] top-2.5 w-[9px] h-[9px] rounded-full border-2 z-10 transition-colors duration-300 ${
                        isSelected
                          ? "border-bamboo bg-bamboo"
                          : "border-paper-deep/50 bg-cloud"
                      }`}
                    />

                    {/* 卡片 */}
                    <button
                      onClick={() => setSelectedId(record.id)}
                      className={`w-full text-left rounded-xl border p-3 transition-all duration-300 cursor-pointer group ${
                        isSelected
                          ? "border-bamboo/30 bg-bamboo-mist/40"
                          : "border-paper-deep/25 bg-paper/70 hover:border-bamboo/25 hover:bg-bamboo-mist/30"
                      }`}
                    >
                      {/* 时间 + 时长 */}
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[12px] font-medium text-ink-soft">
                          {record.dateLabel} {record.timeLabel}
                        </span>
                        <span className="text-[10px] text-ink-ghost font-mono">
                          编辑 {formatDuration(record.durationMinutes)}
                        </span>
                      </div>

                      {/* 摘要 */}
                      <p className="text-[11px] text-ink-faint leading-relaxed mb-2 line-clamp-2">
                        {record.summary}
                      </p>

                      {/* 行为标签 */}
                      <div className="flex items-center gap-1 flex-wrap">
                        {record.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{
                              color: BEHAVIOR_COLORS[tag as BehaviorType],
                              backgroundColor: BEHAVIOR_BG[tag as BehaviorType],
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── 底部时间轴 ── */}
      {selectedRecord && (
        <div className="shrink-0 border-t border-paper-deep/30 bg-cloud/70">
          {/* 关键点提示气泡 */}
          {hoverKeyPoint && (
            <div className="px-5 pt-2 pb-0 animate-fade-in">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-ink/80 text-cloud text-[11px]">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span className="font-mono text-[10px] opacity-70">
                  {formatMs(hoverKeyPoint.timeMs)}
                </span>
                <span>{hoverKeyPoint.description}</span>
              </div>
            </div>
          )}

          <div className="flex items-center px-5 py-2.5 gap-3">
            {/* 开始时间 */}
            <span className="text-[10px] text-ink-ghost font-mono tabular-nums shrink-0 w-10 text-right">
              {selectedRecord.timeLabel}
            </span>

            {/* 时间轴主体 */}
            <div
              ref={timelineRef}
              className="flex-1 h-7 rounded-full bg-paper-deep/30 relative overflow-visible cursor-pointer group"
              onMouseMove={handleTimelineMouseMove}
              onMouseLeave={handleTimelineMouseLeave}
            >
              {/* 行为区间色块 */}
              {selectedRecord.intervals.map((inv, i) => {
                const leftPct = (inv.startMs / totalMs) * 100;
                const widthPct = ((inv.endMs - inv.startMs) / totalMs) * 100;
                const isActive =
                  activeInterval?.startMs === inv.startMs;

                return (
                  <div
                    key={i}
                    className={`absolute top-1 bottom-1 first:rounded-l-full last:rounded-r-full transition-all duration-150 ${
                      isActive ? "brightness-110 scale-y-[1.15]" : ""
                    }`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: BEHAVIOR_COLORS[inv.type],
                      opacity: isActive ? 0.9 : 0.55,
                    }}
                    title={`${inv.type} (${formatMs(inv.startMs)} - ${formatMs(inv.endMs)})`}
                  />
                );
              })}

              {/* 悬停指示线 */}
              {hoverMs !== null && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-ink z-10 pointer-events-none"
                  style={{ left: `${(hoverMs / totalMs) * 100}%` }}
                />
              )}

              {/* 关键点标记 */}
              {selectedRecord.keyPoints.map((kp, i) => {
                const leftPct = (kp.timeMs / totalMs) * 100;
                const isHovered = hoverKeyPoint?.timeMs === kp.timeMs;

                return (
                  <div
                    key={i}
                    className={`absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border-2 border-cloud z-10 transition-transform duration-150 ${
                      isHovered ? "scale-150" : "scale-100"
                    }`}
                    style={{
                      left: `calc(${leftPct}% - 4px)`,
                      backgroundColor: BEHAVIOR_COLORS[
                        selectedRecord.intervals.find(
                          (inv) => kp.timeMs >= inv.startMs && kp.timeMs < inv.endMs,
                        )?.type ?? "流畅创作"
                      ],
                    }}
                  />
                );
              })}
            </div>

            {/* 结束时间 */}
            <span className="text-[10px] text-ink-ghost font-mono tabular-nums shrink-0 w-10">
              {(() => {
                const [h, m] = selectedRecord.timeLabel.split(":").map(Number);
                const endMin = m + selectedRecord.durationMinutes;
                const endH = h + Math.floor(endMin / 60);
                const endM = endMin % 60;
                return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
              })()}
            </span>
          </div>

          {/* 图例 */}
          <div className="flex items-center gap-3 px-5 pb-2.5">
            {(Object.keys(BEHAVIOR_COLORS) as BehaviorType[]).map((type) => (
              <div key={type} className="flex items-center gap-1">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: BEHAVIOR_COLORS[type] }}
                />
                <span className="text-[9px] text-ink-ghost">{type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
