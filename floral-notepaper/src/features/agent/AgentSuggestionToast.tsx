import type { AgentSuggestion } from "./types";

interface AgentSuggestionToastProps {
  suggestion: AgentSuggestion | null;
  onDismiss: (suggestionId: string) => void;
  onAccept?: (suggestionId: string) => void;
}

export function AgentSuggestionToast({
  suggestion,
  onDismiss,
  onAccept,
}: AgentSuggestionToastProps) {
  if (!suggestion) return null;

  return (
    <div className="canvas-agent-toast pointer-events-auto absolute right-4 bottom-4 z-20 w-72 rounded-2xl px-4 py-3 backdrop-blur animate-fade-in">
      <div className="flex items-start gap-2.5">
        <div className="canvas-agent-toast-icon mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 2v4" />
            <path d="M12 18v4" />
            <path d="m4.93 4.93 2.83 2.83" />
            <path d="m16.24 16.24 2.83 2.83" />
            <path d="M2 12h4" />
            <path d="M18 12h4" />
            <path d="m4.93 19.07 2.83-2.83" />
            <path d="m16.24 7.76 2.83-2.83" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="canvas-agent-toast-title text-[12px] font-medium">{suggestion.title}</p>
          <p className="canvas-agent-toast-message mt-1 text-[11px] leading-relaxed">{suggestion.message}</p>
          <div className="mt-2 flex items-center gap-2">
            {onAccept && (
              <button
                type="button"
                onClick={() => onAccept(suggestion.id)}
                className="canvas-agent-toast-accept rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors"
              >
                采纳
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(suggestion.id)}
              className="canvas-agent-toast-dismiss rounded-full px-2.5 py-1 text-[10px] transition-colors"
            >
              忽略
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
