import { useMemo } from "react";
import type { PendingToolPlan } from "./agentRuntime";
import { buildLineDiff } from "./writebackDiff";

interface ChatWritebackReviewProps {
  pendingTool: PendingToolPlan;
  applying?: boolean;
  resolved?: "applied" | "cancelled" | null;
  onApply: () => void;
  onCancel: () => void;
}

/** 对话内的代码式写回变更预览卡片（类似编辑器 Diff 的紧凑版） */
export function ChatWritebackReview({
  pendingTool,
  applying = false,
  resolved = null,
  onApply,
  onCancel,
}: ChatWritebackReviewProps) {
  const review = pendingTool.review;
  const lines = useMemo(
    () => (review ? buildLineDiff(review.originalContent, review.generatedContent) : []),
    [review],
  );

  if (!review) return null;

  const charDelta = review.generatedStats.chars - review.originalStats.chars;
  const lineDelta = review.generatedStats.lines - review.originalStats.lines;

  return (
    <div className="overflow-hidden rounded-2xl border border-paper-deep/25 bg-[#1b1d1b] shadow-sm shadow-shadow-deep/30">
      {/* 头部 */}
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded border border-emerald-300/20 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-200">
            AI DIFF
          </span>
          <span className="truncate text-[12px] font-semibold text-[#eee8dd]">{review.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 font-mono text-[9px] text-[#8e887f]">
          <span>{charDelta >= 0 ? `+${charDelta}` : charDelta} 字符</span>
          <span className={lineDelta >= 0 ? "text-emerald-300" : "text-red-300"}>
            {lineDelta >= 0 ? `+${lineDelta}` : lineDelta} 行
          </span>
        </div>
      </div>

      {/* 变更摘要与风险提示 */}
      {review.changeSummary.length > 0 && (
        <div className="border-b border-white/8 px-3 py-1.5 text-[10px] leading-relaxed text-[#a9a39a]">
          {review.changeSummary.map((item, index) => (
            <p key={index} className="flex gap-1">
              <span className="text-[#8e887f]">·</span>
              <span>{item}</span>
            </p>
          ))}
        </div>
      )}
      {review.riskFlags.length > 0 && (
        <div className="border-b border-white/8 px-3 py-1.5">
          {review.riskFlags.map((flag, index) => (
            <p key={index} className="text-[10px] leading-relaxed text-amber-200/90">
              {flag}
            </p>
          ))}
        </div>
      )}

      {/* 代码式 diff */}
      <div className="max-h-72 overflow-auto px-2 py-2 font-mono text-[10.5px] leading-[19px]">
        <div className="overflow-hidden rounded-lg border border-white/8 bg-[#161816]">
          {lines.map((line, index) => (
            <div
              key={index}
              className={`grid grid-cols-[32px_32px_18px_minmax(0,1fr)] ${
                line.type === "add"
                  ? "bg-emerald-400/10 text-emerald-200/90"
                  : line.type === "remove"
                    ? "bg-red-400/10 text-red-200/80 line-through decoration-red-400/40"
                    : "text-[#9aa09a]"
              }`}
            >
              <span className="select-none pr-1 text-right text-[#5a5f5a]">{line.oldLine ?? ""}</span>
              <span className="select-none pr-1 text-right text-[#5a5f5a]">{line.newLine ?? ""}</span>
              <span className="select-none text-center text-[#5a5f5a]">
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : ""}
              </span>
              <span className="whitespace-pre-wrap break-words pl-1">{line.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 操作区 / 结果 */}
      <div className="flex items-center justify-end gap-2 border-t border-white/8 bg-[#141614] px-3 py-2">
        {resolved ? (
          <span
            className={`text-[11px] font-medium ${
              resolved === "applied" ? "text-emerald-300" : "text-[#8e887f]"
            }`}
          >
            {resolved === "applied" ? "已写回原文档" : "已放弃本次写回"}
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={onCancel}
              disabled={applying}
              className="cursor-pointer rounded-lg border border-white/10 px-2.5 py-1 text-[10.5px] text-[#a9a39a] transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              放弃
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={applying}
              className="cursor-pointer rounded-lg bg-emerald-500/90 px-2.5 py-1 text-[10.5px] font-medium text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying ? "写回中…" : "接受变更并写回"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
