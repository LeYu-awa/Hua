import { useCallback, useEffect, useRef } from "react";
import type { InkEvent, InkEventType, InkSessionSource } from "../features/ink/types";
import { appendInkEvents } from "../features/ink/api";

export interface UseInkRecorderOptions {
  /** 当前编辑对象的 ID */
  noteId: string;
  /** 事件来源 */
  source: InkSessionSource;
  /** Agent 总开关 */
  enabled: boolean;
  /** 批量 flush 的间隔（ms），默认 2000 */
  flushIntervalMs?: number;
  /** 单个 session 事件数上限，默认 10000 */
  maxEventsPerSession?: number;
  /** 事件生成后回调（调试用） */
  onEvent?: (event: InkEvent) => void;
}

interface PendingEvents {
  events: InkEvent[];
  noteId: string;
  sessionId: string;
  source: InkSessionSource;
}

let globalSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function resetInkSession() {
  globalSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 简单的文本差异算法。
 * 先找最长公共前缀，再找最长公共后缀，中间的差异区域视为删除/插入。
 */
export function diffText(
  prev: string,
  next: string,
): Array<{ type: "insert" | "delete"; index: number; text?: string; length?: number }> {
  const prevLen = prev.length;
  const nextLen = next.length;

  let prefix = 0;
  while (prefix < prevLen && prefix < nextLen && prev[prefix] === next[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < prevLen - prefix &&
    suffix < nextLen - prefix &&
    prev[prevLen - 1 - suffix] === next[nextLen - 1 - suffix]
  ) {
    suffix++;
  }

  const ops: Array<{ type: "insert" | "delete"; index: number; text?: string; length?: number }> =
    [];
  const middlePrev = prev.slice(prefix, prevLen - suffix);
  const middleNext = next.slice(prefix, nextLen - suffix);

  if (middlePrev.length > 0) {
    ops.push({ type: "delete", index: prefix, length: middlePrev.length });
  }
  if (middleNext.length > 0) {
    ops.push({ type: "insert", index: prefix, text: middleNext });
  }

  return ops;
}

export function useInkRecorder(options: UseInkRecorderOptions) {
  const {
    noteId,
    source,
    enabled,
    flushIntervalMs = 2000,
    maxEventsPerSession = 10000,
    onEvent,
  } = options;

  const pendingRef = useRef<PendingEvents>({
    events: [],
    noteId,
    sessionId: globalSessionId,
    source,
  });
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastValueRef = useRef<string>("");
  const lastSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const enabledRef = useRef(enabled);
  const noteIdRef = useRef(noteId);
  const sourceRef = useRef(source);

  const flush = useCallback(async () => {
    const pending = pendingRef.current;
    if (pending.events.length === 0) return;

    const batch = pending.events;
    pending.events = [];

    try {
      await appendInkEvents({
        noteId: pending.noteId,
        sessionId: pending.sessionId,
        source: pending.source,
        events: batch,
      });
    } catch {
      // 失败时把事件放回队列，避免丢失
      pending.events.unshift(...batch);
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = setTimeout(() => {
      void flush();
    }, flushIntervalMs);
  }, [flush, flushIntervalMs]);

  useEffect(() => {
    const wasEnabled = enabledRef.current;
    enabledRef.current = enabled;
    noteIdRef.current = noteId;
    sourceRef.current = source;

    if (pendingRef.current.noteId !== noteId) {
      // 切换笔记时，先 flush 旧笔记的事件
      void flush();
      pendingRef.current = {
        events: [],
        noteId,
        sessionId: globalSessionId,
        source,
      };
    } else if (wasEnabled && !enabled) {
      // Agent 被关闭时，flush 已经生成的事件
      void flush();
    }
  }, [enabled, noteId, source, flush]);

  const pushEvent = useCallback(
    (event: InkEvent) => {
      if (!enabledRef.current) return;
      if (!noteIdRef.current) return;

      const pending = pendingRef.current;
      if (pending.events.length >= maxEventsPerSession) {
        // 超过上限后进入低密度采样：只记录光标/选择变化，不记录每次文本 diff
        if (event.type !== "cursor" && event.type !== "select") {
          return;
        }
      }

      pending.events.push(event);
      onEvent?.(event);
      scheduleFlush();
    },
    [maxEventsPerSession, onEvent, scheduleFlush],
  );

  const buildEvent = useCallback(
    (
      type: InkEventType,
      index: number,
      extras: { text?: string; length?: number; selectionStart?: number; selectionEnd?: number },
    ): InkEvent => {
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        sessionId: globalSessionId,
        noteId: noteIdRef.current,
        source: sourceRef.current,
        type,
        index,
        text: extras.text,
        length: extras.length,
        selectionStart: extras.selectionStart,
        selectionEnd: extras.selectionEnd,
        timestamp: Date.now(),
      };
    },
    [],
  );

  const recordTextChange = useCallback(
    (next: string, selectionStart: number, selectionEnd: number) => {
      if (!enabledRef.current) return;

      const prev = lastValueRef.current;
      const ops = diffText(prev, next);
      for (const op of ops) {
        if (op.type === "insert") {
          pushEvent(
            buildEvent("insert", op.index, {
              text: op.text,
              selectionStart,
              selectionEnd,
            }),
          );
        } else if (op.type === "delete") {
          pushEvent(
            buildEvent("delete", op.index, {
              length: op.length,
              selectionStart,
              selectionEnd,
            }),
          );
        }
      }

      lastValueRef.current = next;
      lastSelectionRef.current = { start: selectionStart, end: selectionEnd };
    },
    [buildEvent, pushEvent],
  );

  const recordCursor = useCallback(
    (selectionStart: number, selectionEnd: number) => {
      if (!enabledRef.current) return;
      if (
        lastSelectionRef.current.start === selectionStart &&
        lastSelectionRef.current.end === selectionEnd
      ) {
        return;
      }

      pushEvent(
        buildEvent("cursor", selectionStart, {
          selectionStart,
          selectionEnd,
        }),
      );
      lastSelectionRef.current = { start: selectionStart, end: selectionEnd };
    },
    [buildEvent, pushEvent],
  );

  const recordPaste = useCallback(
    (
      insertedText: string,
      newValue: string,
      index: number,
      selectionStart: number,
      selectionEnd: number,
    ) => {
      if (!enabledRef.current) return;

      pushEvent(
        buildEvent("paste", index, {
          text: insertedText,
          selectionStart,
          selectionEnd,
        }),
      );
      lastValueRef.current = newValue;
      lastSelectionRef.current = { start: selectionStart, end: selectionEnd };
    },
    [buildEvent, pushEvent],
  );

  const initValue = useCallback(
    (value: string) => {
      const shouldSnapshot =
        enabledRef.current && noteIdRef.current && lastValueRef.current !== value;
      lastValueRef.current = value;
      if (shouldSnapshot) {
        pushEvent(
          buildEvent("snapshot", 0, {
            text: value,
          }),
        );
      }
    },
    [buildEvent, pushEvent],
  );

  // 组件卸载或页面离开时 flush
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
      // beforeunload 中无法使用异步，同步发送 pending 事件
      const pending = pendingRef.current;
      if (pending.events.length > 0) {
        const events = pending.events;
        pending.events = [];
        void appendInkEvents({
          noteId: pending.noteId,
          sessionId: pending.sessionId,
          source: pending.source,
          events,
        });
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
      void flush();
    };
  }, [flush]);

  return {
    recordTextChange,
    recordCursor,
    recordPaste,
    initValue,
    flush,
  };
}
