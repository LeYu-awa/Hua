import { useEffect, useMemo, useState } from "react";
import { listNotes } from "../features/notes/api";
import type { NoteMetadata } from "../features/notes/types";
import { HeatmapView } from "./HeatmapView";
import type { HeatmapCellData } from "./HeatmapView";

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DashboardPage() {
  const [notes, setNotes] = useState<NoteMetadata[]>([]);

  useEffect(() => {
    listNotes()
      .then(setNotes)
      .catch(() => {});
  }, []);

  const totalNotes = notes.length;
  const totalWords = notes.reduce((s, n) => s + n.wordCount, 0);

  const heatmapData: HeatmapCellData[] = useMemo(() => {
    const countByDate = new Map<string, number>();
    for (const note of notes) {
      const d = new Date(note.updatedAt);
      const key = formatDate(d);
      countByDate.set(key, (countByDate.get(key) ?? 0) + 1);
    }
    const result: HeatmapCellData[] = [];
    for (const [date, count] of countByDate) {
      result.push({ date, count });
    }
    return result;
  }, [notes]);

  const activeDays = heatmapData.length;
  const maxStreak = useMemo(() => {
    const dates = new Set(heatmapData.map((d) => d.date));
    let max = 0;
    let current = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setFullYear(start.getFullYear() - 1);
    const cursor = new Date(start);
    while (cursor <= today) {
      const key = formatDate(cursor);
      if (dates.has(key)) {
        current++;
        if (current > max) max = current;
      } else {
        current = 0;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return max;
  }, [heatmapData]);

  const recentNotes = useMemo(() => {
    return [...notes]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 8);
  }, [notes]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper">
      <div className="flex-1 overflow-y-auto">
        <div className="h-full px-6 py-3 space-y-4">
          <div className="rounded-2xl border border-paper-deep/30 bg-cloud p-6 flex gap-8">
            <div className="shrink-0">
              <h3 className="text-[15px] font-display font-bold text-ink mb-1">概览</h3>
              <p className="text-[11px] text-ink-ghost mb-5">
                {totalNotes} 篇笔记 · {totalWords.toLocaleString()} 字
              </p>
              <div className="flex gap-6">
                <div>
                  <div className="text-[28px] font-display font-bold text-bamboo">{totalNotes}</div>
                  <div className="text-[11px] text-ink-faint mt-0.5">笔记</div>
                </div>
                <div>
                  <div className="text-[28px] font-display font-bold text-bamboo">{activeDays}</div>
                  <div className="text-[11px] text-ink-faint mt-0.5">活跃天数</div>
                </div>
                <div>
                  <div className="text-[28px] font-display font-bold text-bamboo">{maxStreak}</div>
                  <div className="text-[11px] text-ink-faint mt-0.5">最长连续</div>
                </div>
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <label className="block text-[12px] font-medium text-ink-soft mb-2">
                笔记活动热力图
              </label>
              <HeatmapView data={heatmapData} />
            </div>
          </div>

          <div className="rounded-2xl border border-paper-deep/30 bg-cloud p-6">
            <h3 className="text-[13px] font-display font-semibold text-ink-soft mb-3">最近更新</h3>
            {recentNotes.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-ink-ghost">暂无笔记</div>
            ) : (
              <div className="space-y-1">
                {recentNotes.map((note) => (
                  <div
                    key={note.id}
                    className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-paper-warm/70 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-ink-soft truncate">
                        {note.title || note.fileName}
                      </div>
                      <div className="text-[10px] text-ink-ghost truncate mt-0.5">
                        {note.preview}
                      </div>
                    </div>
                    <div className="text-[9px] text-ink-ghost font-mono ml-3 shrink-0">
                      {formatDate(new Date(note.updatedAt))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="h-8" />
      </div>
    </div>
  );
}
