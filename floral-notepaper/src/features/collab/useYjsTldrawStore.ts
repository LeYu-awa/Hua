import { useCallback, useEffect, useState } from "react";
import { createTLStore } from "@tldraw/editor";
import type { TLStoreWithStatus } from "@tldraw/editor";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { supabase } from "../auth/supabase";
import { YjsSupabaseProvider } from "./y-provider-supabase";
import type { ProviderStatus } from "./y-provider-supabase";

/**
 * 操作级多人画布同步引擎。
 *
 * 核心思路：
 * 1. tldraw store 发生本地变化时，store.listen() 返回精确的 HistoryEntry
 *    （包含 added/updated/removed 记录映射）
 * 2. 将这些记录逐个写入 Y.Map（key=record.id，value=record）
 * 3. Yjs 通过 CRDT 算法自动合并来自多个用户的并发写入
 * 4. Y.Map 的 observe 事件精确告知哪些 key 发生了变化
 * 5. 将这些变化通过 store.mergeRemoteChanges() + store.put()/store.remove() 应用到远端 store
 *
 * 相比全量快照同步的优势：
 * - 冲突粒度：按记录（单个 shape/binding）而不是全量覆盖
 * - 带宽：仅传输变化的记录，而非整个状态
 * - 合并：Yjs CRDT 天然支持多人并发创建/编辑/删除
 */
export function useYjsTldrawStore(
  docId: string | null,
  ydocRef?: React.MutableRefObject<Y.Doc | null>,
): TLStoreWithStatus | null {
  const [result, setResult] = useState<TLStoreWithStatus | null>(null);
  const [connStatus, setConnStatus] = useState<ProviderStatus>("disconnected");

  const handleStatusChange = useCallback((status: ProviderStatus) => {
    setConnStatus(status);
  }, []);

  useEffect(() => {
    if (!docId) {
      setResult(null);
      return;
    }

    let cancelled = false;
    let provider: YjsSupabaseProvider | null = null;
    let persistence: IndexeddbPersistence | null = null;
    let cleanup: (() => void) | undefined;
    const store = createTLStore({ defaultName: "Canvas" });

    const init = async () => {
      // 1. 获取用户信息
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? "anonymous";
      const userName =
        userData.user?.email?.split("@")[0] ?? "用户" + userId.slice(0, 4);

      if (cancelled) return;

      // 2. 创建 Yjs Provider（含连接状态追踪）
      provider = new YjsSupabaseProvider({
        supabase,
        documentId: `tldraw:${docId}`,
        userId,
        _userName: userName,
        onStatusChange: handleStatusChange,
      });

      if (cancelled) {
        provider.destroy();
        return;
      }

      const ydoc = provider.doc;
      if (ydocRef) ydocRef.current = ydoc;

      // 3.5. 接入 IndexedDB 离线持久化（y-indexeddb）
      persistence = new IndexeddbPersistence(`tldraw:${docId}`, ydoc);
      await persistence.whenSynced;

      // 所有画布记录存储在 Y.Map 中，key = record.id, value = record
      const yCanvas = ydoc.getMap("tldraw-canvas");

      // ---- 同步防回环标记 ----
      let applyingFromRemote = false;
      let applyingFromLocal = false;

      // 4. 初始加载：从 Yjs 已有的记录恢复到 store
      if (yCanvas.size > 0) {
        applyingFromRemote = true;
        store.mergeRemoteChanges(() => {
          const records: any[] = [];
          yCanvas.forEach((value) => {
            if (value && typeof value === "object" && "id" in value) {
              records.push(value);
            }
          });
          if (records.length > 0) {
            store.put(records);
          }
        });
        applyingFromRemote = false;
      }

      // ============================================================
      // 5. 本地变化 → Yjs（操作级同步）
      // ============================================================
      const unsubStore = store.listen(
        (entry) => {
          if (applyingFromRemote || cancelled) return;

          applyingFromLocal = true;
          try {
            ydoc.transact(() => {
              for (const [id, record] of Object.entries(entry.changes.added)) {
                yCanvas.set(id, record);
              }
              for (const [id, [, to]] of Object.entries(entry.changes.updated)) {
                yCanvas.set(id, to);
              }
              for (const id of Object.keys(entry.changes.removed)) {
                yCanvas.delete(id);
              }
            });
          } finally {
            applyingFromLocal = false;
          }
        },
        { source: "user", scope: "document" },
      );

      // ============================================================
      // 6. Yjs 远程变化 → Store
      // ============================================================
      const observeYMap = (event: any) => {
        if (applyingFromLocal || cancelled) return;

        applyingFromRemote = true;
        try {
          store.mergeRemoteChanges(() => {
            event.keys.forEach((change: { action: string }, key: string) => {
              if (change.action === "delete") {
                store.remove([key as any]);
              } else {
                const record = yCanvas.get(key);
                if (record && typeof record === "object" && "id" in record) {
                  store.put([record as any]);
                }
              }
            });
          });
        } finally {
          applyingFromRemote = false;
        }
      };
      yCanvas.observe(observeYMap);

      // 7. 输出 store 状态
      cleanup = () => {
        unsubStore();
        yCanvas.unobserve(observeYMap);
        if (ydocRef) ydocRef.current = null;
        persistence?.destroy();
        provider?.destroy();
      };

      if (!cancelled) {
        setResult({
          status: "synced-remote",
          connectionStatus: "online",
          store,
        });
      }
    };

    init();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [docId, handleStatusChange]);

  // 当连接状态变化时更新 result 的 connectionStatus
  useEffect(() => {
    if (!result || result.status !== "synced-remote") return;
    setResult({
      ...result,
      connectionStatus: connStatus === "connected" ? "online" : "offline",
    } as TLStoreWithStatus);
  }, [connStatus]);

  return result;
}
