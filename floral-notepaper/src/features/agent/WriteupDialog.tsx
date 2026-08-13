import { useState } from "react";
import { useTranslation } from "react-i18next";
import { WRITEUP_KINDS, buildWriteupGoal, type WriteupKind } from "./writeupGoal";

/**
 * 组卡成文类型选择弹窗（可产出 Agent）
 *
 * 画布"整理成文"入口：框选卡片后选择产出类型（大纲/初稿/总结/设定集）+
 * 可选用户意图，开始后把 goal 交给 Rust canvas.writeup 技能执行。
 */
export interface WriteupDialogProps {
  open: boolean;
  nodeIds: string[];
  busy?: boolean;
  onClose: () => void;
  onStart: (goal: string) => void;
}

export function WriteupDialog({
  open,
  nodeIds,
  busy = false,
  onClose,
  onStart,
}: WriteupDialogProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<WriteupKind>("初稿");
  const [intent, setIntent] = useState("");

  if (!open) return null;

  const start = () => {
    if (busy || nodeIds.length === 0) return;
    onStart(buildWriteupGoal(nodeIds, kind, intent));
    setIntent("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-w-[90vw] rounded-2xl border border-paper-deep/25 bg-paper p-4 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.4)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-[14px] font-display font-bold text-ink">
          {t("agent.writeupTitle", { defaultValue: "整理成文" })}
        </h3>
        <p className="mt-0.5 text-[11px] text-ink-ghost">
          {t("agent.writeupSubtitle", {
            defaultValue: "将整理 N 张卡片",
          }).replace("N", String(nodeIds.length))}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {WRITEUP_KINDS.map((option) => {
            const active = kind === option.kind;
            return (
              <button
                key={option.kind}
                type="button"
                onClick={() => setKind(option.kind)}
                className={`rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
                  active
                    ? "border-bamboo/50 bg-bamboo-mist/30"
                    : "border-paper-deep/20 bg-paper-warm/30 hover:bg-paper-warm/60"
                }`}
              >
                <div className={`text-[12px] font-medium ${active ? "text-bamboo" : "text-ink"}`}>
                  {option.kind}
                </div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-ink-ghost">
                  {option.description}
                </div>
              </button>
            );
          })}
        </div>

        <input
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          placeholder={t("agent.writeupIntentPlaceholder", {
            defaultValue: "补充一句你想怎么写（可选）",
          })}
          className="mt-3 w-full rounded-lg border border-paper-deep/20 bg-paper px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-ghost/50 focus:border-ink-ghost/40"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-paper-deep/20 px-3 py-1.5 text-[12px] text-ink-ghost hover:bg-paper-warm/40 disabled:opacity-50 cursor-pointer"
          >
            {t("common.cancel", { defaultValue: "取消" })}
          </button>
          <button
            type="button"
            onClick={start}
            disabled={busy || nodeIds.length === 0}
            className="rounded-lg bg-ink-soft px-3 py-1.5 text-[12px] font-medium text-paper hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            {busy
              ? t("agent.writeupStarting", { defaultValue: "正在启动…" })
              : t("agent.writeupStart", { defaultValue: "开始整理" })}
          </button>
        </div>
      </div>
    </div>
  );
}
