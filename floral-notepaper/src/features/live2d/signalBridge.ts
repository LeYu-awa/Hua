import type { Live2DModelController } from "./modelController";
import type { AgentUICommand } from "../../features/agent/types";

/**
 * 将 AgentUICommand 中的 live2d_signal 映射为表情/动作指令。
 *
 * Haru 模型表情 (Name → File):
 *   F01～F08 → expressions/F*.exp3.json
 *
 * Haru 模型动作分组:
 *   Idle:   haru_g_idle.motion3.json, haru_g_m15.motion3.json
 *   TapBody: haru_g_m26/m06/m20/m09.motion3.json (带音效)
 */

/** 情绪 → Haru 表情 Name 映射 */
const MOOD_TO_EXPRESSION: Record<string, string> = {
  happy: "F01",
  neutral: "F02",
  sleepy: "F03",
  excited: "F04",
  worried: "F05",
  curious: "F06",
};

/**
 * 处理 Agent 下发的单个 UICommand。
 * 如果包含 live2d_signal，则驱动模型控制器的表情/动作/气泡。
 */
export function processAgentUICommand(
  controller: Live2DModelController,
  command: AgentUICommand,
  onBubbleText?: (text: string) => void,
): void {
  if (command.type !== "live2d_signal") return;

  const { mood, animation, bubbleText, priority } = command;

  controller.triggerEmotion(mood, Math.min(1, Math.max(0.35, priority / 100)));

  // 1. 切换表情
  const expressionId = MOOD_TO_EXPRESSION[mood];
  if (expressionId) {
    controller.setExpression(expressionId).catch(() => {
      // 模型可能没有对应的表情文件，静默忽略
    });
  }

  // 2. 播放动作
  if (animation && animation !== "idle") {
    // animation 值为 motion group 名（如 "TapBody"），index 默认 0
    controller.playMotion(animation, 0);
  }

  // 3. 气泡文本
  if (bubbleText && onBubbleText) {
    onBubbleText(bubbleText);
  }
}

/**
 * 批量处理多个 AgentUICommand，按优先级排序后执行最高优先级的 live2d_signal。
 */
export function processAgentUICommands(
  controller: Live2DModelController,
  commands: AgentUICommand[],
  onBubbleText?: (text: string) => void,
): void {
  const signals = commands
    .filter((c): c is AgentUICommand & { type: "live2d_signal" } => c.type === "live2d_signal")
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  if (signals.length === 0) return;

  // 只执行最高优先级的信号
  processAgentUICommand(controller, signals[0], onBubbleText);
}
