import type { BehaviorInterval, BehaviorType, InkEvent, InkKeyPoint } from "./types";

export interface AnalyzedSession {
  durationMs: number;
  intervals: BehaviorInterval[];
  keyPoints: InkKeyPoint[];
  snapshots: Array<{ timeMs: number; content: string }>;
}

const PAUSE_THRESHOLD_MS = 5_000;
const LONG_PAUSE_MS = 10_000;
const LARGE_DELETE_LENGTH = 20;
const LARGE_PASTE_LENGTH = 50;

function applyEvent(content: string, event: InkEvent): string {
  if (event.type === "snapshot") {
    return event.text ?? "";
  }
  if (event.type === "insert" && event.text != null) {
    const index = Math.min(Math.max(event.index, 0), content.length);
    return content.slice(0, index) + event.text + content.slice(index);
  }
  if (event.type === "paste" && event.text != null) {
    const index = Math.min(Math.max(event.index, 0), content.length);
    return content.slice(0, index) + event.text + content.slice(index);
  }
  if (event.type === "delete" && event.length != null) {
    const index = Math.min(Math.max(event.index, 0), content.length);
    return content.slice(0, index) + content.slice(index + event.length);
  }
  return content;
}

export function analyzeInkSession(events: InkEvent[]): AnalyzedSession {
  if (events.length === 0) {
    return { durationMs: 0, intervals: [], keyPoints: [], snapshots: [] };
  }

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const startTime = sorted[0].timestamp;
  const endTime = sorted[sorted.length - 1].timestamp;
  const durationMs = Math.max(0, endTime - startTime);

  // 重建内容快照
  let content = "";
  const snapshots: Array<{ timeMs: number; content: string }> = [];
  for (const event of sorted) {
    content = applyEvent(content, event);
    if (event.type !== "cursor" && event.type !== "select") {
      snapshots.push({ timeMs: event.timestamp - startTime, content });
    }
  }

  // 行为区间
  const intervals: BehaviorInterval[] = [];
  let currentIntervalStart = startTime;
  let lastEventTime = startTime;
  let insertCount = 0;
  let deleteCount = 0;
  let cursorCount = 0;

  function closeInterval(endMs: number, type: BehaviorType) {
    if (endMs > currentIntervalStart) {
      intervals.push({
        startMs: currentIntervalStart - startTime,
        endMs: endMs - startTime,
        type,
      });
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i];
    const gap = event.timestamp - lastEventTime;

    if (gap > PAUSE_THRESHOLD_MS) {
      // 停顿前关闭当前区间
      const prevType = decideIntervalType(insertCount, deleteCount, cursorCount);
      closeInterval(lastEventTime, prevType);
      // 停顿区间
      closeInterval(event.timestamp, "停顿思考");
      currentIntervalStart = event.timestamp;
      insertCount = 0;
      deleteCount = 0;
      cursorCount = 0;
    }

    if (event.type === "insert" || event.type === "paste") insertCount++;
    if (event.type === "delete") deleteCount++;
    if (event.type === "cursor" || event.type === "select") cursorCount++;

    lastEventTime = event.timestamp;
  }

  const finalType = decideIntervalType(insertCount, deleteCount, cursorCount);
  closeInterval(endTime, finalType);

  // 关键帧
  const keyPoints: InkKeyPoint[] = [];
  let previousTime = startTime;
  let inPause = false;

  for (const event of sorted) {
    const gap = event.timestamp - previousTime;

    // 长停顿后恢复写作
    if (gap >= LONG_PAUSE_MS && !inPause) {
      keyPoints.push({
        timeMs: previousTime - startTime,
        type: "pause",
        description: `停顿 ${Math.round(gap / 1000)} 秒`,
      });
      inPause = true;
    }

    if (event.type === "paste" && event.text) {
      keyPoints.push({
        timeMs: event.timestamp - startTime,
        type: "paste",
        description:
          event.text.length > LARGE_PASTE_LENGTH
            ? `粘贴了一大段内容（${event.text.length} 字）`
            : `粘贴了 "${event.text.slice(0, 20)}${event.text.length > 20 ? "…" : ""}"`,
      });
      inPause = false;
    }

    if (event.type === "delete" && (event.length ?? 0) >= LARGE_DELETE_LENGTH) {
      keyPoints.push({
        timeMs: event.timestamp - startTime,
        type: "delete",
        description: `删除了 ${event.length} 个字符`,
      });
      inPause = false;
    }

    if (event.type === "insert" || event.type === "delete" || event.type === "paste") {
      inPause = false;
    }

    previousTime = event.timestamp;
  }

  return { durationMs, intervals, keyPoints, snapshots };
}

function decideIntervalType(
  insertCount: number,
  deleteCount: number,
  cursorCount: number,
): BehaviorType {
  const editCount = insertCount + deleteCount;
  if (editCount === 0) return "停顿思考";
  const deleteRatio = deleteCount / (editCount || 1);
  if (deleteRatio > 0.5) return "纠结修改";
  if (cursorCount > editCount * 2) return "润色优化";
  if (deleteCount > 0 && insertCount > deleteCount * 2) return "结构调整";
  return "流畅创作";
}

export function getContentAtTimeMs(
  snapshots: Array<{ timeMs: number; content: string }>,
  timeMs: number,
): string {
  if (snapshots.length === 0) return "";
  if (timeMs <= snapshots[0].timeMs) return snapshots[0].content;
  if (timeMs >= snapshots[snapshots.length - 1].timeMs) {
    return snapshots[snapshots.length - 1].content;
  }

  for (let i = 1; i < snapshots.length; i++) {
    if (snapshots[i].timeMs > timeMs) {
      return snapshots[i - 1].content;
    }
  }
  return snapshots[snapshots.length - 1].content;
}
