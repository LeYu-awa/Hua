import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownPreview } from "../markdown/MarkdownPreview";
import {
  deleteDiaryEntry,
  getDiaryEntry,
  listDiaryEntries,
  updateDiaryEntry,
  type DiaryEntry,
  type DiaryEntrySummary,
} from "./api";
import { dispatchOpenChatTask, onDiaryCreated } from "./diaryEvents";

/** 日记时间线页（diary S1）：统计 + 按日分组 + 详情/编辑/删除 + 跳回来源对话 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayKey(): string {
  return dateKey(new Date());
}

function yesterdayKey(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return dateKey(date);
}

function weekStartKey(): string {
  const date = new Date();
  const day = date.getDay() === 0 ? 7 : date.getDay();
  date.setDate(date.getDate() - (day - 1));
  return dateKey(date);
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface DiaryGroup {
  label: string;
  items: DiaryEntrySummary[];
}

export function DiaryPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<DiaryEntrySummary[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<DiaryEntry | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    listDiaryEntries()
      .then(setEntries)
      .catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    return onDiaryCreated(reload);
  }, [reload]);

  const stats = useMemo(() => {
    const today = todayKey();
    const weekStart = weekStartKey();
    let todayCount = 0;
    let weekCount = 0;
    let totalWords = 0;
    for (const entry of entries) {
      if (entry.entryDate === today) todayCount += 1;
      if (entry.entryDate >= weekStart) weekCount += 1;
      totalWords += entry.wordCount;
    }
    return { todayCount, weekCount, total: entries.length, totalWords };
  }, [entries]);

  const groups = useMemo<DiaryGroup[]>(() => {
    const today = todayKey();
    const yesterday = yesterdayKey();
    const result: DiaryGroup[] = [];
    for (const entry of entries) {
      const label =
        entry.entryDate === today
          ? t("diary.today", { defaultValue: "今天" })
          : entry.entryDate === yesterday
            ? t("diary.yesterday", { defaultValue: "昨天" })
            : t("diary.earlier", { defaultValue: "更早" });
      const group = result.find((item) => item.label === label);
      if (group) {
        group.items.push(entry);
      } else {
        result.push({ label, items: [entry] });
      }
    }
    return result;
  }, [entries, t]);

  const toggleExpand = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        setExpandedDetail(null);
        return;
      }
      try {
        const detail = await getDiaryEntry(id);
        setExpandedDetail(detail);
        setExpandedId(id);
      } catch {
        // 读取失败时静默收起
        setExpandedId(null);
        setExpandedDetail(null);
      }
    },
    [expandedId],
  );

  const startEdit = useCallback((entry: DiaryEntry) => {
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditContent(entry.content);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await updateDiaryEntry(editingId, { title: editTitle, content: editContent });
      setEditingId(null);
      setEditTitle("");
      setEditContent("");
      reload();
    } catch {
      // 保存失败保留编辑态，用户可重试
    } finally {
      setSaving(false);
    }
  }, [editingId, editTitle, editContent, reload]);

  const removeEntry = useCallback(
    async (id: string) => {
      if (!window.confirm(t("diary.deleteConfirm", { defaultValue: "确定删除这篇日记吗？" }))) {
        return;
      }
      try {
        await deleteDiaryEntry(id);
        if (expandedId === id) {
          setExpandedId(null);
          setExpandedDetail(null);
        }
        reload();
      } catch {
        // ignore
      }
    },
    [expandedId, reload, t],
  );

  const openConversation = useCallback((conversationId?: string | null) => {
    if (conversationId) dispatchOpenChatTask(conversationId);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper">
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full px-4 py-3 space-y-4 sm:px-6">
          {/* 统计条 */}
          <div className="rounded-2xl border border-paper-deep/30 bg-cloud p-5">
            <h3 className="text-[15px] font-display font-bold text-ink mb-1">
              {t("diary.title", { defaultValue: "日记" })}
            </h3>
            <p className="text-[11px] text-ink-ghost mb-4">
              {t("diary.subtitle", {
                defaultValue: "每天和花灵聊聊，记录就这样慢慢长出来。",
              })}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-3 text-[12px]">
              <div className="flex items-baseline gap-1.5">
                <span className="font-display font-bold text-ink text-[20px]">
                  {stats.todayCount}
                </span>
                <span className="text-ink-ghost">
                  {t("diary.todayStat", { defaultValue: "今日" })}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display font-bold text-ink text-[20px]">
                  {stats.weekCount}
                </span>
                <span className="text-ink-ghost">
                  {t("diary.weekStat", { defaultValue: "本周" })}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display font-bold text-ink text-[20px]">{stats.total}</span>
                <span className="text-ink-ghost">
                  {t("diary.totalStat", { defaultValue: "累计" })}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display font-bold text-ink text-[20px]">
                  {stats.totalWords.toLocaleString()}
                </span>
                <span className="text-ink-ghost">
                  {t("diary.wordsStat", { defaultValue: "字" })}
                </span>
              </div>
            </div>
          </div>

          {/* 时间线 */}
          {groups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-paper-deep/30 p-8 text-center">
              <div className="text-[13px] text-ink-soft mb-1">
                {t("diary.empty", {
                  defaultValue: "今天还没记录，去和花灵聊聊今天的想法吧",
                })}
              </div>
              <button
                type="button"
                onClick={() => dispatchOpenChatTask("")}
                className="mt-3 rounded-lg bg-ink-soft px-3 py-1.5 text-[12px] font-medium text-paper hover:opacity-90 cursor-pointer"
              >
                {t("diary.goChat", { defaultValue: "去对话" })}
              </button>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="space-y-2">
                <div className="text-[11px] font-medium text-ink-faint uppercase tracking-wider px-1">
                  {group.label}
                </div>
                {group.items.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  const isEditing = editingId === entry.id;
                  const detail = isExpanded ? expandedDetail : null;
                  return (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-paper-deep/20 bg-cloud/60 p-3"
                    >
                      {isEditing && detail ? (
                        <div className="space-y-2">
                          <input
                            value={editTitle}
                            onChange={(event) => setEditTitle(event.target.value)}
                            className="w-full rounded-lg border border-paper-deep/20 bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink-ghost/40"
                            placeholder={t("diary.titlePlaceholder", { defaultValue: "标题" })}
                          />
                          <textarea
                            value={editContent}
                            onChange={(event) => setEditContent(event.target.value)}
                            rows={8}
                            className="w-full resize-y rounded-lg border border-paper-deep/20 bg-paper px-2.5 py-1.5 text-[13px] text-ink leading-relaxed outline-none focus:border-ink-ghost/40"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void saveEdit()}
                              disabled={saving}
                              className="rounded-lg bg-ink-soft px-3 py-1 text-[12px] font-medium text-paper hover:opacity-90 disabled:opacity-50 cursor-pointer"
                            >
                              {saving
                                ? t("diary.saving", { defaultValue: "保存中…" })
                                : t("diary.save", { defaultValue: "保存" })}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-lg border border-paper-deep/20 px-3 py-1 text-[12px] text-ink-ghost hover:bg-paper-warm/40 cursor-pointer"
                            >
                              {t("common.cancel", { defaultValue: "取消" })}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void toggleExpand(entry.id)}
                            className="w-full text-left cursor-pointer"
                          >
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="text-[13px] font-medium text-ink truncate">
                                {entry.title}
                              </span>
                              <span className="shrink-0 text-[10px] text-ink-ghost/70">
                                {formatTime(entry.createdAt)} · {entry.wordCount}{" "}
                                {t("diary.wordsUnit", { defaultValue: "字" })}
                              </span>
                            </div>
                            {!isExpanded && (
                              <div className="mt-1 text-[11px] text-ink-ghost/80 leading-relaxed line-clamp-2">
                                {entry.preview}
                              </div>
                            )}
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {entry.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full bg-paper-deep/20 px-2 py-0.5 text-[10px] text-ink-faint"
                                >
                                  #{tag}
                                </span>
                              ))}
                              {entry.mood && (
                                <span className="rounded-full bg-paper-deep/20 px-2 py-0.5 text-[10px] text-ink-faint">
                                  {entry.mood}
                                </span>
                              )}
                            </div>
                          </button>

                          {isExpanded && detail && (
                            <div className="mt-3 border-t border-paper-deep/20 pt-3">
                              <div className="text-[13px] text-ink leading-relaxed">
                                <MarkdownPreview content={detail.content} />
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEdit(detail)}
                                  className="rounded-lg border border-paper-deep/20 px-2.5 py-1 text-[11px] text-ink-soft hover:bg-paper-warm/40 cursor-pointer"
                                >
                                  {t("diary.edit", { defaultValue: "编辑" })}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removeEntry(entry.id)}
                                  className="rounded-lg border border-paper-deep/20 px-2.5 py-1 text-[11px] text-ink-ghost hover:bg-paper-warm/40 cursor-pointer"
                                >
                                  {t("diary.delete", { defaultValue: "删除" })}
                                </button>
                                {detail.conversationId && (
                                  <button
                                    type="button"
                                    onClick={() => openConversation(detail.conversationId)}
                                    className="rounded-lg border border-paper-deep/20 px-2.5 py-1 text-[11px] text-ink-soft hover:bg-paper-warm/40 cursor-pointer"
                                  >
                                    {t("diary.sourceChat", { defaultValue: "查看来源对话" })}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
