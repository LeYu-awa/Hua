import { useTranslation } from "react-i18next";
import type { DiarySuggestionStatus } from "./useDiarySuggestion";

/**
 * 日记提议卡（diary S1）
 *
 * 出现在 SidebarChat 消息流末尾（独立卡片，不进入对话历史）：
 * - visible：花灵口吻提议 + [存入日记] [稍后再说] [今天不提醒]
 * - working / done / error：沉淀过程与结果状态
 */
export interface DiarySuggestionCardProps {
  status: DiarySuggestionStatus;
  /** 无可用 LLM 供应商时为 true，提示将摘录对话内容 */
  willFallback?: boolean;
  onConfirm: () => void;
  onDismissLater: () => void;
  onDismissToday: () => void;
}

export function DiarySuggestionCard({
  status,
  willFallback = false,
  onConfirm,
  onDismissLater,
  onDismissToday,
}: DiarySuggestionCardProps) {
  const { t } = useTranslation();

  return (
    <div className="mx-3 my-2 rounded-xl border border-paper-deep/20 bg-paper/90 p-3 shadow-sm">
      {status === "working" && (
        <div className="text-[11px] text-ink-ghost/80">
          {t("diary.saving", { defaultValue: "正在整理今天的记录…" })}
        </div>
      )}

      {status === "done" && (
        <div className="text-[12px] text-ink-soft">
          {t("diary.saved", { defaultValue: "已记下今天的记录 ✦" })}
        </div>
      )}

      {status === "error" && (
        <div className="space-y-2">
          <div className="text-[11px] text-ink-ghost/80">
            {t("diary.saveFailed", { defaultValue: "保存失败，稍后再试" })}
          </div>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg border border-paper-deep/20 bg-paper-warm/40 px-2.5 py-1 text-[11px] text-ink-soft hover:bg-paper-warm cursor-pointer"
          >
            {t("diary.retry", { defaultValue: "重试" })}
          </button>
        </div>
      )}

      {status === "visible" && (
        <>
          <div className="text-[12px] leading-relaxed text-ink-soft">
            {t("diary.suggest", {
              defaultValue: "今天聊了不少呢，要不要把今天的想法记成日记？",
            })}
          </div>
          {willFallback && (
            <div className="mt-1 text-[10px] text-ink-ghost/70">
              {t("diary.fallbackHint", { defaultValue: "未配置 AI 供应商，将直接摘录对话内容" })}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-lg bg-ink-soft px-2.5 py-1 text-[11px] font-medium text-paper hover:opacity-90 cursor-pointer"
            >
              {t("diary.confirm", { defaultValue: "存入日记" })}
            </button>
            <button
              type="button"
              onClick={onDismissLater}
              className="rounded-lg border border-paper-deep/20 px-2.5 py-1 text-[11px] text-ink-ghost/80 hover:bg-paper-warm/40 cursor-pointer"
            >
              {t("diary.later", { defaultValue: "稍后再说" })}
            </button>
            <button
              type="button"
              onClick={onDismissToday}
              className="rounded-lg px-2 py-1 text-[10px] text-ink-ghost/50 hover:text-ink-ghost cursor-pointer"
            >
              {t("diary.noToday", { defaultValue: "今天不提醒" })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
