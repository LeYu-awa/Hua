import { useCallback, useEffect, useRef, useState } from "react";
import { LiteGraphWorkflow } from "../workflow/LiteGraphWorkflow";
import { AgentSuggestionToast } from "../../features/agent/AgentSuggestionToast";
import {
  analyzeAgentConversation,
  dismissAgentSuggestion,
  listAgentSuggestions,
  recordAgentEvents,
} from "../../features/agent/api";
import type { AgentSuggestion } from "../../features/agent/types";
import { supabase } from "../../features/auth/supabase";
import { workflowToAgentEvents } from "../../features/workflow/agentEvents";
import type { WorkflowDocument } from "../../features/workflow/types";
import "./CanvasMode.css";

interface CanvasModeProps {
  conversationId: string | null;
}

export function CanvasMode({ conversationId }: CanvasModeProps) {
  const [agentSuggestion, setAgentSuggestion] = useState<AgentSuggestion | null>(null);
  const [userInfo, setUserInfo] = useState<{ id: string; name: string } | null>(null);
  const lastSyncRef = useRef(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.id) {
        setUserInfo({
          id: data.user.id,
          name: data.user.email?.split("@")[0] ?? "用户" + data.user.id.slice(0, 4),
        });
      }
    });
  }, []);

  const refreshAgentSuggestion = useCallback(() => {
    if (!conversationId) {
      setAgentSuggestion(null);
      return;
    }

    analyzeAgentConversation(conversationId)
      .then((result) => setAgentSuggestion(result.suggestions[0] ?? null))
      .catch(console.warn);
  }, [conversationId]);

  useEffect(() => {
    refreshAgentSuggestion();
    if (!conversationId) return;

    const timer = window.setInterval(refreshAgentSuggestion, 30_000);
    return () => window.clearInterval(timer);
  }, [conversationId, refreshAgentSuggestion]);

  const handleDismissAgentSuggestion = useCallback(
    (suggestionId: string) => {
      setAgentSuggestion(null);
      dismissAgentSuggestion(suggestionId)
        .then(() => (conversationId ? listAgentSuggestions(conversationId, "pending") : []))
        .then((suggestions) => setAgentSuggestion(suggestions[0] ?? null))
        .catch(console.warn);
    },
    [conversationId],
  );

  const handleAgentSync = useCallback(
    (workflow: WorkflowDocument) => {
      if (!conversationId || !userInfo?.id) return;
      const now = Date.now();
      if (now - lastSyncRef.current < 1_000) return;
      lastSyncRef.current = now;
      const events = workflowToAgentEvents(workflow, conversationId, userInfo.id);
      if (events.length === 0) return;
      recordAgentEvents(events).catch((error) => {
        console.warn("Workflow agent event collection failed", error);
      });
    },
    [conversationId, userInfo?.id],
  );

  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-ghost text-[11px]">
        选择对话后进入工作流画布
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 relative">
      <LiteGraphWorkflow
        documentId={`conversation-${conversationId}`}
        conversationId={conversationId}
        onAgentSync={handleAgentSync}
      />
      <AgentSuggestionToast suggestion={agentSuggestion} onDismiss={handleDismissAgentSuggestion} />
    </div>
  );
}
