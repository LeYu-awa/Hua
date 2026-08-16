import { useMemo, useState } from "react";
import { dispatchCanvasCommand } from "../canvas/canvasCommands";
import { applyPlanMarkersToCanvas, type StructuredReply } from "./structuredReply";

interface StructuredReplyViewProps {
  reply: StructuredReply;
  /** 回溯/追问：把上下文条目回填到输入框 */
  onReask: (text: string) => void;
}

const MODULE_BADGES = ["①", "②", "③", "④"] as const;
const MODULE_TITLES = ["操作步骤", "创作规划", "思考过程", "上下文管理"] as const;

function SectionShell({
  index,
  title,
  defaultOpen,
  children,
  trailing,
}: {
  index: number;
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-paper-deep/20 bg-paper/70 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-paper-warm/60 transition-colors"
      >
        <span className="text-[12px] leading-none">{MODULE_BADGES[index]}</span>
        <span className="text-[11.5px] font-semibold text-ink">{title}</span>
        <span className="ml-auto flex items-center gap-2">
          {trailing}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-ink-ghost transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && <div className="px-3 pb-2.5">{children}</div>}
    </section>
  );
}

function EmptyModule() {
  return <p className="text-[10.5px] text-ink-ghost leading-relaxed">（AI 未提供该模块内容）</p>;
}

/** ① 操作步骤：每条步骤绑定一键执行的画布操作按钮 */
function StepsSection({ steps }: { steps: StructuredReply["steps"] }) {
  const [executed, setExecuted] = useState<Record<number, boolean>>({});
  if (steps.length === 0) return <EmptyModule />;

  const runStep = (step: StructuredReply["steps"][number], index: number) => {
    if (!step.command) return;
    dispatchCanvasCommand(step.command);
    setExecuted((prev) => ({ ...prev, [index]: true }));
  };

  return (
    <ol className="space-y-2">
      {steps.map((step, index) => (
        <li
          key={`${index}-${step.label}`}
          className="rounded-lg border border-paper-deep/15 bg-paper-warm/40 px-2.5 py-2"
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-bamboo/15 text-[9px] font-semibold text-bamboo">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] leading-relaxed text-ink-soft">{step.label}</p>
              {step.detail && (
                <p className="mt-0.5 text-[10px] leading-relaxed text-ink-ghost">{step.detail}</p>
              )}
            </div>
          </div>
          {step.command && (
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => runStep(step, index)}
                disabled={executed[index]}
                className={`flex-1 rounded-lg px-2 py-1.5 text-[10.5px] font-medium transition-all cursor-pointer disabled:cursor-default ${
                  executed[index]
                    ? "bg-bamboo-mist/50 text-bamboo"
                    : "bg-bamboo text-cloud hover:bg-bamboo-light"
                }`}
              >
                {executed[index] ? "✓ 已执行" : "一键执行"}
              </button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/** ② 创作规划：与画布预留位置标记同步展示 */
function PlanSection({
  plan,
  onReask,
}: {
  plan: StructuredReply["plan"];
  onReask: (text: string) => void;
}) {
  const [applied, setApplied] = useState(false);
  if (plan.length === 0) return <EmptyModule />;

  const applyMarkers = () => {
    dispatchCanvasCommand(applyPlanMarkersToCanvas(plan));
    setApplied(true);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-ink-ghost">已按模块在画布预留卡片摆放位置</span>
        <button
          type="button"
          onClick={applyMarkers}
          className="rounded-lg border border-bamboo/30 bg-bamboo-mist/40 px-2 py-1 text-[10px] font-medium text-bamboo hover:bg-bamboo-mist/70 transition-colors cursor-pointer"
        >
          {applied ? "✓ 已生成标记" : "在画布生成标记"}
        </button>
      </div>
      <ul className="space-y-1.5">
        {plan.map((item, index) => (
          <li key={`${index}-${item.label}`} className="flex items-start gap-1.5">
            <span
              className="mt-1 shrink-0 w-2 h-2 rounded-full"
              style={{ backgroundColor: PLAN_COLORS[index % PLAN_COLORS.length] }}
            />
            <div className="min-w-0">
              <span className="text-[11px] font-medium text-ink-soft">{item.label}</span>
              {item.detail && (
                <span className="ml-1 text-[10px] text-ink-ghost">{item.detail}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {applied && (
        <button
          type="button"
          onClick={() => onReask("请把画布上的规划标记进一步细化成可执行的创作步骤")}
          className="w-full rounded-lg border border-paper-deep/20 px-2 py-1.5 text-[10px] text-ink-faint hover:bg-paper-warm transition-colors cursor-pointer"
        >
          让 AI 基于规划细化步骤
        </button>
      )}
    </div>
  );
}

const PLAN_COLORS = ["#7aa65c", "#8aa2c2", "#c2a45c", "#a67aa8", "#6f9aa8", "#c28060"];

/** ③ 思考过程：透明化推理逻辑 */
function ReasoningSection({ text }: { text: string }) {
  if (!text) return <EmptyModule />;
  return (
    <div className="text-[11px] leading-relaxed text-ink-faint whitespace-pre-wrap">
      {text.length > 240 ? `${text.slice(0, 240)}……` : text}
    </div>
  );
}

/** ④ 上下文管理：历史输入/输出/画布内容关联图谱，支持回溯与编辑 */
function ContextSection({
  sections,
  onReask,
}: {
  sections: StructuredReply["context"];
  onReask: (text: string) => void;
}) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [cleared, setCleared] = useState(false);

  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => !removed.has(item.id)),
        }))
        .filter((section) => section.items.length > 0),
    [sections, removed],
  );

  if (cleared || visibleSections.length === 0) {
    return (
      <p className="text-[10.5px] text-ink-ghost leading-relaxed">
        {cleared ? "上下文已清空。" : "暂无上下文记录。"}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-ink-ghost">自动关联历史输入、AI 输出与画布内容</span>
        <button
          type="button"
          onClick={() => setCleared(true)}
          className="text-[9.5px] text-ink-ghost hover:text-red-500 transition-colors cursor-pointer"
        >
          清空上下文
        </button>
      </div>
      {visibleSections.map((section) => (
        <div key={section.category}>
          <p className="mb-1 text-[10px] font-semibold text-ink-faint">{section.category}</p>
          <ul className="space-y-1">
            {section.items.map((item) => (
              <li
                key={item.id}
                className="group flex items-start gap-1.5 rounded-lg border border-paper-deep/10 bg-paper-warm/30 px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium text-ink-soft">{item.label}</p>
                  {item.value && (
                    <p className="mt-0.5 text-[10px] leading-relaxed text-ink-faint break-all">
                      {item.value}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {item.reask && (
                    <button
                      type="button"
                      onClick={() => onReask(item.reask ?? "")}
                      className="rounded-md border border-paper-deep/20 px-1.5 py-0.5 text-[9px] text-bamboo hover:bg-bamboo-mist/40 transition-colors cursor-pointer"
                      title="回溯：基于该条上下文继续追问"
                    >
                      回溯
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRemoved((prev) => new Set(prev).add(item.id))}
                    className="rounded-md px-1 text-[9px] text-ink-ghost hover:text-red-500 transition-colors cursor-pointer"
                    title="从上下文中移除"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * AI 结构化回复视图：四大模块按序渲染。
 * ① 操作步骤（一键执行按钮）→ ② 创作规划（画布标记同步）→ ③ 思考过程 → ④ 上下文管理
 */
export function StructuredReplyView({ reply, onReask }: StructuredReplyViewProps) {
  return (
    <div className="space-y-2">
      {reply.fallbackNote && (
        <p className="rounded-lg bg-bamboo-mist/30 px-2.5 py-1.5 text-[10px] leading-relaxed text-bamboo">
          {reply.fallbackNote}
        </p>
      )}
      <SectionShell index={0} title={MODULE_TITLES[0]} defaultOpen={reply.steps.length > 0}>
        <StepsSection steps={reply.steps} />
      </SectionShell>
      <SectionShell index={1} title={MODULE_TITLES[1]} defaultOpen={reply.plan.length > 0}>
        <PlanSection plan={reply.plan} onReask={onReask} />
      </SectionShell>
      <SectionShell index={2} title={MODULE_TITLES[2]} defaultOpen={false}>
        <ReasoningSection text={reply.reasoning} />
      </SectionShell>
      <SectionShell index={3} title={MODULE_TITLES[3]} defaultOpen={reply.context.length > 0}>
        <ContextSection sections={reply.context} onReask={onReask} />
      </SectionShell>
    </div>
  );
}
