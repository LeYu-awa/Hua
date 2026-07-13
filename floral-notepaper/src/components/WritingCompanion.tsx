import { useEffect, useMemo, useRef, useState } from "react";

export interface WritingCompanionProps {
  /** Agent 总开关 */
  enabled: boolean;
  /** 停顿触发阈值（毫秒） */
  thresholdMs: number;
  /** 最近一次活动时间戳 */
  lastActivityAt: number;
  /** 是否强制隐藏（例如设置页打开时） */
  hidden?: boolean;
  /** 提示文案池 */
  messages?: string[];
  /** 提示出现时回调 */
  onNudge?: () => void;
  /** 用户点击关闭/忽略时回调 */
  onDismiss?: () => void;
  /**
   * 焦虑关怀提示（场景四）：非空时优先于停顿提示立即显示，语气为"关心"而非"评价"。
   * 由外部的 assessAnxiety + 冷却控制何时给出。
   */
  alertMessage?: string | null;
  /** 用户忽略焦虑关怀提示时回调 */
  onAlertDismiss?: () => void;
  /** 位置 */
  position?: "bottom-right" | "bottom-left";
}

const DEFAULT_MESSAGES = [
  "慢慢来，我在这儿。",
  "需要一点空间吗？",
  "休息一下也可以。",
  "不用着急，先喝口水。",
  "卡住了？先写别的段落也行。",
];

function randomMessage(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * 写作陪伴精灵：在用户停顿超过阈值后，在屏幕角落显示一句温柔、不打扰的提示。
 * 继续输入后自动消失，所有提示可忽略。
 */
export function WritingCompanion({
  enabled,
  thresholdMs,
  lastActivityAt,
  hidden = false,
  messages = DEFAULT_MESSAGES,
  onNudge,
  onDismiss,
  alertMessage = null,
  onAlertDismiss,
  position = "bottom-right",
}: WritingCompanionProps) {
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [nudgeMessage, setNudgeMessage] = useState<string>(() => randomMessage(messages));
  const [visible, setVisible] = useState(false);
  const [dismissedAlert, setDismissedAlert] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgedRef = useRef(false);

  const positionClass = useMemo(() => {
    switch (position) {
      case "bottom-left":
        return "left-6";
      case "bottom-right":
      default:
        return "right-6";
    }
  }, [position]);

  useEffect(() => {
    if (!enabled || hidden) {
      setVisible(false);
      return;
    }

    // 用户恢复活动时，隐藏提示并允许下一次再次触发
    if (visible) {
      setVisible(false);
      nudgedRef.current = false;
    }

    // 如果用户之前忽略过，且在忽略后还没有新的活动，不重复显示
    if (dismissedAt !== null && lastActivityAt <= dismissedAt) {
      return;
    }
    setDismissedAt(null);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      if (!enabled || hidden) return;
      setNudgeMessage(randomMessage(messages));
      setVisible(true);
      if (!nudgedRef.current) {
        nudgedRef.current = true;
        onNudge?.();
      }
    }, thresholdMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [enabled, hidden, lastActivityAt, thresholdMs, messages, visible, dismissedAt, onNudge]);

  const handleDismiss = () => {
    setVisible(false);
    setDismissedAt(Date.now());
    onDismiss?.();
  };

  const handleAlertDismiss = () => {
    setDismissedAlert(alertMessage);
    onAlertDismiss?.();
  };

  // 场景四：焦虑关怀提示优先展示（立即、不等停顿），可忽略
  const showAlert =
    enabled && !hidden && alertMessage != null && alertMessage !== dismissedAlert;

  if (showAlert) {
    return (
      <div
        className={`fixed ${positionClass} bottom-6 z-50 flex max-w-[280px] animate-in fade-in slide-in-from-bottom-2 duration-300`}
        role="status"
        aria-live="polite"
      >
        <div className="relative rounded-2xl bg-amber-50/95 dark:bg-amber-950/60 backdrop-blur-sm border border-amber-300/40 shadow-lg px-4 py-3 pr-10 text-sm text-ink-soft">
          <button
            type="button"
            onClick={handleAlertDismiss}
            className="absolute top-1.5 right-1.5 p-1 text-ink-ghost/60 hover:text-ink-soft hover:bg-ink-ghost/10 rounded-full transition-colors cursor-pointer"
            aria-label="忽略"
            title="忽略"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2 2L10 10M10 2L2 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <span className="leading-relaxed">{alertMessage}</span>
        </div>
      </div>
    );
  }

  if (!enabled || !visible) {
    return null;
  }

  return (
    <div
      className={`fixed ${positionClass} bottom-6 z-50 flex max-w-[280px] animate-in fade-in slide-in-from-bottom-2 duration-300`}
      role="status"
      aria-live="polite"
    >
      <div className="relative rounded-2xl bg-paper-warm/95 dark:bg-paper-deep/95 backdrop-blur-sm border border-ink-ghost/10 shadow-lg px-4 py-3 pr-10 text-sm text-ink-soft">
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-1.5 right-1.5 p-1 text-ink-ghost/60 hover:text-ink-soft hover:bg-ink-ghost/10 rounded-full transition-colors cursor-pointer"
          aria-label="忽略"
          title="忽略"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2 2L10 10M10 2L2 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <span className="leading-relaxed">{nudgeMessage}</span>
      </div>
    </div>
  );
}
