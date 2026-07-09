import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getInkSession, listInkSessions } from "../features/ink/api";
import { analyzeInkSession, getContentAtTimeMs } from "../features/ink/analyze";
import type {
  BehaviorType,
  InkKeyPoint,
  InkSession,
  InkSessionSummary,
} from "../features/ink/types";
import { getNote } from "../features/notes/api";

interface InkPlaybackPageProps {
  noteId: string;
}

const BEHAVIOR_COLORS: Record<BehaviorType, string> = {
  流畅创作: "#2a6a42",
  纠结修改: "#b8860b",
  结构调整: "#4a8db7",
  大量重写: "#c45c4a",
  润色优化: "#8b6bb5",
  停顿思考: "#999999",
};

const BEHAVIOR_BG: Record<BehaviorType, string> = {
  流畅创作: "rgba(42,106,66,0.12)",
  纠结修改: "rgba(184,134,11,0.12)",
  结构调整: "rgba(74,141,183,0.12)",
  大量重写: "rgba(196,92,74,0.12)",
  润色优化: "rgba(139,107,181,0.12)",
  停顿思考: "rgba(153,153,153,0.08)",
};

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  return min > 0 ? `${h} 小时 ${min} 分钟` : `${h} 小时`;
}

function formatDateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isToday) return "今天";
  const yesterday = new Date(now.getTime() - 86400000);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return "昨天";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTimeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function InkPlaybackPage({ noteId }: InkPlaybackPageProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<InkSessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<InkSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState<string | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [hoverKeyPoint, setHoverKeyPoint] = useState<InkKeyPoint | null>(null);
  // 播放状态
  const [playing, setPlaying] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [speed, setSpeed] = useState(2);
  const timelineRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  const SPEEDS = [1, 2, 4, 8];

  const analyzed = useMemo(() => {
    if (!selectedSession) return null;
    return analyzeInkSession(selectedSession.events);
  }, [selectedSession]);

  useEffect(() => {
    if (!noteId) {
      setSessions([]);
      setSelectedSession(null);
      setNoteTitle(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([listInkSessions(noteId), getNote(noteId)])
      .then(([loadedSessions, note]) => {
        if (cancelled) return;
        setSessions(loadedSessions);
        setNoteTitle(note.title || null);
        if (loadedSessions.length > 0) {
          return getInkSession(noteId, loadedSessions[0].id);
        }
        return null;
      })
      .then((session) => {
        if (cancelled) return;
        setSelectedSession(session ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const handleSelectSession = async (sessionId: string) => {
    if (!noteId) return;
    try {
      const session = await getInkSession(noteId, sessionId);
      setSelectedSession(session);
    } catch (err) {
      setError(String(err));
    }
  };

  const totalMs = useMemo(() => analyzed?.durationMs ?? 0, [analyzed]);

  // 播放时用 playbackMs，否则用 hover（预览），否则显示最终内容
  // 播放中或已播放过 → 用 playbackMs；否则用 hover（预览）；否则 null（最终态）
  const currentMs = playing || playbackMs > 0 ? playbackMs : hoverMs;
  const currentContent = useMemo(() => {
    if (!analyzed) return "";
    if (currentMs === null) return analyzed.snapshots[analyzed.snapshots.length - 1]?.content ?? "";
    return getContentAtTimeMs(analyzed.snapshots, currentMs);
  }, [analyzed, currentMs]);

  const activeInterval = useMemo(() => {
    if (currentMs === null || !analyzed) return null;
    return analyzed.intervals.find((inv) => currentMs >= inv.startMs && currentMs < inv.endMs) ?? null;
  }, [currentMs, analyzed]);

  // 播放循环：用 rAF 推进 playbackMs，到达末尾自动停止
  useEffect(() => {
    if (!playing || totalMs === 0) {
      lastTickRef.current = null;
      return;
    }
    const tick = (now: number) => {
      if (lastTickRef.current == null) {
        lastTickRef.current = now;
      }
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      setPlaybackMs((prev) => {
        const next = prev + delta * speed;
        if (next >= totalMs) {
          setPlaying(false);
          return totalMs;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      lastTickRef.current = null;
    };
  }, [playing, totalMs, speed]);

  // 切换 session 时重置播放
  useEffect(() => {
    setPlaying(false);
    setPlaybackMs(0);
  }, [selectedSession?.id]);

  const handlePlayPause = () => {
    if (totalMs === 0) return;
    if (playing) {
      setPlaying(false);
    } else {
      setHoverMs(null);
      setHoverKeyPoint(null);
      // 已到末尾则从头开始
      if (playbackMs >= totalMs) setPlaybackMs(0);
      setPlaying(true);
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = timelineRef.current;
    if (!el || totalMs === 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setPlaybackMs(ratio * totalMs);
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (playing) return; // 播放中不响应 hover
    const el = timelineRef.current;
    if (!el || totalMs === 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ms = ratio * totalMs;
    setHoverMs(ms);

    const nearPoint = analyzed?.keyPoints.find((kp) => Math.abs(kp.timeMs - ms) < totalMs * 0.02);
    setHoverKeyPoint(nearPoint ?? null);
  };

  const handleTimelineMouseLeave = () => {
    if (playing) return;
    setHoverMs(null);
    setHoverKeyPoint(null);
  };

  const sessionTags = useMemo(() => {
    if (!analyzed) return [];
    const tags = new Set<string>();
    for (const interval of analyzed.intervals) {
      tags.add(interval.type);
    }
    return Array.from(tags);
  }, [analyzed]);

  if (!noteId) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-paper">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-ink-ghost select-none px-6">
            <p className="text-[13px] leading-relaxed">
              {t("playback.noNote", { defaultValue: "请先选择一篇笔记" })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-paper">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-[13px] text-ink-ghost">
            {t("playback.loading", { defaultValue: "加载中…" })}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-paper">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-[13px] text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
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
              {t("playback.empty", { defaultValue: "暂无编辑记录" })}
            </p>
            <p className="text-[11px] text-ink-ghost/60 mt-1 leading-relaxed">
              {t("playback.emptyHint", {
                defaultValue: "编辑文档并开启写作伙伴后，这里会展示写作过程",
              })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const selectedSummary = sessions.find((s) => s.id === selectedSession?.id);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper">
      <div className="flex-1 flex min-h-0">
        {/* 左侧内容区 */}
        <div className="flex-1 flex flex-col min-w-0">
          {currentMs !== null && (
            <div className="shrink-0 mx-5 mt-3 px-3 py-1.5 rounded-lg bg-bamboo-mist/60 border border-bamboo/20 flex items-center gap-2 animate-fade-in">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-bamboo shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span className="text-[11px] text-bamboo font-medium">
                {playing
                  ? t("playback.playing", { defaultValue: "正在回放写作过程" })
                  : t("playback.previewing", { defaultValue: "正在预览历史编辑状态" })}
              </span>
              {activeInterval && (
                <span className="text-[10px] text-ink-ghost ml-auto">
                  {t("playback.stateAtTime", {
                    state: activeInterval.type,
                    defaultValue: `当时正在${activeInterval.type}`,
                  })}
                </span>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-8 py-5">
            <div
              className={`text-[15px] leading-[2] text-ink-soft font-body whitespace-pre-wrap transition-opacity duration-200 ${
                playing ? "opacity-90" : currentMs !== null ? "opacity-70" : ""
              }`}
            >
              {currentContent || (
                <span className="text-ink-ghost/50">
                  {t("playback.emptyContent", { defaultValue: "（空）" })}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 右侧 session 列表 */}
        <div className="w-[280px] shrink-0 border-l border-paper-deep/30 flex flex-col bg-cloud/50">
          <div className="px-4 pt-4 pb-2 shrink-0">
            <h3 className="text-[12px] font-display font-semibold text-ink-soft tracking-wide">
              {t("playback.sessions", { defaultValue: "编辑记录" })}
            </h3>
            <p className="text-[10px] text-ink-ghost mt-0.5">
              {noteTitle || t("playback.untitled", { defaultValue: "无标题" })}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3">
            <div className="relative pl-5">
              <div className="absolute left-[9px] top-2 bottom-2 w-px bg-paper-deep/40" />

              {sessions.map((session) => {
                const isSelected = session.id === selectedSession?.id;

                return (
                  <div key={session.id} className="relative pb-4 last:pb-0">
                    <div
                      className={`absolute left-[-17px] top-2.5 w-[9px] h-[9px] rounded-full border-2 z-10 transition-colors duration-300 ${
                        isSelected ? "border-bamboo bg-bamboo" : "border-paper-deep/50 bg-cloud"
                      }`}
                    />

                    <button
                      onClick={() => handleSelectSession(session.id)}
                      className={`w-full text-left rounded-xl border p-3 transition-all duration-300 cursor-pointer group ${
                        isSelected
                          ? "border-bamboo/30 bg-bamboo-mist/40"
                          : "border-paper-deep/25 bg-paper/70 hover:border-bamboo/25 hover:bg-bamboo-mist/30"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[12px] font-medium text-ink-soft">
                          {formatDateLabel(session.startedAt)} {formatTimeLabel(session.startedAt)}
                        </span>
                        <span className="text-[10px] text-ink-ghost font-mono">
                          {formatDuration(
                            Math.max(
                              1,
                              Math.round(
                                ((session.endedAt ?? session.startedAt) - session.startedAt) /
                                  60000,
                              ),
                            ),
                          )}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 flex-wrap">
                        {sessionTags.slice(0, 3).map((tag) => (
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

      {/* 底部时间轴 */}
      {selectedSession && analyzed && totalMs > 0 && (
        <div className="shrink-0 border-t border-paper-deep/30 bg-cloud/70">
          <div className="flex items-center gap-2 px-5 pt-2.5">
            <button
              type="button"
              onClick={handlePlayPause}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-bamboo text-cloud hover:bg-bamboo-light transition-colors cursor-pointer shrink-0"
              title={playing ? t("playback.pause", { defaultValue: "暂停" }) : t("playback.play", { defaultValue: "播放" })}
              aria-label={playing ? "暂停" : "播放"}
            >
              {playing ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <span className="text-[10px] text-ink-ghost font-mono tabular-nums shrink-0 w-20">
              {formatMs(currentMs ?? 0)} / {formatMs(totalMs)}
            </span>

            <div className="flex items-center gap-0.5 ml-auto">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  className={`px-1.5 py-0.5 text-[10px] rounded font-mono transition-colors cursor-pointer ${
                    speed === s
                      ? "bg-bamboo/20 text-bamboo font-medium"
                      : "text-ink-ghost hover:bg-paper-deep/20"
                  }`}
                  title={`${s}x 倍速`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {hoverKeyPoint && (
            <div className="px-5 pt-2 pb-0 animate-fade-in">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-ink/80 text-cloud text-[11px]">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
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
            <span className="text-[10px] text-ink-ghost font-mono tabular-nums shrink-0 w-10 text-right">
              {selectedSummary ? formatTimeLabel(selectedSummary.startedAt) : "00:00"}
            </span>

            <div
              ref={timelineRef}
              className="flex-1 h-7 rounded-full bg-paper-deep/30 relative overflow-visible cursor-pointer group"
              onMouseMove={handleTimelineMouseMove}
              onMouseLeave={handleTimelineMouseLeave}
              onClick={handleTimelineClick}
            >
              {analyzed.intervals.map((inv, i) => {
                const leftPct = (inv.startMs / totalMs) * 100;
                const widthPct = ((inv.endMs - inv.startMs) / totalMs) * 100;
                const isActive = activeInterval?.startMs === inv.startMs;

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

              {currentMs !== null && (
                <div
                  className={`absolute top-0 bottom-0 w-0.5 z-10 pointer-events-none ${
                    playing ? "bg-bamboo" : "bg-ink"
                  }`}
                  style={{ left: `${(currentMs / totalMs) * 100}%` }}
                />
              )}

              {analyzed.keyPoints.map((kp, i) => {
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
                      backgroundColor:
                        BEHAVIOR_COLORS[
                          analyzed.intervals.find(
                            (inv) => kp.timeMs >= inv.startMs && kp.timeMs < inv.endMs,
                          )?.type ?? "流畅创作"
                        ],
                    }}
                  />
                );
              })}
            </div>

            <span className="text-[10px] text-ink-ghost font-mono tabular-nums shrink-0 w-10">
              {selectedSummary && selectedSummary.endedAt
                ? formatTimeLabel(selectedSummary.endedAt)
                : formatMs(totalMs)}
            </span>
          </div>

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
