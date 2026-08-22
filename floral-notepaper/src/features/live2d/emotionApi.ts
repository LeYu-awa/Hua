import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * 情绪识别 API（对应后端 services::emotion 命令）。
 * 移植自 LingChat（MIT）：ONNX 19 类情绪分类，驱动 Live2D 表情。
 */

/** 情绪分类结果（后端 EmotionPrediction） */
export interface EmotionPredictionDto {
  label: string;
  confidence: number;
  top3: [string, number][];
  disabled: boolean;
  warning?: string | null;
}

export interface EmotionStatusDto {
  installed: boolean;
  loaded: boolean;
  label_count: number;
}

export interface EmotionDownloadResultDto {
  file: string;
  bytes: number;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 状态：模型是否已安装 / 已加载 / 标签数 */
export async function emotionStatus(): Promise<EmotionStatusDto | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<EmotionStatusDto>("emotion_status");
  } catch (error) {
    console.warn("[emotion] 读取状态失败", error);
    return null;
  }
}

/**
 * 预测文本情绪。模型未安装时返回 passthrough（label=输入文本, disabled=true）。
 * threshold：置信度阈值（默认 0.08），低于阈值返回 "不确定"。
 */
export async function predictEmotion(
  text: string,
  threshold?: number,
): Promise<EmotionPredictionDto | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<EmotionPredictionDto>("emotion_predict", {
      text,
      threshold: threshold ?? null,
    });
  } catch (error) {
    console.warn("[emotion] 预测失败", error);
    return null;
  }
}

/** 下载 19 类情绪模型资产（model.onnx + vocab.txt + label_mapping.json + config.json） */
export async function downloadEmotionModels(): Promise<EmotionDownloadResultDto[]> {
  return invoke<EmotionDownloadResultDto[]>("emotion_download");
}

/** 订阅模型下载完成事件 */
export async function onEmotionDownloadComplete(
  callback: () => void,
): Promise<UnlistenFn> {
  return listen("emotion://download-complete", () => callback());
}
