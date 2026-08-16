import { useState, type ReactNode } from "react";
import { dispatchCanvasCommand } from "../canvasCommands";
import { DEMO_STEPS } from "./types";

/**
 * 常驻快捷操作提示（ob-3）
 * 画布角落可折叠迷你引导窗：长期展示快捷键与手势，可展开查看操作演示回放。
 * 深色画布面板风格（canvas-onboarding-panel + --canvas-* tokens），
 * 固定于左下角，避免与右侧模板坞（TemplateDock）互相遮挡。
 */

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "按住空白拖动", desc: "平移画布" },
  { keys: "Ctrl + 滚轮", desc: "以鼠标为锚点缩放" },
  { keys: "Ctrl + = / -", desc: "放大 / 缩小" },
  { keys: "Ctrl + 0", desc: "复位到 100%" },
  { keys: "Ctrl + Z", desc: "撤销" },
  { keys: "Ctrl + Shift + Z", desc: "重做" },
  { keys: "双击卡片", desc: "编辑卡片内容" },
  { keys: "选中后点击连线", desc: "建立卡片关联" },
];

function HelpIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9a2.8 2.8 0 0 1 5.5.9c0 1.9-2.7 2.3-2.7 3.6" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** 演示动画字形（24 viewBox、1.8 描边，与画布线性图标风格一致） */
function DemoGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 平移：手掌 */
function HandIcon() {
  return (
    <DemoGlyph>
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </DemoGlyph>
  );
}

/** 缩放：放大 / 缩小 */
function ZoomGlyph({ kind }: { kind: "in" | "out" }) {
  return (
    <DemoGlyph>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
      {kind === "in" && <path d="M11 8.2v5.6" />}
      <path d="M8.2 11h5.6" />
    </DemoGlyph>
  );
}

/** 新建卡片：圆角卡片 + 内容行 */
function CardGlyph() {
  return (
    <DemoGlyph>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 9.5h18" opacity="0.55" />
      <path d="M7 14.5h6" opacity="0.55" />
    </DemoGlyph>
  );
}

/** 移动：十字箭头 */
function MoveIcon() {
  return (
    <DemoGlyph>
      <path d="M12 2.6v18.8M2.6 12h18.8" />
      <path d="m8.6 6.4 3.4-3.4 3.4 3.4" />
      <path d="m8.6 17.6 3.4 3.4 3.4-3.4" />
      <path d="m6.4 8.6-3.4 3.4 3.4 3.4" />
      <path d="m17.6 8.6 3.4 3.4-3.4 3.4" />
    </DemoGlyph>
  );
}

/** 操作演示回放：按步骤逐条播放动画示意（替代视频演示） */
function DemoReplayModal({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const step = DEMO_STEPS[index];
  const last = index >= DEMO_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--canvas-bg)]/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="canvas-onboarding-panel w-[420px] max-w-[92vw] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-[var(--canvas-control-text)]">
            操作演示回放
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--canvas-control-text)]/45 transition-colors hover:bg-[var(--canvas-accent-soft)] hover:text-[var(--canvas-control-text)]/80 cursor-pointer"
            title="关闭"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 动画示意区 */}
        <div className="mt-3 relative h-40 overflow-hidden rounded-xl border border-[var(--canvas-border)] bg-[var(--canvas-bg)]">
          <div className="absolute inset-0 canvas-demo-grid" />
          <div key={step.id} className="absolute inset-0 animate-fade-in">
            {step.id === "pan" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex h-11 w-14 items-center justify-center rounded-lg border border-[var(--canvas-border)] bg-[var(--canvas-panel)] text-[var(--canvas-control-text)]/85 animate-demo-pan cursor-grab">
                  <HandIcon />
                </div>
              </div>
            )}
            {step.id === "zoom" && (
              <div className="absolute inset-0 flex items-center justify-center gap-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-bamboo text-bamboo animate-demo-zoom-in">
                  <ZoomGlyph kind="in" />
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-bamboo text-bamboo animate-demo-zoom-out">
                  <ZoomGlyph kind="out" />
                </div>
              </div>
            )}
            {step.id === "create" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex h-16 w-24 items-center justify-center rounded-lg border-2 border-dashed border-bamboo bg-bamboo-mist/20 text-bamboo animate-demo-pop">
                  <CardGlyph />
                </div>
              </div>
            )}
            {step.id === "move" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex h-14 w-20 items-center justify-center rounded-lg border border-[var(--canvas-border)] bg-[var(--canvas-panel)] text-[var(--canvas-control-text)]/85 animate-demo-move cursor-move">
                  <MoveIcon />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-[var(--canvas-control-text)]/40">
            {index + 1} / {DEMO_STEPS.length}
          </span>
          <div className="flex gap-1.5">
            {DEMO_STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setIndex(i)}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                  i === index ? "w-5 bg-bamboo" : "w-1.5 bg-[var(--canvas-border)]"
                }`}
                title={s.title}
              />
            ))}
          </div>
        </div>
        <div className="mt-2 text-[12.5px] font-semibold text-[var(--canvas-control-text)]">
          {step.title}
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--canvas-control-text)]/60">
          {step.desc}
        </p>

        <div className="mt-3 flex justify-between gap-2">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="rounded-lg border border-[var(--canvas-border)] px-3 py-1.5 text-[11px] text-[var(--canvas-control-text)]/50 transition-colors hover:bg-[var(--canvas-accent-soft)] disabled:opacity-40 cursor-pointer"
          >
            上一步
          </button>
          <button
            type="button"
            onClick={() => (last ? onClose() : setIndex((i) => i + 1))}
            className="rounded-lg bg-bamboo px-4 py-1.5 text-[11px] font-medium text-cloud transition-all hover:bg-bamboo-light cursor-pointer"
          >
            {last ? "完成" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CanvasQuickHelp() {
  const [open, setOpen] = useState(false);
  const [replaying, setReplaying] = useState(false);

  return (
    <div className="absolute bottom-20 left-4 z-20">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-[var(--canvas-border)] bg-[var(--canvas-panel)] px-3 py-2 backdrop-blur-sm shadow-lg text-[var(--canvas-control-text)]/70 transition-all hover:border-bamboo/40 hover:text-bamboo cursor-pointer"
          title="快捷操作说明"
        >
          <HelpIcon />
          <span className="text-[10.5px] font-medium">快捷操作</span>
        </button>
      ) : (
        <div className="canvas-onboarding-panel w-[264px] overflow-hidden animate-fade-in border-bamboo/25">
          <div className="flex items-center justify-between border-b border-[var(--canvas-border)] px-3 py-2.5">
            <span className="text-[12px] font-semibold text-[var(--canvas-control-text)]">
              画布快捷操作
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--canvas-control-text)]/45 transition-colors hover:bg-[var(--canvas-accent-soft)] hover:text-[var(--canvas-control-text)]/80 cursor-pointer"
              title="收起"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto px-3 py-2 space-y-1.5">
            {SHORTCUTS.map((item) => (
              <div key={item.keys} className="flex items-center justify-between gap-2">
                <span className="shrink-0 rounded-md bg-[var(--canvas-accent-soft)] px-1.5 py-0.5 font-mono text-[9.5px] text-[var(--canvas-control-text)]/60">
                  {item.keys}
                </span>
                <span className="text-right text-[10px] text-[var(--canvas-control-text)]/45">
                  {item.desc}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 border-t border-[var(--canvas-border)] px-3 py-2.5">
            <button
              type="button"
              onClick={() => setReplaying(true)}
              className="flex-1 rounded-lg border border-bamboo/30 bg-bamboo/10 px-2 py-1.5 text-[10.5px] font-medium text-bamboo transition-colors hover:bg-bamboo/20 cursor-pointer"
            >
              操作演示回放
            </button>
            <button
              type="button"
              onClick={() => dispatchCanvasCommand({ kind: "runTutorial" })}
              className="flex-1 rounded-lg border border-[var(--canvas-border)] px-2 py-1.5 text-[10.5px] text-[var(--canvas-control-text)]/50 transition-colors hover:bg-[var(--canvas-accent-soft)] cursor-pointer"
            >
              重新引导
            </button>
          </div>
        </div>
      )}
      {replaying && <DemoReplayModal onClose={() => setReplaying(false)} />}
    </div>
  );
}
