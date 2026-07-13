import { useEffect, useRef } from "react";
import { Editor } from "@tldraw/tldraw";
import * as Y from "yjs";

interface PresenceData {
  userId: string;
  userName: string;
  color: string;
  cursor: { x: number; y: number; type: string; rotation: number };
  selectedShapeIds: string[];
  currentPageId: string;
}

const USER_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
  "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
  "#BB8FCE", "#85C1E9", "#F0B27A", "#82E0AA",
];

function hashColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

/**
 * 通过 Yjs 实时同步用户游标、选中状态和视口信息。
 *
 * 每个用户将自己的状态写入 Y.Map（key = userId），
 * 通过 observe 接收远程用户的游标数据，
 * 在本地 store 中创建 TLInstancePresence 记录，
 * tldraw 自动渲染远程用户的彩色游标。
 */
export function useYjsTldrawPresence(
  editor: Editor | null,
  ydoc: Y.Doc | null,
  userId: string,
  userName: string,
) {
  const lastBroadcastRef = useRef(0);

  useEffect(() => {
    if (!editor || !ydoc) return;

    const yPresence = ydoc.getMap<PresenceData>("user-presence");
    const color = hashColor(userId);
    let destroyed = false;

    // ── 1. 定期广播本用户状态 ──
    const broadcast = () => {
      if (destroyed) return;

      const now = Date.now();
      if (now - lastBroadcastRef.current < 50) return; // 限制 50ms
      lastBroadcastRef.current = now;

      const cursor = editor.inputs.currentPagePoint;
      try {
        ydoc!.transact(() => {
          yPresence.set(userId, {
            userId,
            userName,
            color,
            cursor: {
              x: cursor.x,
              y: cursor.y,
              type: editor.getInstanceState().cursor.type,
              rotation: editor.getInstanceState().cursor.rotation ?? 0,
            },
            selectedShapeIds: editor.getSelectedShapeIds() as string[],
            currentPageId: editor.getCurrentPageId() as string,
          });
        });
      } catch {
        // 忽略 transact 异常
      }
    };

    // store 变化时广播（涵盖指针、选中、视口等所有变化）
    const handleChange = () => broadcast();
    editor.on("change", handleChange);

    // 初始广播 + 定时刷新（兜底）
    broadcast();
    const interval = setInterval(broadcast, 2000);

    // ── 2. 接收远程用户状态 → 创建 Presence 记录 ──
    const observePresence = (event: Y.YMapEvent<PresenceData>) => {
      if (destroyed) return;

      const records: any[] = [];

      event.keys.forEach((change, key) => {
        if (key === userId) return; // 忽略自己

        if (change.action === "delete") {
          records.push({ id: `instance_presence:${key}`, typeName: "instance_presence" as const });
        } else {
          const data = yPresence.get(key);
          if (!data) return;

          const now = Date.now();
          records.push({
            id: `instance_presence:${key}`,
            typeName: "instance_presence",
            userId: data.userId,
            userName: data.userName,
            color: data.color,
            cursor: data.cursor,
            selectedShapeIds: data.selectedShapeIds,
            currentPageId: data.currentPageId,
            followingUserId: null,
            brush: null,
            scribble: null,
            chatMessage: "",
            screenBounds: { x: 0, y: 0, w: 0, h: 0 },
            lastActivityTimestamp: now,
            meta: {},
            blurred: false,
          });
        }
      });

      if (records.length > 0) {
        try {
          editor.store.mergeRemoteChanges(() => {
            const toPut = records.filter((r) => r.cursor);
            const toRemove = records.filter((r) => !r.cursor);
            if (toPut.length > 0) editor.store.put(toPut as any);
            for (const r of toRemove) {
              editor.store.remove([r.id as any]);
            }
          });
        } catch {
          // 忽略 store 写入异常
        }
      }
    };
    yPresence.observe(observePresence);

    return () => {
      destroyed = true;
      clearInterval(interval);
      editor.off("change", handleChange);

      // 清理：移除本用户的 presence 记录
      try {
        ydoc!.transact(() => {
          yPresence.delete(userId);
        });
      } catch {
        // ignore
      }
      yPresence.unobserve(observePresence);
    };
  }, [editor, ydoc, userId, userName]);
}
