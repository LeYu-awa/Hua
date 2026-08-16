import { useCallback } from "react";
import { useStudioStore } from "../stores/useStudioStore";
import { supabase } from "../../auth/supabase";
import type { ActivityAction } from "../types";

export function useActivityLog() {
  const addActivityEntry = useStudioStore(
    (s: { addActivityEntry: (entry: import("../types").ActivityEntry) => void }) =>
      s.addActivityEntry,
  );

  const logActivity = useCallback(
    async (actionType: ActivityAction, articleId?: string, metadata?: Record<string, unknown>) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const entry = {
        id: crypto.randomUUID(),
        userId: user.id,
        articleId,
        actionType,
        metadata,
        createdAt: new Date().toISOString(),
      };

      // 乐观更新
      addActivityEntry(entry);

      // 异步持久化
      try {
        await supabase.from("activity_log").insert({
          id: entry.id,
          user_id: user.id,
          article_id: articleId,
          action_type: actionType,
          metadata,
        });
      } catch (err) {
        console.error("[ActivityLog] 记录失败:", err);
      }
    },
    [addActivityEntry],
  );

  return { logActivity };
}
