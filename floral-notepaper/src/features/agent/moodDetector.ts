import type { InkEvent } from "../ink/types";

export type WritingMood = "流畅" | "纠结" | "停顿" | "平静";

export interface MoodSnapshot {
  mood: WritingMood;
  /** 0-1，情绪强度 */
  intensity: number;
  /** 给状态栏/精灵显示的微文案 */
  label: string;
}

interface RecentEvents {
  insertCount: number;
  deleteCount: number;
  cursorCount: number;
  pauseCount: number;
  lastEventAt: number;
}

/**
 * 基于最近事件流推断当前写作情绪。
 * 只返回状态标签，不评价用户。
 */
export function detectMood(events: InkEvent[], now = Date.now()): MoodSnapshot {
  if (events.length === 0) {
    return { mood: "平静", intensity: 0, label: "准备开始" };
  }

  const windowMs = 60_000; // 只看最近 1 分钟
  const recent = events.filter((e) => now - e.timestamp <= windowMs);

  if (recent.length === 0) {
    const last = events[events.length - 1];
    const idleMs = now - last.timestamp;
    if (idleMs > 30_000) {
      return { mood: "停顿", intensity: Math.min(1, idleMs / 120_000), label: "休息一下也可以" };
    }
    return { mood: "平静", intensity: 0.2, label: "慢慢来" };
  }

  const stats: RecentEvents = {
    insertCount: 0,
    deleteCount: 0,
    cursorCount: 0,
    pauseCount: 0,
    lastEventAt: recent[recent.length - 1]?.timestamp ?? now,
  };

  let previousTime = recent[0]?.timestamp ?? now;
  for (const event of recent) {
    if (event.type === "insert" || event.type === "paste") stats.insertCount++;
    if (event.type === "delete") stats.deleteCount += event.length ?? 1;
    if (event.type === "cursor" || event.type === "select") stats.cursorCount++;
    if (event.timestamp - previousTime > 5_000) stats.pauseCount++;
    previousTime = event.timestamp;
  }

  const totalEdit = stats.insertCount + stats.deleteCount;
  const deleteRatio = totalEdit > 0 ? stats.deleteCount / totalEdit : 0;
  const idleMs = now - stats.lastEventAt;

  if (idleMs > 20_000) {
    return { mood: "停顿", intensity: Math.min(1, idleMs / 60_000), label: "停顿一下" };
  }

  if (stats.insertCount > 5 && deleteRatio < 0.2) {
    return {
      mood: "流畅",
      intensity: 0.7 + Math.min(0.3, stats.insertCount / 20),
      label: "状态不错",
    };
  }

  if (deleteRatio > 0.4 || stats.cursorCount > stats.insertCount * 2) {
    return { mood: "纠结", intensity: Math.min(1, deleteRatio + 0.3), label: "在反复打磨" };
  }

  return { mood: "平静", intensity: 0.3, label: "稳定输出中" };
}

export function moodColor(mood: WritingMood): string {
  switch (mood) {
    case "流畅":
      return "#2a6a42";
    case "纠结":
      return "#b8860b";
    case "停顿":
      return "#999999";
    case "平静":
    default:
      return "#4a8db7";
  }
}
