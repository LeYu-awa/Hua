import { useCallback, useEffect, useRef, useState } from "react";
import { createDiaryEntry, listDiaryEntries } from "./api";
import { composeDiaryContent, type DiarySourceMessage } from "./composeDiaryContent";
import { dispatchDiaryCreated } from "./diaryEvents";
import type { ProviderConfig } from "../settings/types";

/**
 * 日记提议状态机（diary S1）
 *
 * 监听当前活跃对话任务，满足条件时把状态置为 visible（渲染提议卡）：
 * - 本任务用户消息 ≥ 2 条
 * - 今日该任务尚无日记条目
 * - 距上次提议超过 30 分钟冷却
 * - 未被"今天不提醒"标记
 *
 * 确认后 composeDiaryContent（LLM 整理 / 摘录回退）→ diary_create →
 * 广播 dispatchDiaryCreated 通知日记页刷新。
 */

export type DiarySuggestionStatus = "idle" | "visible" | "working" | "done" | "error";

const STORAGE_KEY = "diary_suggestion_state";
const COOLDOWN_MS = 30 * 60 * 1000;
const MIN_USER_MESSAGES = 2;

interface PersistedState {
  lastPromptAt: number;
  ignoredToday: string;
}

function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function loadPersisted(): PersistedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return {
        lastPromptAt: typeof parsed.lastPromptAt === "number" ? parsed.lastPromptAt : 0,
        ignoredToday: typeof parsed.ignoredToday === "string" ? parsed.ignoredToday : "",
      };
    }
  } catch {
    // ignore
  }
  return { lastPromptAt: 0, ignoredToday: "" };
}

function savePersisted(state: PersistedState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export interface UseDiarySuggestionOptions {
  taskId: string;
  messages: DiarySourceMessage[];
  providers: ProviderConfig[];
}

export function useDiarySuggestion({ taskId, messages, providers }: UseDiarySuggestionOptions) {
  const [status, setStatus] = useState<DiarySuggestionStatus>("idle");
  const [recordedToday, setRecordedToday] = useState(false);
  const providersRef = useRef(providers);
  providersRef.current = providers;

  // 任务切换时重查"今日是否已沉淀"并重置状态
  useEffect(() => {
    setStatus("idle");
    if (!taskId) {
      setRecordedToday(false);
      return;
    }
    let cancelled = false;
    const today = todayKey();
    listDiaryEntries({ startDate: today, endDate: today, conversationId: taskId })
      .then((entries) => {
        if (!cancelled) setRecordedToday(entries.length > 0);
      })
      .catch(() => {
        if (!cancelled) setRecordedToday(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // 触发检测：满足条件且不在冷却/忽略中 → visible
  useEffect(() => {
    if (!taskId) return;
    // 今日已沉淀（含确认成功后）→ 隐藏卡片；working/done/error 由用户交互驱动，不自动重触发
    if (recordedToday) {
      if (status === "visible" || status === "working") setStatus("idle");
      return;
    }
    if (status === "visible" || status === "working" || status === "done" || status === "error") {
      return;
    }

    const userCount = messages.filter(
      (message) => message.role === "user" && message.content.trim().length > 0,
    ).length;
    if (userCount < MIN_USER_MESSAGES) return;

    const persisted = loadPersisted();
    if (persisted.ignoredToday === todayKey()) return;
    if (Date.now() - persisted.lastPromptAt < COOLDOWN_MS) return;

    setStatus("visible");
  }, [taskId, messages, recordedToday, status]);

  const confirm = useCallback(async () => {
    if (!taskId) return;
    setStatus("working");
    try {
      const { title, content } = await composeDiaryContent(messages, providersRef.current);
      await createDiaryEntry({
        title,
        content,
        entryDate: todayKey(),
        conversationId: taskId,
        sourceMessageIds: messages.map((message) => String(message.createdAt)),
      });
      const persisted = loadPersisted();
      savePersisted({ lastPromptAt: Date.now(), ignoredToday: persisted.ignoredToday });
      setRecordedToday(true);
      setStatus("done");
      dispatchDiaryCreated();
    } catch {
      setStatus("error");
    }
  }, [taskId, messages]);

  /** 稍后再说：进入 30 分钟冷却 */
  const dismissLater = useCallback(() => {
    const persisted = loadPersisted();
    savePersisted({ lastPromptAt: Date.now(), ignoredToday: persisted.ignoredToday });
    setStatus("idle");
  }, []);

  /** 今天不提醒：当天不再触发 */
  const dismissToday = useCallback(() => {
    savePersisted({ lastPromptAt: Date.now(), ignoredToday: todayKey() });
    setStatus("idle");
  }, []);

  return { status, recordedToday, confirm, dismissLater, dismissToday };
}
