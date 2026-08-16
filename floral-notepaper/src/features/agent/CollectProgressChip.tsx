import { useEffect, useRef, useState } from "react";
import { confirmAgentTask, onAgentAwaitingConfirm, onAgentTask } from "./api";
import type { AgentTask } from "./types";

/** 采集任务的最长等待时间：超过则提示超时（LLM 60s 超时 + 搜索 15s + 重试，正常 3 分钟内必完成） */
const COLLECT_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * 知识采集状态胶囊（全自动流水线的最小反馈）：
 * 用户提问后不弹任务面板，只在左下角显示一行轻量进度；完成后自动消失。
 * - 任务进入 AwaitingConfirm 时自动放行确认（兼容旧后端仍带确认步骤的版本），
 *   保证"问 → 卡落画布"全自动；
 * - 超过 3 分钟仍未完成时显示超时提示，避免无限转圈。
 */
export function CollectProgressChip({
  goal,
  onFinished,
}: {
  goal: string;
  onFinished: () => void;
}) {
  const [state, setState] = useState<"running" | "done" | "failed">("running");
  const [summary, setSummary] = useState("");
  const taskIdRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let hideTimer: number | undefined;
    let timeoutTimer: number | undefined;
    let unlistenTask: (() => void) | undefined;
    let unlistenConfirm: (() => void) | undefined;

    onAgentTask((task: AgentTask) => {
      if (disposed || task.goal !== goal) return;
      taskIdRef.current = task.taskId;
      if (task.status === "AwaitingConfirm") {
        // 全自动流程：后端（含旧版本）还在等确认时直接放行
        const pending = task.plan.find(
          (step) =>
            step.requiredConfirm &&
            !step.confirmed &&
            !["Done", "Cancelled", "Failed"].includes(step.status),
        );
        if (pending) {
          void confirmAgentTask(task.taskId, pending.stepId, true).catch(() => {});
        }
        return;
      }
      if (task.status === "Done") {
        setState("done");
        setSummary(String(task.context?.summary ?? "已采集知识卡"));
        if (hideTimer !== undefined) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          if (!disposed) onFinished();
        }, 2600);
      } else if (task.status === "Failed") {
        setState("failed");
        setSummary(String(task.context?.summary ?? "采集失败"));
      }
    }).then((fn) => {
      unlistenTask = fn;
    });

    // 待确认事件兜底（订阅晚于事件发出时，上面的 agent.task 分支同样会处理）
    onAgentAwaitingConfirm((event) => {
      if (disposed || taskIdRef.current === null || event.taskId !== taskIdRef.current) return;
      void confirmAgentTask(event.taskId, event.stepId, true).catch(() => {});
    }).then((fn) => {
      unlistenConfirm = fn;
    });

    // 超时看门狗：任何未预料的挂起都不让用户无限等待
    timeoutTimer = window.setTimeout(() => {
      if (!disposed) {
        setState("failed");
        setSummary("采集超时（网络或 AI 服务无响应），请重试");
      }
    }, COLLECT_TIMEOUT_MS);

    return () => {
      disposed = true;
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      if (timeoutTimer !== undefined) window.clearTimeout(timeoutTimer);
      unlistenTask?.();
      unlistenConfirm?.();
    };
  }, [goal, onFinished]);

  if (state === "running") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-bamboo/25 bg-paper/95 px-3 py-1.5 shadow-sm backdrop-blur">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-bamboo/30 border-t-bamboo" />
        <span className="text-[11px] text-ink-soft">花灵正在联网搜索并提炼知识卡…</span>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-coral/30 bg-paper/95 px-3 py-1.5 shadow-sm backdrop-blur">
        <span className="text-[11px] text-coral">✕ {summary}</span>
        <button
          type="button"
          onClick={onFinished}
          className="text-[10px] text-ink-ghost hover:text-ink cursor-pointer"
        >
          关闭
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-bamboo/40 bg-bamboo/10 px-3 py-1.5 shadow-sm backdrop-blur">
      <span className="text-[11px] font-medium text-bamboo">✓ {summary}</span>
    </div>
  );
}
