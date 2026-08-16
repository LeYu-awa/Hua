import { useEffect, useState, type ReactNode } from "react";
import { DEMO_STEPS, type DemoStepId, type OnboardingPhase } from "./types";
import { CANVAS_TEMPLATES, type CanvasTemplate, type TemplateIconKey } from "./templates";

interface CanvasOnboardingProps {
  phase: OnboardingPhase;
  activeStep: DemoStepId;
  completedSteps: DemoStepId[];
  /** 演示卡片在屏幕上的锚点（画布中心） */
  demoAnchor: { x: number; y: number };
  /** 高亮区域：toolbar=左上工具栏 / node=第一个卡片 */
  highlight: "toolbar" | "node" | null;
  /** 模板坞是否可见（首次进入悬浮展示，用户可收起） */
  templatesVisible: boolean;
  onIntroDone: () => void;
  onSkipGuide: () => void;
  onFinishGuide: () => void;
  onAskAi: (prompt: string, autoSend?: boolean) => void;
  onApplyTemplate: (templateId: string) => void;
  onDismissTemplates: () => void;
}

/** 线性图标基底（与画布工具栏图标风格一致：16 viewBox、1.8 描边） */
function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
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

/** 无限画布：四象限网格 */
function GridIcon() {
  return (
    <Icon>
      <rect x="2.8" y="2.8" width="4.6" height="4.6" rx="1" />
      <rect x="8.6" y="2.8" width="4.6" height="4.6" rx="1" />
      <rect x="2.8" y="8.6" width="4.6" height="4.6" rx="1" />
      <rect x="8.6" y="8.6" width="4.6" height="4.6" rx="1" />
    </Icon>
  );
}

/** 卡片创作：圆角卡片 + 内容行 */
function CardIcon() {
  return (
    <Icon>
      <rect x="2.4" y="3" width="11.2" height="10" rx="2" />
      <path d="M4.8 6.2h6.4" />
      <path d="M4.8 9h4.6" opacity="0.62" />
    </Icon>
  );
}

/** 创作助手：四角星 */
function SparkIcon() {
  return (
    <Icon>
      <path d="M8 2 9.3 6.2 13.5 7.5 9.3 8.8 8 13 6.7 8.8 2.5 7.5 6.7 6.2Z" />
    </Icon>
  );
}

/** 模板图标映射（渲染端统一线性风格） */
const TEMPLATE_ICONS: Record<TemplateIconKey, ReactNode> = {
  brainstorm: (
    <Icon>
      <path d="M8 2.6a4.3 4.3 0 0 1 2.3 7.9c-.7.5-.9.9-.9 1.5H6.6c0-.6-.2-1-.9-1.5A4.3 4.3 0 0 1 8 2.6Z" />
      <path d="M6.7 13.6h2.6" />
      <path d="M7.2 12h1.6" opacity="0.55" />
    </Icon>
  ),
  project: (
    <Icon>
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.5" />
      <path d="M8 2.8v10.4M2.8 8h10.4" opacity="0.75" />
    </Icon>
  ),
  notes: (
    <Icon>
      <rect x="3" y="2.6" width="10" height="10.8" rx="1.5" />
      <path d="M5.6 5.8h4.8M5.6 8.6h4.8M5.6 11.4h2.6" opacity="0.75" />
    </Icon>
  ),
};

const FEATURE_INTRO_ITEMS: { icon: ReactNode; title: string; desc: string }[] = [
  { icon: <GridIcon />, title: "无限画布", desc: "想放多大就放多大，卡片自由排列" },
  { icon: <CardIcon />, title: "卡片创作", desc: "一个想法一张卡，双击即可编辑" },
  { icon: <SparkIcon />, title: "创作助手", desc: "描述需求，即可生成卡片与布局" },
];

function IntroOverlay({ onDone }: { onDone: () => void }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setHidden(true), 3000);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (hidden) {
      const timer = window.setTimeout(onDone, 450);
      return () => window.clearTimeout(timer);
    }
  }, [hidden, onDone]);

  return (
    <div
      className={`absolute inset-0 z-40 flex flex-col items-center justify-center bg-[var(--canvas-bg)]/90 backdrop-blur-sm pointer-events-none transition-opacity duration-500 ${
        hidden ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="text-center animate-fade-in select-none">
        <div className="text-[22px] font-display font-bold text-[var(--canvas-control-text)]">
          欢迎来到「花笺」画布
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--canvas-control-text)]/70">
          在这里，用一张无限延伸的画布承载所有想法
        </p>
      </div>
      <div className="mt-7 flex items-start gap-5 animate-fade-in [animation-delay:0.4s]">
        {FEATURE_INTRO_ITEMS.map((item) => (
          <div key={item.title} className="w-36 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--canvas-border)] bg-[var(--canvas-accent-soft)] text-[var(--canvas-control-text)]/85">
              {item.icon}
            </div>
            <div className="mt-2 text-[12px] font-semibold text-[var(--canvas-control-text)]">
              {item.title}
            </div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-[var(--canvas-control-text)]/60">
              {item.desc}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 text-[11px] text-[var(--canvas-control-text)]/50">即将开始引导…</div>
    </div>
  );
}

/** 交互式演示卡片：分步高亮，每完成一步自动解锁下一步（ob-1） */
function DemoCard({
  activeStep,
  completedSteps,
  anchor,
  highlight,
  onSkip,
}: {
  activeStep: DemoStepId;
  completedSteps: DemoStepId[];
  anchor: { x: number; y: number };
  highlight: "toolbar" | "node" | null;
  onSkip: () => void;
}) {
  const current = DEMO_STEPS.find((step) => step.id === activeStep) ?? DEMO_STEPS[0];
  const progress = Math.round((completedSteps.length / DEMO_STEPS.length) * 100);
  const allDone = completedSteps.length >= DEMO_STEPS.length;

  return (
    <div
      className="absolute z-30 -translate-x-1/2 pointer-events-none"
      style={{ left: anchor.x, top: anchor.y }}
    >
      {/* 面板本体拦截鼠标，面板四周的画布区域可正常拖拽/平移/缩放 */}
      <div className="canvas-onboarding-panel w-[320px] pointer-events-auto border-bamboo/25 animate-fade-in">
        {/* 进度条 */}
        <div className="h-1 overflow-hidden rounded-t-[15px] bg-[var(--canvas-accent-soft)]">
          <div
            className="h-full bg-bamboo transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-bamboo">
              {allDone
                ? "基础引导完成"
                : `第 ${completedSteps.length + 1} / ${DEMO_STEPS.length} 步`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onSkip}
                className="text-[9.5px] text-[var(--canvas-control-text)]/45 transition-colors hover:text-[var(--canvas-control-text)]/75 cursor-pointer"
              >
                跳过引导
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--canvas-control-text)]/45 transition-colors hover:bg-[var(--canvas-accent-soft)] hover:text-[var(--canvas-control-text)]/80 cursor-pointer"
                title="关闭引导"
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
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {!allDone ? (
            <>
              <div className="mt-2 text-[14px] font-semibold text-[var(--canvas-control-text)]">
                {current.title}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--canvas-control-text)]/70">
                {current.desc}
              </p>
              <div className="mt-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {DEMO_STEPS.map((step) => (
                    <span
                      key={step.id}
                      className={`h-1.5 rounded-full transition-all ${
                        completedSteps.includes(step.id)
                          ? "bg-bamboo"
                          : step.id === activeStep
                            ? "w-5 bg-bamboo/60"
                            : "w-1.5 bg-[var(--canvas-accent-soft)]"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[9px] text-[var(--canvas-control-text)]/40">自动演示中</span>
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bamboo text-cloud">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span className="text-[13px] font-semibold text-[var(--canvas-control-text)]">
                  四项基础操作已学会
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--canvas-control-text)]/70">
                基础操作演示完毕，稍后即可直接开始创作。
              </p>
            </>
          )}
        </div>
      </div>

      {/* 步骤高亮指示（toolbar / node） */}
      {highlight === "toolbar" && (
        <div className="absolute -top-3 left-1/2 h-6 w-[92px] -translate-x-1/2 rounded-xl border-2 border-bamboo bg-bamboo-mist/20 shadow-lg animate-pulse" />
      )}
      {highlight === "node" && (
        <div className="absolute -bottom-3 left-1/2 h-6 w-[120px] -translate-x-1/2 rounded-xl border-2 border-bamboo bg-bamboo-mist/20 shadow-lg animate-pulse" />
      )}
    </div>
  );
}

/** 场景化快速入门模板坞（ob-2）：首次进入悬浮在右侧 */
function TemplateDock({
  onApply,
  onDismiss,
  onAskAi,
}: {
  onApply: (templateId: string) => void;
  onDismiss: () => void;
  onAskAi: (prompt: string, autoSend?: boolean) => void;
}) {
  const [activeTemplate, setActiveTemplate] = useState<CanvasTemplate | null>(null);
  return (
    <div className="absolute right-4 top-1/2 z-30 w-[216px] -translate-y-1/2">
      <div className="canvas-onboarding-panel p-3 animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[var(--canvas-control-text)]">
            快速入门模板
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--canvas-control-text)]/45 transition-colors hover:bg-[var(--canvas-accent-soft)] hover:text-[var(--canvas-control-text)]/75 cursor-pointer"
            title="收起模板"
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
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--canvas-control-text)]/50">
          一键生成预设卡片布局，快速理解画布创作逻辑
        </p>
        <div className="mt-2.5 space-y-2">
          {CANVAS_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => setActiveTemplate(template)}
              className="w-full rounded-xl border border-[var(--canvas-border)] bg-[var(--canvas-accent-soft)] px-2.5 py-2 text-left transition-all hover:border-bamboo/40 hover:bg-bamboo/15 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span className="text-[var(--canvas-control-text)]/80">
                  {TEMPLATE_ICONS[template.icon]}
                </span>
                <span className="text-[11.5px] font-medium text-[var(--canvas-control-text)]">
                  {template.title}
                </span>
              </div>
              <p className="mt-0.5 text-[9.5px] leading-relaxed text-[var(--canvas-control-text)]/50">
                {template.desc}
              </p>
            </button>
          ))}
        </div>
        <div className="mt-2.5 border-t border-[var(--canvas-border)] pt-2">
          <button
            type="button"
            onClick={() =>
              onAskAi("请给我一份无限画布+卡片创作的入门教程，并生成一套示范卡片", true)
            }
            className="w-full rounded-lg border border-bamboo/30 bg-bamboo/10 px-2 py-1.5 text-[10.5px] font-medium text-bamboo transition-colors hover:bg-bamboo/20 cursor-pointer"
          >
            生成示例卡片
          </button>
        </div>
      </div>

      {/* 模板确认 / 场景教程卡片 */}
      {activeTemplate && (
        <div className="canvas-onboarding-panel mt-2 border-bamboo/30 p-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-[var(--canvas-control-text)]/80">
              {TEMPLATE_ICONS[activeTemplate.icon]}
            </span>
            <span className="text-[12px] font-semibold text-[var(--canvas-control-text)]">
              {activeTemplate.title} · 场景教程
            </span>
          </div>
          <ol className="mt-2 space-y-1.5">
            {activeTemplate.tutorial.map((step, index) => (
              <li
                key={index}
                className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-[var(--canvas-control-text)]/70"
              >
                <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-bamboo/15 text-[8.5px] font-semibold text-bamboo">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onApply(activeTemplate.id);
                setActiveTemplate(null);
              }}
              className="flex-1 rounded-lg bg-bamboo px-2 py-1.5 text-[11px] font-medium text-cloud transition-all hover:bg-bamboo-light cursor-pointer"
            >
              一键生成布局
            </button>
            <button
              type="button"
              onClick={() => setActiveTemplate(null)}
              className="rounded-lg border border-[var(--canvas-border)] px-2 py-1.5 text-[11px] text-[var(--canvas-control-text)]/50 transition-colors hover:bg-[var(--canvas-accent-soft)] cursor-pointer"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CanvasOnboarding({
  phase,
  activeStep,
  completedSteps,
  demoAnchor,
  highlight,
  templatesVisible,
  onIntroDone,
  onSkipGuide,
  onAskAi,
  onApplyTemplate,
  onDismissTemplates,
}: CanvasOnboardingProps) {
  if (phase === "idle" || phase === "done") return null;

  return (
    <>
      {phase === "intro" && <IntroOverlay onDone={onIntroDone} />}
      {phase === "demo" && (
        <>
          <DemoCard
            activeStep={activeStep}
            completedSteps={completedSteps}
            anchor={demoAnchor}
            highlight={highlight}
            onSkip={onSkipGuide}
          />
          {templatesVisible && (
            <TemplateDock
              onApply={onApplyTemplate}
              onDismiss={onDismissTemplates}
              onAskAi={onAskAi}
            />
          )}
        </>
      )}
    </>
  );
}
