import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  confirmAgentTask,
  createAndRunAgentTask,
  getAgentTask,
  onAgentStep,
  onAgentTask,
} from "./api";
import type {
  AgentStep,
  AgentStepEvent,
  AgentStepLog,
  AgentStepStatus,
  AgentTask,
} from "./types";
import { dispatchOpenNote } from "../notes/openNoteEvents";
import type { ProviderConfig } from "../settings/types";

const STEP_STATUS_ICON: Record<AgentStepStatus, string> = {
  Pending: "·",
  Running: "…",
  Done: "✓",
  Failed: "✕",
  Cancelled: "–",
};

const STEP_STATUS_STYLE: Record<AgentStepStatus, string> = {
  Pending: "border-paper-deep/15 text-ink-ghost",
  Running: "border-bamboo/40 text-bamboo animate-pulse",
  Done: "border-bamboo/30 text-bamboo",
  Failed: "border-coral/40 text-coral",
  Cancelled: "border-paper-deep/15 text-ink-ghost",
};

const TASK_STATUS_STYLE: Record<string, string> = {
  Planned: "text-ink-ghost",
  Running: "text-bamboo animate-pulse",
  AwaitingConfirm: "text-amber-500",
  Done: "text-bamboo",
  Failed: "text-danger",
  Cancelled: "text-ink-ghost",
};

const TASK_STATUS_LABEL: Record<string, string> = {
  Planned: "已规划",
  Running: "执行中",
  AwaitingConfirm: "等待确认",
  Done: "已完成",
  Failed: "失败",
  Cancelled: "已取消",
};

/** 工具名 → 用户可读的中文步骤名（面板里不向用户展示内部工具名） */
const TOOL_LABELS: Record<string, string> = {
  "note.search": "搜索笔记",
  "note.read": "读取笔记",
  "note.create": "生成笔记",
  "note.update": "更新笔记",
  "canvas.read": "读取画布",
  "canvas.node.create": "画布新建卡片",
  "canvas.save": "写回画布",
  "canvas.save-groups": "写入分组",
  "canvas.batch-create": "知识卡落画布",
  "canvas.organize": "整理画布",
  "web.search": "联网检索",
  "llm.generate": "AI 生成",
  "note.export": "导出笔记",
};

const KIND_LABELS: Record<string, string> = {
  Llm: "AI 提炼",
  Tool: "执行",
  Confirm: "确认",
  Output: "输出",
};

function friendlyStepName(step: AgentStep): string {
  return TOOL_LABELS[step.tool ?? ""] ?? KIND_LABELS[step.kind] ?? (step.tool ?? step.kind);
}

interface TaskProgressPanelProps {
  goal: string;
  /** 挂载即创建并运行任务（最小闭环入口） */
  autoRun?: boolean;
  /** 已存在的任务（从列表进入时传入，跳过创建） */
  taskId?: string;
  /** 运行时供应商配置：API Key 来自前端缓存，只透传给本次调用 */
  providers?: ProviderConfig[];
  /** 组卡成文落盘成功后触发章节续写（由父组件渲染续写任务） */
  onContinueChapter?: (note: { id: string; title: string }) => void;
}

/**
 * 主编排任务进度面板（Phase B 最小闭环的 UI 侧）：
 * 发目标 → Rust 规划执行 → 订阅 agent.step / agent.task 展示进度与结果。
 */
export function TaskProgressPanel({
  goal,
  autoRun = true,
  taskId,
  providers,
  onContinueChapter,
}: TaskProgressPanelProps) {
  const [task, setTask] = useState<AgentTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** 本面板绑定的任务 id：agent.task 事件按此过滤，避免 Dock 中并排面板互相污染 */
  const taskIdRef = useRef<string | null>(null);
  /** 组卡成文产出预览（可编辑标题/正文，确认时随 payload 落盘） */
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewReady, setPreviewReady] = useState(false);
  /** 落盘成功横幅关闭态 */
  const [doneDismissed, setDoneDismissed] = useState(false);
  /** 展开中的步骤：点击步骤行查看该步的工具/上下文/记忆/产出 */
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);

  // 从任务 plan 派生当前待确认步骤（AwaitingConfirm 状态下第一个未确认的写操作步骤）
  const confirmStep =
    task?.status === "AwaitingConfirm"
      ? task.plan.find(
          (step) =>
            step.requiredConfirm &&
            !step.confirmed &&
            step.status !== "Done" &&
            step.status !== "Cancelled" &&
            step.status !== "Failed",
        )
      : undefined;

  /** 组卡成文：上游 LLM 步骤生成的正文（用于预览确认） */
  const llmOutput = useMemo(() => {
    if (!task) return null;
    const llmStep = task.plan.find((step) => step.kind === "Llm" && step.output != null);
    const text = llmStep?.output as { text?: unknown } | null;
    return typeof text?.text === "string" && text.text.trim() ? text.text : null;
  }, [task]);

  /** 是否展示可编辑产出预览（note.create 确认 + 有 LLM 生成内容） */
  const showWriteupPreview =
    confirmStep?.tool === "note.create" && llmOutput !== null && !previewReady;

  /** 落盘成功：note.create 步骤的输出携带新笔记 id/title */
  const createdNote = useMemo(() => {
    if (!task) return null;
    const createStep = task.plan.find((step) => step.tool === "note.create" && step.output != null);
    const out = createStep?.output as { id?: unknown; title?: unknown } | null;
    return typeof out?.id === "string"
      ? { id: out.id, title: typeof out.title === "string" ? out.title : "" }
      : null;
  }, [task]);

  /** 成文预览标题里的卡片数（goal 格式：整理成文：…；卡片：id1,id2 → 无"N 张卡片"时留空） */
  const cardCountText = goal.match(/(\d+)\s*张卡片/)?.[1] ?? "";

  const isWriteupDone =
    task?.status === "Done" && createdNote !== null && !doneDismissed;

  const handleConfirm = async (ok: boolean, payload?: { title?: string; content?: string }) => {
    if (!task || !confirmStep) return;
    setConfirming(true);
    try {
      const next = await confirmAgentTask(task.taskId, confirmStep.stepId, ok, payload, providers);
      setTask(next);
      if (ok && payload) {
        setPreviewReady(true);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setConfirming(false);
    }
  };

  useEffect(() => {
    let alive = true;

    const sync = (next: AgentTask | null) => {
      if (alive && next) {
        // 只接收本面板任务的 agent.task 事件；未绑定时首个任务即绑定
        if (taskIdRef.current !== null && next.taskId !== taskIdRef.current) return;
        taskIdRef.current = next.taskId;
        setTask(next);
      }
    };

    const unsubStep = onAgentStep((event: AgentStepEvent) => {
      setTask((current) => {
        if (!current || current.taskId !== event.taskId) return current;
        return {
          ...current,
          plan: current.plan.map((step) =>
            step.stepId === event.stepId ? { ...step, status: event.status } : step,
          ),
          logs: [
            ...current.logs,
            {
              stepId: event.stepId,
              message: event.message,
              timestamp: new Date().toISOString(),
            },
          ],
        };
      });
    });
    const unsubTask = onAgentTask(sync);

    const start = async () => {
      try {
        if (taskId) {
          sync(await getAgentTask(taskId));
        } else if (autoRun) {
          sync(await createAndRunAgentTask(goal, providers));
        }
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    start();

    return () => {
      alive = false;
      unsubStep.then((fn) => fn());
      unsubTask.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal, taskId, autoRun, providers]);

  if (error) {
    return (
      <div className="rounded-2xl border border-coral/30 bg-coral/5 p-3 text-[12px] text-coral">
        任务启动失败：{error}
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-paper-deep/15 bg-paper p-3 text-[12px] text-ink-ghost">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-bamboo/30 border-t-bamboo" />
        正在规划任务…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-paper-deep/15 bg-paper p-3 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)]">
      {/* 头部：目标 + 状态（不展示内部 task id，避免技术噪音） */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 truncate text-[13px] font-semibold text-ink">{task.goal}</div>
        <span
          className={`shrink-0 rounded-full border border-paper-deep/15 px-2 py-0.5 text-[10px] font-medium ${TASK_STATUS_STYLE[task.status] ?? ""}`}
        >
          {TASK_STATUS_LABEL[task.status] ?? task.status}
        </span>
      </div>

      {/* 执行层：可点击展开的步骤轨迹——每步展示 工具 / 上下文输入 / 记忆召回 / 产出结果 */}
      {task.plan.length > 0 && (
        <ol className="flex flex-col gap-1">
          {task.plan.map((step) => {
            const expanded = expandedStepId === step.stepId;
            return (
              <li key={step.stepId}>
                <button
                  type="button"
                  onClick={() => setExpandedStepId((current) => (current === step.stepId ? null : step.stepId))}
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-bamboo-mist/40 cursor-pointer"
                  title="点击查看该步骤的工具、上下文与产出"
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${STEP_STATUS_STYLE[step.status] ?? ""}`}
                  >
                    {STEP_STATUS_ICON[step.status]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                    {friendlyStepName(step)}
                  </span>
                  {step.tool && (
                    <span className="shrink-0 rounded bg-paper-deep/10 px-1 py-px font-mono text-[9px] text-ink-ghost">
                      {step.tool}
                    </span>
                  )}
                  <span className="shrink-0 text-[10px] text-ink-ghost">
                    {lastLogFor(task, step.stepId)}
                  </span>
                  <span className="shrink-0 text-[9px] text-ink-ghost">{expanded ? "▾" : "▸"}</span>
                </button>
                {expanded && (
                  <StepDetail step={step} logs={logsFor(task, step.stepId)} />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* 待确认操作：写/产出型工具在落盘前需用户确认 */}
      {confirmStep && showWriteupPreview && llmOutput !== null && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
          <div className="text-[11px] font-semibold text-ink">
            成文预览{cardCountText ? `（来自画布 ${cardCountText} 张卡片）` : ""}
          </div>
          <input
            value={previewTitle || "画布整理成文"}
            onChange={(event) => setPreviewTitle(event.target.value)}
            placeholder="标题"
            className="mt-2 w-full rounded-lg border border-paper-deep/20 bg-paper px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-ghost/50 focus:border-ink-ghost/40"
          />
          <textarea
            value={previewContent || llmOutput}
            onChange={(event) => setPreviewContent(event.target.value)}
            rows={10}
            className="mt-2 w-full resize-y rounded-lg border border-paper-deep/20 bg-paper px-2.5 py-1.5 text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-ghost/50 focus:border-ink-ghost/40"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={confirming}
              onClick={() =>
                void handleConfirm(true, {
                  title: previewTitle || "画布整理成文",
                  content: previewContent || llmOutput,
                })
              }
              className="rounded-lg bg-bamboo px-3 py-1 text-[11px] font-medium text-paper hover:bg-bamboo/90 disabled:opacity-50"
            >
              {confirming ? "处理中…" : "确认落盘"}
            </button>
            <button
              type="button"
              disabled={confirming}
              onClick={() => void handleConfirm(false)}
              className="rounded-lg border border-paper-deep/20 px-3 py-1 text-[11px] text-ink-ghost hover:text-ink disabled:opacity-50"
            >
              取消任务
            </button>
          </div>
        </div>
      )}

      {/* 其他写操作：通用确认框 */}
      {confirmStep && !showWriteupPreview && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
          <div className="text-[11px] font-semibold text-ink">
            确认「{friendlyStepName(confirmStep)}」后继续
          </div>
          <div className="mt-1 text-[11px] text-ink">
            <dl className="mt-1 space-y-0.5">
              {Object.entries(confirmStep.input ?? {}).map(([key, value]) => (
                <div key={key} className="flex gap-2 text-[10.5px] leading-relaxed">
                  <dt className="shrink-0 text-ink-ghost">{key}</dt>
                  <dd className="min-w-0 break-all text-ink">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={confirming}
              onClick={() => handleConfirm(true)}
              className="rounded-lg bg-bamboo px-3 py-1 text-[11px] font-medium text-paper hover:bg-bamboo/90 disabled:opacity-50"
            >
              {confirming ? "处理中…" : "确认执行"}
            </button>
            <button
              type="button"
              disabled={confirming}
              onClick={() => void handleConfirm(false)}
              className="rounded-lg border border-paper-deep/20 px-3 py-1 text-[11px] text-ink-ghost hover:text-ink disabled:opacity-50"
            >
              取消任务
            </button>
          </div>
        </div>
      )}

      {/* 组卡成文落盘成功：横幅 + 打开笔记 */}
      {isWriteupDone && createdNote && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-bamboo/30 bg-bamboo/10 px-2.5 py-2">
          <div className="min-w-0 truncate text-[11.5px] text-ink">
            已生成笔记《{createdNote.title || "画布整理成文"}》
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => onContinueChapter?.(createdNote)}
              className="rounded-lg bg-bamboo px-2.5 py-1 text-[10.5px] font-medium text-paper hover:bg-bamboo/90 cursor-pointer"
              title="让 Agent 接着这篇笔记续写下一章（追加保存）"
            >
              继续写下一章
            </button>
            <button
              type="button"
              onClick={() => dispatchOpenNote(createdNote.id)}
              className="rounded-lg border border-paper-deep/20 px-2.5 py-1 text-[10.5px] font-medium text-ink-soft hover:bg-bamboo/15 cursor-pointer"
            >
              打开笔记
            </button>
            <button
              type="button"
              onClick={() => setDoneDismissed(true)}
              className="rounded-lg border border-paper-deep/20 px-2 py-1 text-[10.5px] text-ink-ghost hover:text-ink cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* 结果汇总：完成时给出明确的产出提示 */}
      {task.status === "Done" && task.context?.summary != null && (
        <div className="rounded-xl border border-bamboo/30 bg-bamboo/10 px-2.5 py-2 text-[12px] font-medium text-ink">
          ✓ {String(task.context.summary)}
          {isCollectGoal(goal) && (
            <div className="mt-1 text-[10.5px] font-normal text-ink-soft">
              知识卡已放到画布上，可以拖动画布查看或继续追问。
            </div>
          )}
        </div>
      )}
      {task.status === "Failed" && (
        <div className="rounded-xl border border-danger/20 bg-danger/5 px-2.5 py-1.5 text-[11.5px] text-danger">
          {String(task.context?.summary ?? "任务执行失败")}
        </div>
      )}
    </div>
  );
}

/** 步骤展开详情：执行·工具 / 上下文·输入 / 记忆·召回 / 产出·结果 / 日志 */
function StepDetail({ step, logs }: { step: AgentStep; logs: AgentStepLog[] }) {
  const output = step.output as Record<string, unknown> | null | undefined;
  const memoryContext =
    typeof output?.context === "string" && output.context.trim() ? output.context : null;
  return (
    <div className="mb-1.5 ml-3 space-y-1.5 rounded-lg border border-paper-deep/15 bg-paper-warm/40 p-2">
      <StepSection title="执行 · 工具">
        <span className="font-mono text-[10.5px] text-ink-soft">
          {step.tool ?? step.kind}
          <span className="ml-1.5 text-ink-ghost">({friendlyStepName(step)})</span>
        </span>
      </StepSection>
      {step.input && (
        <StepSection title="上下文 · 输入">{formatStepInput(step.input)}</StepSection>
      )}
      {memoryContext && (
        <StepSection title="记忆 · 召回">
          <div className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[10.5px] leading-relaxed text-ink">
            {memoryContext}
          </div>
        </StepSection>
      )}
      {output != null && (
        <StepSection title="产出 · 结果">{formatStepOutput(output)}</StepSection>
      )}
      {logs.length > 0 && (
        <StepSection title="日志">
          <ul className="space-y-0.5">
            {logs.map((log, index) => (
              <li key={index} className="text-[10px] leading-relaxed text-ink-ghost">
                <span className="mr-1 text-ink-ghost/60">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                {log.message}
              </li>
            ))}
          </ul>
        </StepSection>
      )}
    </div>
  );
}

function StepSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[9.5px] font-medium tracking-wide text-ink-ghost">{title}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/** 步骤输入格式化：prompt/promptTemplate 直接展示文本，其余参数以键值对展示 */
function formatStepInput(input: Record<string, unknown>): ReactNode {
  const prompt =
    typeof input.prompt === "string"
      ? input.prompt
      : typeof input.promptTemplate === "string"
        ? input.promptTemplate
        : null;
  if (prompt !== null) {
    return (
      <div className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded bg-paper/70 p-1.5 text-[10.5px] leading-relaxed text-ink">
        {prompt}
      </div>
    );
  }
  const entries = Object.entries(input).filter(([key]) => key !== "prompt" && key !== "promptTemplate");
  if (entries.length === 0) {
    return <span className="text-[10.5px] text-ink-ghost">（无参数）</span>;
  }
  return (
    <dl className="space-y-0.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-[10.5px] leading-relaxed">
          <dt className="shrink-0 text-ink-ghost">{key}</dt>
          <dd className="min-w-0 break-all text-ink">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 步骤输出格式化：正文 / 搜索结果 / 落卡汇总 / 数组 / JSON */
function formatStepOutput(output: Record<string, unknown>): ReactNode {
  if (typeof output.text === "string" && output.text.trim()) {
    return (
      <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-paper/70 p-1.5 text-[10.5px] leading-relaxed text-ink">
        {output.text}
      </div>
    );
  }
  if (typeof output.summary === "string") {
    return <div className="text-[10.5px] text-ink">{output.summary}</div>;
  }
  if (Array.isArray(output.results)) {
    const results = output.results as Array<Record<string, unknown>>;
    if (results.length === 0) {
      return (
        <div className="text-[10.5px] text-ink-ghost">
          {typeof output.notice === "string" ? output.notice : "无结果"}
        </div>
      );
    }
    return (
      <ul className="space-y-1">
        {results.map((result, index) => (
          <li key={index} className="text-[10.5px] leading-relaxed text-ink">
            <span className="font-medium">{(result.title as string) ?? `结果 ${index + 1}`}</span>
            {typeof result.url === "string" && result.url && (
              <span className="ml-1.5 break-all font-mono text-[9.5px] text-bamboo">
                {result.url}
              </span>
            )}
            {typeof result.content === "string" && result.content && (
              <div className="text-ink-ghost">{result.content}</div>
            )}
          </li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(output)) {
    const items = output as Array<Record<string, unknown>>;
    if (items.length === 0) {
      return <span className="text-[10.5px] text-ink-ghost">（空）</span>;
    }
    return (
      <ul className="space-y-0.5">
        {items.map((item, index) => (
          <li key={index} className="text-[10.5px] text-ink">
            {(item.title as string) ?? (item.id as string) ?? JSON.stringify(item)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-paper/70 p-1.5 text-[10px] leading-relaxed text-ink">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}

/** 是否是知识采集类任务（完成后提示产出已落画布） */
function isCollectGoal(goal: string): boolean {
  return goal.startsWith("知识采集");
}

function logsFor(task: AgentTask, stepId: string): AgentStepLog[] {
  return task.logs.filter((item) => item.stepId === stepId);
}

function lastLogFor(task: AgentTask, stepId: string): string {
  const log = task.logs.filter((item) => item.stepId === stepId).at(-1);
  return log?.message ?? "";
}
