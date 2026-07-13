// 回放关键帧标注（issue 场景十一）
// 把 ink 分析出的行为区间/关键帧转成回放时间轴上的 replay_marker，
// 并可选用 LLM 对内容快照做语义关键帧补强（主题切换、方案收敛等）。
// 规则部分确定性、可降级；LLM 部分失败时跳过，不影响规则标记。

import { callChatCompletion, extractJsonArray } from "../cowrite/coWriteAI";
import type { ProviderConfig } from "../settings/types";
import type { AnalyzedSession } from "../ink/analyze";
import type { AgentUICommand, ReplayMarkerType } from "./signalQueue";

export interface ReplayMarker {
  /** 相对 session 起点的毫秒偏移 */
  time: number;
  markerType: ReplayMarkerType;
  title: string;
  summary: string;
}

/** 转成 SignalQueue 可分发的 AgentUICommand */
export function toReplayCommand(marker: ReplayMarker): AgentUICommand {
  return {
    type: "replay_marker",
    time: marker.time,
    markerType: marker.markerType,
    title: marker.title,
    summary: marker.summary,
  };
}

const MIN_FLOW_MS = 3 * 60_000; // 只标记较长的流畅期，避免时间轴过载
const MIN_STUCK_MS = 30_000; // 只标记较长的停顿

/**
 * 基于行为区间生成确定性回放标记（flow / stuck）。
 * 不依赖 AI，始终可用。
 */
export function ruleBasedMarkers(session: AnalyzedSession): ReplayMarker[] {
  const markers: ReplayMarker[] = [];
  for (const interval of session.intervals) {
    const durationMs = interval.endMs - interval.startMs;
    if (interval.type === "流畅创作" && durationMs >= MIN_FLOW_MS) {
      markers.push({
        time: interval.startMs,
        markerType: "flow",
        title: "进入状态",
        summary: `连续流畅写作约 ${Math.round(durationMs / 60_000)} 分钟`,
      });
    } else if (interval.type === "停顿思考" && durationMs >= MIN_STUCK_MS) {
      markers.push({
        time: interval.startMs,
        markerType: "stuck",
        title: "停顿点",
        summary: `停顿约 ${Math.round(durationMs / 1000)} 秒`,
      });
    }
  }
  return markers;
}

interface SemanticMarkerRaw {
  time?: number;
  title?: string;
  summary?: string;
}

/** 从快照序列均匀采样若干条，控制送入 LLM 的体量 */
function sampleSnapshots(
  snapshots: AnalyzedSession["snapshots"],
  maxSamples: number,
): AnalyzedSession["snapshots"] {
  if (snapshots.length <= maxSamples) return snapshots;
  const step = snapshots.length / maxSamples;
  const result: AnalyzedSession["snapshots"] = [];
  for (let i = 0; i < maxSamples; i++) {
    result.push(snapshots[Math.floor(i * step)]);
  }
  return result;
}

/**
 * 用 LLM 从内容快照中识别语义关键帧（主题切换、方案收敛等），标为 flow。
 * 无供应商或失败时返回空数组（不影响规则标记）。
 */
export async function semanticMarkers(
  snapshots: AnalyzedSession["snapshots"],
  providers: ProviderConfig[],
  maxSamples = 8,
): Promise<ReplayMarker[]> {
  if (snapshots.length < 2 || providers.length === 0) return [];
  const sampled = sampleSnapshots(snapshots, maxSamples);

  const prompt = `你在分析一段写作过程的内容快照，请找出 2-4 个"内容语义发生明显转折"的时间点
（例如主题切换、方案收敛、结构重组）。语气中性、不评价。
只输出 JSON 数组：
[{"time": 毫秒偏移, "title": "简短标题", "summary": "一句话说明"}]

快照序列（time 为毫秒偏移，content 为该时刻内容摘要）：
${sampled.map((s) => `- time: ${s.timeMs}\n  content: ${s.content.slice(0, 150)}`).join("\n")}`;

  try {
    const text = await callChatCompletion(
      providers,
      [
        { role: "system", content: "你是一个中性、不评价用户的写作过程分析助手。" },
        { role: "user", content: prompt },
      ],
      0.5,
    );
    const raw = extractJsonArray<SemanticMarkerRaw>(text);
    return raw
      .filter((r) => typeof r.time === "number" && r.title)
      .slice(0, 4)
      .map((r) => ({
        time: r.time as number,
        markerType: "flow" as ReplayMarkerType,
        title: (r.title as string).slice(0, 30),
        summary: (r.summary ?? "").slice(0, 80),
      }));
  } catch {
    return [];
  }
}

/** 按时间去重（同一 time 保留先出现的），排序 */
function dedupeAndSort(markers: ReplayMarker[]): ReplayMarker[] {
  const seen = new Set<number>();
  const result: ReplayMarker[] = [];
  for (const m of markers.slice().sort((a, b) => a.time - b.time)) {
    // 3 秒内视为同一时刻
    const bucket = Math.round(m.time / 3000);
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    result.push(m);
  }
  return result;
}

/**
 * 生成回放标记：规则标记始终产出，useLLM 时叠加语义标记。
 */
export async function generateReplayMarkers(
  session: AnalyzedSession,
  providers: ProviderConfig[],
  options: { useLLM?: boolean } = {},
): Promise<ReplayMarker[]> {
  const rule = ruleBasedMarkers(session);
  if (!options.useLLM) return dedupeAndSort(rule);
  const semantic = await semanticMarkers(session.snapshots, providers);
  return dedupeAndSort([...rule, ...semantic]);
}
