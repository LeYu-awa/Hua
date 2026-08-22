import { useCallback, useRef } from "react";
import { emitLive2DEmotion } from "./emotionBus";
import { emotionTagToMood, extractNewEmotionTags } from "./emotionMapping";
import { predictEmotion } from "./emotionApi";

export interface AssistantEmotionHandlers {
  /** 流式增量回调：传入本轮累计回复文本（含已渲染部分），内部增量检测新情绪标签 */
  processStreamText: (accumulatedText: string) => void;
  /** 回复最终化：若流式中从未出现情绪标签，用分类器对全文做一次预测 */
  finalize: (fullText: string) => void;
  /** 最近一次触发（含标签/分类器）的情绪标签，供 TTS 朗读使用 */
  lastEmotionLabel: () => string | undefined;
}

/**
 * 对话 → 情绪 → Live2D 的桥接 hook。
 *
 * 规则（对标 LingChat 的 producer 情绪段切分）：
 * 1. 流式过程中解析【情绪】标签段，每个标签首次出现时触发一次 Live2D 表情；
 * 2. 回复结束时若全程无标签，且 ONNX 分类器可用，则对全文预测一次情绪；
 * 3. 分类器不可用（模型未下载）时静默跳过，不影响对话流程。
 */
export function useAssistantEmotion(): AssistantEmotionHandlers {
  const handledTagsRef = useRef<Set<string>>(new Set());
  const lastLabelRef = useRef<string | undefined>(undefined);

  const processStreamText = useCallback((accumulatedText: string) => {
    const fresh = extractNewEmotionTags(accumulatedText, handledTagsRef.current);
    for (const label of fresh) {
      handledTagsRef.current.add(label);
      lastLabelRef.current = label;
      emitLive2DEmotion({
        mood: emotionTagToMood(label),
        intensity: 0.75,
        label,
        source: "tag",
      });
    }
  }, []);

  const finalize = useCallback(async (fullText: string) => {
    // 流式中已有情绪标签则不再重复预测
    if (handledTagsRef.current.size > 0) return;
    const text = fullText.trim();
    if (!text) return;

    const prediction = await predictEmotion(text);
    if (!prediction || prediction.disabled || !prediction.label) return;
    if (prediction.label === "不确定") return;

    lastLabelRef.current = prediction.label;
    emitLive2DEmotion({
      mood: emotionTagToMood(prediction.label),
      intensity: Math.min(1, Math.max(0.3, prediction.confidence * 2)),
      label: prediction.label,
      source: "classifier",
    });
  }, []);

  const lastEmotionLabel = useCallback(() => lastLabelRef.current, []);

  return { processStreamText, finalize, lastEmotionLabel };
}
