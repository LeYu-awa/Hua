import { useEffect, useMemo, useState } from "react";
import {
  confirmAgentTask,
  createAndRunAgentTask,
  getAgentTask,
  onAgentStep,
  onAgentTask,
} from "./api";
import type { AgentStep, AgentStepEvent, AgentStepStatus, AgentTask } from "./types";
import { dispatchOpenNote } from "../notes/openNoteEvents";
import { isWriteupGoal } from "./writeupGoal";

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

interface TaskProgressPanelProps {
  goal: string;
  /** 挂载即创建并运行任务（最小闭环入口） */
  autoRun?: boolean;
  /** 已存在的任务（从列表进入时传入，跳过创建） */
  taskId?: string;
}

const AGENT_STEP_DRAG_TYPE = "application/x-floral-agent-step";

function buildStepDragPayload(task: AgentTask, step: AgentStep) {
  return {
    taskId: task.taskId,
    goal: task.goal,
    stepId: step.stepId,
    kind: step.kind,
    tool: step.tool ?? null,
    status: step.status,
    input: step.input,
  };
}

/**
 * 主编排任务进度面板（Phase B 最小闭环的 UI 侧）：
 * 发目标 → Rust 规划执行 → 订阅 agent.step / agent.task 展示进度与结果。
 */
export function TaskProgressPanel({ goal, autoRun = true, taskId }: TaskProgressPanelProps) {
  const [task, setTask] = useState<AgentTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** 组卡成文产出预览（可编辑标题/正文，确认时随 payload 落盘） */
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewReady, setPreviewReady] = useState(false);
  /** 落盘成功横幅关闭态 */
  const [doneDismissed, setDoneDismissed] = useState(false);

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

  const isWriteupDone =
    task?.status === "Done" && isWriteupGoal(goal) && createdNote !== null && !doneDismissed;

  const handleConfirm = async (ok: boolean, payload?: { title?: string; content?: string }) => {
    if (!task || !confirmStep) return;
    setConfirming(true);
    try {
      const next = await confirmAgentTask(task.taskId, confirmStep.stepId, ok, payload);
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
      if (alive && next) setTask(next);
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
          sync(await createAndRunAgentTask(goal));
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
  }, [goal, taskId, autoRun]);

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
      {/* 头部：目标 + 状态 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{task.goal}</div>
          <div className="mt-0.5 text-[10px] text-ink-ghost">{task.taskId}</div>
        </div>
        <span
          className={`shrink-0 rounded-full border border-paper-deep/15 px-2 py-0.5 text-[10px] font-medium ${TASK_STATUS_STYLE[task.status] ?? ""}`}
        >
          {TASK_STATUS_LABEL[task.status] ?? task.status}
        </span>
      </div>

      {/* 步骤进度 */}
      {task.plan.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {task.plan.map((step) => (
            <li
              key={step.stepId}
              draggable
              onDragStart={(event) => {
                const payload = buildStepDragPayload(task, step);
                event.dataTransfer.setData(AGENT_STEP_DRAG_TYPE, JSON.stringify(payload));
                event.dataTransfer.setData(
                  "text/plain",
                  `${step.tool ?? step.kind} · ${task.goal}`,
                );
                event.dataTransfer.effectAllowed = "copy";
              }}
              title="拖拽到画布生成任务卡片"
              className="flex cursor-grab items-center gap-2 rounded-lg px-1 py-0.5 transition hover:bg-bamboo-mist/40 active:cursor-grabbing"
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${STEP_STATUS_STYLE[step.status] ?? ""}`}
              >
                {STEP_STATUS_ICON[step.status]}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                {step.tool ?? step.kind}
              </span>
              <span className="shrink-0 text-[10px] text-ink-ghost">
                {lastLogFor(task, step.stepId)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* 待确认操作：写/产出型工具在落盘前需用户确认 */}
      {confirmStep && showWriteupPreview && llmOutput !== null && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
          <div className="text-[11px] font-semibold text-ink">
            成文预览（来自画布 {goal.replace(/^.*?(\d+) 张卡片.*$/, "$1") || ""} 张卡片）
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
          <div className="text-[11px] font-semibold text-ink">需要确认后继续</div>
          <div className="mt-1 break-all text-[11px] text-ink">
            {confirmStep.tool ?? confirmStep.kind}：
            {String(JSON.stringify(confirmStep.input ?? {}))}
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
              onClick={() => dispatchOpenNote(createdNote.id)}
              className="rounded-lg bg-bamboo px-2.5 py-1 text-[10.5px] font-medium text-paper hover:bg-bamboo/90 cursor-pointer"
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

      {/* 结果汇总 */}
      {task.status === "Done" && task.context?.summary != null && (
        <div className="rounded-xl border border-bamboo/20 bg-bamboo/5 px-2.5 py-1.5 text-[11.5px] text-ink">
          {String(task.context.summary)}
        </div>
      )}
      {task.status === "Failed" && (
        <div className="rounded-xl border border-danger/20 bg-danger/5 px-2.5 py-1.5 text-[11.5px] text-danger">
          {String(task.context?.summary ?? "任务执行失败")}
        </div>
      )}

      {/* 执行日志 */}
      {task.logs.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none text-[10px] text-ink-ghost hover:text-ink">
            执行日志（{task.logs.length}）
          </summary>
          <ul className="mt-1 flex max-h-24 flex-col gap-0.5 overflow-y-auto rounded-lg bg-paper-deep/5 p-2">
            {task.logs.map((log, index) => (
              <li key={index} className="text-[10px] leading-relaxed text-ink-ghost">
                <span className="text-bamboo">{log.stepId}</span> {log.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function lastLogFor(task: AgentTask, stepId: string): string {
  const log = task.logs.filter((item) => item.stepId === stepId).at(-1);
  return log?.message ?? "";
}
