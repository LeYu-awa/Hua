import type { SoullinkLocalMood } from "./soullinkLocalEngine";

/**
 * LingChat 19 类情绪标签 → 花笺 6 元 SoullinkLocalMood 的映射。
 *
 * 源标签（LingChat `utils/prompt.rs`，19 类）：
 *   慌张、担心、尴尬、紧张、高兴、自信、害怕、害羞、认真、
 *   生气、无语、厌恶、疑惑、难为情、惊讶、情动、哭泣、调皮、平静
 *
 * 花笺 6 元情绪：happy / neutral / sleepy / excited / worried / curious
 * 映射原则：valence-arousal 相近归组；无对应组的负面情绪归到 worried/neutral。
 */
const TAG_TO_MOOD: Record<string, SoullinkLocalMood> = {
  高兴: "happy",
  自信: "happy",
  情动: "happy",
  调皮: "excited",
  惊讶: "excited",
  生气: "excited",
  慌张: "worried",
  担心: "worried",
  紧张: "worried",
  害怕: "worried",
  哭泣: "worried",
  疑惑: "curious",
  认真: "curious",
  尴尬: "curious",
  害羞: "curious",
  难为情: "curious",
  厌恶: "neutral",
  无语: "neutral",
  平静: "neutral",
};

const DEFAULT_MOOD: SoullinkLocalMood = "neutral";

export function isEmotionTag(label: string): boolean {
  return Object.prototype.hasOwnProperty.call(TAG_TO_MOOD, label.trim());
}

/** 中文情绪标签 → 花笺 mood（未知标签回退 neutral） */
export function emotionTagToMood(label: string): SoullinkLocalMood {
  const key = label.trim();
  return TAG_TO_MOOD[key] ?? DEFAULT_MOOD;
}

export interface EmotionSegment {
  /** 情绪标签（无标签时为 undefined） */
  label?: string;
  /** 该段正文 */
  text: string;
}

/**
 * 把带【情绪】标注的文本切成段落：
 *   【开心】你好呀！【难过】今天有点累。
 * → [{label:"开心", text:"你好呀！"}, {label:"难过", text:"今天有点累。"}]
 *
 * 移植自 LingChat `message_system/producer.rs` 的切分规则。
 */
export function splitEmotionSegments(text: string): EmotionSegment[] {
  const segments: EmotionSegment[] = [];
  const pattern = /【([^】\n]+)】/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const label = match[1].trim();
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) {
      segments.push({ text: before.trim() });
    }
    const bodyStart = match.index + match[0].length;
    const nextTag = text.indexOf("【", bodyStart);
    const bodyEnd = nextTag === -1 ? text.length : nextTag;
    const body = text.slice(bodyStart, bodyEnd).trim();
    if (body) {
      segments.push({ label, text: body });
    } else {
      segments.push({ label, text: "" });
    }
    lastIndex = bodyEnd;
  }

  const tail = text.slice(lastIndex).trim();
  if (tail) {
    segments.push({ text: tail });
  }
  return segments;
}

/**
 * 流式场景：从已累积文本中提取尚未处理过的【情绪】标签（用于增量触发 Live2D 表情）。
 * 返回新出现的标签列表（保持出现顺序）。
 */
export function extractNewEmotionTags(
  accumulated: string,
  handledTags: ReadonlySet<string>,
): string[] {
  const tags: string[] = [];
  const pattern = /【([^】\n]+)】/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(accumulated)) !== null) {
    const label = match[1].trim();
    if (!isEmotionTag(label)) continue;
    if (handledTags.has(label)) continue;
    tags.push(label);
    // 同一标签只触发一次：通过 handledTags 由调用方去重
    // （此处只收集，不修改 set，避免循环中读到已更新状态）
  }
  return tags;
}
