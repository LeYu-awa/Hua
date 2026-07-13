import { useEffect, useRef } from "react";
import type { Editor } from "@tldraw/tldraw";
import { analyzeAgentConversation, recordAgentEvents } from "./api";
import type { AgentEventInput, AgentEventType } from "./types";

interface UseCanvasAgentCollectorOptions {
  editor: Editor | null;
  conversationId: string | null;
  userId: string | null;
}

const FLUSH_DELAY_MS = 500;
const MAX_BATCH_SIZE = 50;

export function useCanvasAgentCollector({
  editor,
  conversationId,
  userId,
}: UseCanvasAgentCollectorOptions) {
  const queueRef = useRef<AgentEventInput[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!editor || !conversationId || !userId) return;

    const flush = () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      const events = queueRef.current.splice(0, MAX_BATCH_SIZE);
      if (events.length === 0) return;

      recordAgentEvents(events)
        .then(() => analyzeAgentConversation(conversationId))
        .catch((error) => {
          console.warn("Agent event collection failed", error);
        });

      if (queueRef.current.length > 0) {
        flushTimerRef.current = window.setTimeout(flush, FLUSH_DELAY_MS);
      }
    };

    const enqueue = (events: AgentEventInput[]) => {
      if (events.length === 0) return;
      queueRef.current.push(...events);

      if (queueRef.current.length >= MAX_BATCH_SIZE) {
        flush();
        return;
      }

      if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(flush, FLUSH_DELAY_MS);
      }
    };

    const unsubscribe = editor.store.listen(
      (entry) => {
        const timestamp = new Date().toISOString();
        const events: AgentEventInput[] = [];

        for (const record of Object.values(entry.changes.added)) {
          const event = buildRecordEvent(
            "added",
            record,
            conversationId,
            userId,
            timestamp,
          );
          if (event) events.push(event);
        }

        for (const [, to] of Object.values(entry.changes.updated)) {
          const event = buildRecordEvent(
            "updated",
            to,
            conversationId,
            userId,
            timestamp,
          );
          if (event) events.push(event);
        }

        for (const record of Object.values(entry.changes.removed)) {
          const event = buildRecordEvent(
            "removed",
            record,
            conversationId,
            userId,
            timestamp,
          );
          if (event) events.push(event);
        }

        enqueue(events);
      },
      { source: "user", scope: "document" },
    );

    return () => {
      unsubscribe();
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flush();
      queueRef.current = [];
    };
  }, [conversationId, editor, userId]);
}

function buildRecordEvent(
  action: "added" | "updated" | "removed",
  record: unknown,
  conversationId: string,
  userId: string,
  timestamp: string,
): AgentEventInput | null {
  if (!isRecordObject(record)) return null;

  if (record.typeName === "shape") {
    return {
      conversationId,
      userId,
      eventType: `canvas_shape_${action}` as AgentEventType,
      timestamp,
      payload: buildShapePayload(record, userId),
    };
  }

  if (record.typeName === "binding") {
    return {
      conversationId,
      userId,
      eventType: `canvas_binding_${action}` as AgentEventType,
      timestamp,
      payload: buildBindingPayload(record, userId),
    };
  }

  return null;
}

function buildShapePayload(record: Record<string, unknown>, userId: string) {
  const props = asObject(record.props);

  return {
    nodeId: String(record.id ?? ""),
    shapeType: String(record.type ?? ""),
    text: extractShapeText(props),
    x: numberValue(record.x),
    y: numberValue(record.y),
    w: numberValue(props.w),
    h: numberValue(props.h),
    authorId: userId,
    props,
  };
}

function buildBindingPayload(record: Record<string, unknown>, userId: string) {
  return {
    bindingId: String(record.id ?? ""),
    bindingType: String(record.type ?? ""),
    fromId: readNestedString(record, ["fromId", "fromShapeId", "from"]),
    toId: readNestedString(record, ["toId", "toShapeId", "to"]),
    authorId: userId,
  };
}

function extractShapeText(props: Record<string, unknown>) {
  const text = props.text;
  if (typeof text === "string") return text;

  const richText = props.richText;
  if (!richText) return "";

  const parts: string[] = [];
  collectText(richText, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function collectText(value: unknown, parts: string[]) {
  if (typeof value === "string") {
    parts.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts);
    return;
  }

  if (!isRecordObject(value)) return;

  if (typeof value.text === "string") {
    parts.push(value.text);
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "text") continue;
    collectText(child, parts);
  }
}

function readNestedString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asObject(value: unknown): Record<string, unknown> {
  return isRecordObject(value) ? value : {};
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
