import type { InkEvent } from "../ink/types";
import { clamp, weightedScore } from "./ruleEngine";

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

// ─── 焦虑指数 + 主动干预（issue 场景四） ───

/**
 * 个人写作基线：各行为指标的"正常"水平。
 * 阈值因人而异，避免对慢工细活的用户误判。
 * 注：撤销、窗口切换事件当前事件流未采集，预留在权重中按 0 计。
 */
export interface WritingBaseline {
  /** 基线删改率（删除量 / 总编辑量） */
  deleteRatio: number;
  /** 基线光标/选择操作频率（次/分钟），近似"反复修改" */
  cursorPerMin: number;
  /** 基线停顿频率（次/分钟） */
  pausePerMin: number;
}

/** 通用默认基线，用户档案建立后应替换为个人基线 */
export const DEFAULT_BASELINE: WritingBaseline = {
  deleteRatio: 0.25,
  cursorPerMin: 4,
  pausePerMin: 1.5,
};

/** 焦虑指数各指标权重（和为 1）。撤销/切换缺失，权重并入删改与光标。 */
const ANXIETY_WEIGHTS = {
  deleteRatio: 0.4,
  cursor: 0.3,
  pause: 0.3,
};

export interface AnxietyMetrics {
  deleteRatio: number;
  cursorPerMin: number;
  pausePerMin: number;
}

export interface AnxietyAssessment {
  /** 焦虑指数：相对个人基线的加权倍数，1 表示与基线持平 */
  index: number;
  /** 是否建议干预（未含冷却，冷却由调用方用 CooldownTracker 控制） */
  shouldIntervene: boolean;
  /** 当前窗口内的原始指标 */
  metrics: AnxietyMetrics;
}

/**
 * 基于最近滑动窗口的行为，计算相对个人基线的焦虑指数。
 * 纯函数，便于测试；干预冷却由调用方结合 CooldownTracker 处理。
 *
 * @param windowMs 滑动窗口，默认 5 分钟
 * @param interveneThreshold 触发干预的指数阈值，默认 2.0（达到基线 2 倍）
 */
export function assessAnxiety(
  events: InkEvent[],
  baseline: WritingBaseline = DEFAULT_BASELINE,
  now = Date.now(),
  windowMs = 300_000,
  interveneThreshold = 2.0,
): AnxietyAssessment {
  const from = now - windowMs;
  const recent = events.filter((e) => e.timestamp >= from && e.timestamp <= now);
  const minutes = windowMs / 60_000;

  if (recent.length === 0) {
    return {
      index: 0,
      shouldIntervene: false,
      metrics: { deleteRatio: 0, cursorPerMin: 0, pausePerMin: 0 },
    };
  }

  let insertCount = 0;
  let deleteCount = 0;
  let cursorCount = 0;
  let pauseCount = 0;
  let previousTime = recent[0].timestamp;
  for (const event of recent) {
    if (event.type === "insert" || event.type === "paste") insertCount++;
    if (event.type === "delete") deleteCount += event.length ?? 1;
    if (event.type === "cursor" || event.type === "select") cursorCount++;
    if (event.timestamp - previousTime > 5_000) pauseCount++;
    previousTime = event.timestamp;
  }

  const totalEdit = insertCount + deleteCount;
  const metrics: AnxietyMetrics = {
    deleteRatio: totalEdit > 0 ? deleteCount / totalEdit : 0,
    cursorPerMin: cursorCount / minutes,
    pausePerMin: pauseCount / minutes,
  };

  // 每个指标相对基线的比值，基线为 0 时按较小正数兜底
  const ratios = {
    deleteRatio: metrics.deleteRatio / Math.max(baseline.deleteRatio, 0.01),
    cursor: metrics.cursorPerMin / Math.max(baseline.cursorPerMin, 0.1),
    pause: metrics.pausePerMin / Math.max(baseline.pausePerMin, 0.1),
  };

  const index = clamp(weightedScore(ratios, ANXIETY_WEIGHTS), 0, 10);

  return {
    index,
    shouldIntervene: index >= interveneThreshold,
    metrics,
  };
}

