// ============================================
// useYDoc — Yjs 文档生命周期 Hook
// 1. 从 DB 加载已有内容
// 2. 创建 Y.Doc 并写入内容
// 3. 通过 Supabase Realtime 同步远程变更
// 4. 自动持久化到 DB
// ============================================

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../auth/supabase";
import { YjsSupabaseProvider } from "./y-provider-supabase";
import { getDocumentContent, saveDocumentContent } from "./api";

interface UseYDocOptions {
  documentId: string | null;
  _title: string;
}

interface UseYDocResult {
  /** 编辑器内容（双向绑定） */
  content: string;
  /** 设置编辑器内容 */
  setContent: (value: string) => void;
  /** 保存状态 */
  saveState: "idle" | "syncing" | "saved" | "error";
  /** 在线协作者列表 */
  peers: Array<{ id: string; name: string; avatar: string | null }>;
  /** Yjs 提供器实例（用于高级操作） */
  provider: YjsSupabaseProvider | null;
}

export function useYDoc({ documentId }: UseYDocOptions): UseYDocResult {
  const [content, setContentState] = useState("");
  const [saveState, setSaveState] = useState<UseYDocResult["saveState"]>("idle");
  const [peers, setPeers] = useState<UseYDocResult["peers"]>([]);
  const [provider, setProvider] = useState<YjsSupabaseProvider | null>(null);

  const isLocalChange = useRef(false);
  const providerRef = useRef<YjsSupabaseProvider | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDocIdRef = useRef<string | null>(null);

  // ---- 创建/销毁 Y.Doc（加载 DB 内容 → 创建 Provider → 绑定 UI） ----
  useEffect(() => {
    if (!documentId) {
      // 没有文档 → 清理
      if (providerRef.current) {
        providerRef.current.destroy();
        providerRef.current = null;
        setProvider(null);
      }
      setContent("");
      setPeers([]);
      prevDocIdRef.current = null;
      return;
    }

    // 文档 ID 没变 → 跳过（避免重复初始化）
    if (documentId === prevDocIdRef.current) return;
    prevDocIdRef.current = documentId;

    let cancelled = false;

    const init = async () => {
      // 1. 获取当前用户信息
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? "anonymous";
      const userName =
        userData.user?.email?.split("@")[0] ?? "用户" + userId.slice(0, 4);

      // 2. 从 DB 加载已有内容
      let initialContent = "";
      try {
        const doc = await getDocumentContent(documentId);
        if (doc) {
          initialContent = doc.content;
        }
      } catch {
        // DB 加载失败，使用空内容
      }

      if (cancelled) return;

      // 3. 创建 Provider（内部用 initialContent 初始化 Y.Doc）
      const p = new YjsSupabaseProvider({
        supabase,
        documentId,
        userId,
        _userName: userName,
        initialContent,
      });

      if (cancelled) {
        p.destroy();
        return;
      }

      providerRef.current = p;
      setProvider(p);

      // 4. 绑定 Y.Text → React state
      const yText = p.doc.getText("content");

      // 监听远程变化 → 更新 UI
      yText.observe(() => {
        if (!isLocalChange.current) {
          setContentState(yText.toString());
        }
      });

      // 初始化 UI
      setContentState(yText.toString());
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // ---- 设置内容（来自 textarea onChange） ----
  const setContent = useCallback(
    (value: string) => {
      const p = providerRef.current;
      if (!p) {
        setContentState(value);
        return;
      }

      isLocalChange.current = true;
      const yText = p.doc.getText("content");
      const oldValue = yText.toString();
      if (oldValue !== value) {
        // 全量替换（简单有效）
        yText.delete(0, oldValue.length);
        yText.insert(0, value);
      }
      setContentState(value);
      isLocalChange.current = false;
    },
    [],
  );

  // ---- 自动持久化到 DB（防抖 2 秒） ----
  useEffect(() => {
    if (!documentId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      // 只在有内容时才保存
      const currentContent = providerRef.current?.doc.getText("content").toString() ?? "";
      if (!currentContent) return;

      setSaveState("syncing");
      try {
        await saveDocumentContent(documentId, currentContent);
        setSaveState("saved");
        setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2000);
      } catch {
        setSaveState("error");
      }
    }, 2000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [documentId, content]);

  // ---- 离开时做最后保存 ----
  useEffect(() => {
    return () => {
      if (documentId && providerRef.current) {
        const finalContent = providerRef.current.doc.getText("content").toString();
        if (finalContent) {
          saveDocumentContent(documentId, finalContent).catch(() => {});
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  return {
    content,
    setContent,
    saveState,
    peers,
    provider,
  };
}
