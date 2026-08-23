import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectionRecommendation } from "../features/agent/connectionRecommendations";
import { generateConnectionRecommendations } from "../features/agent/connectionRecommendations";
import { listNotes } from "../features/notes/api";
import type { ProviderConfig } from "../features/settings/types";

interface ConnectionSuggestionsProps {
  noteId: string;
  noteTitle: string;
  noteContent: string;
  providers: ProviderConfig[];
  enabled: boolean;
}

const RECOMMENDATION_DEBOUNCE_MS = 2500;
const MIN_RECOMMENDATION_CHARS = 80;

export function ConnectionSuggestions({
  noteId,
  noteTitle,
  noteContent,
  providers,
  enabled,
}: ConnectionSuggestionsProps) {
  const { t } = useTranslation();
  const [recommendations, setRecommendations] = useState<ConnectionRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!enabled || !noteId || providers.length === 0 || noteContent.trim().length < MIN_RECOMMENDATION_CHARS) {
      setRecommendations([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = window.setTimeout(() => {
      listNotes()
        .then((notes) => {
          const candidates = notes.map((n) => ({
            id: n.id,
            title: n.title,
            preview: n.preview,
          }));
          return generateConnectionRecommendations(
            noteId,
            noteTitle,
            noteContent,
            candidates,
            providers,
          );
        })
        .then((results) => {
          if (cancelled) return;
          setRecommendations(results);
        })
        .catch(() => {
          if (cancelled) return;
          setRecommendations([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, RECOMMENDATION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, noteId, noteTitle, noteContent, providers]);

  if (!enabled || dismissed || (!loading && recommendations.length === 0)) {
    return null;
  }

  return (
    <div className="absolute right-4 top-16 z-20 w-[220px] rounded-xl bg-paper/95 backdrop-blur-sm border border-paper-deep/20 shadow-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-ink-faint">
          {t("agent.relatedThoughts", { defaultValue: "相关思绪" })}
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-ink-ghost/60 hover:text-ink-ghost text-[10px] cursor-pointer"
        >
          {t("common.ignore", { defaultValue: "忽略" })}
        </button>
      </div>

      {loading ? (
        <div className="text-[11px] text-ink-ghost/70 py-2">
          {t("agent.thinking", { defaultValue: "正在思考…" })}
        </div>
      ) : (
        <div className="space-y-2">
          {recommendations.map((rec) => (
            <button
              key={rec.targetId}
              type="button"
              className="w-full text-left rounded-lg border border-paper-deep/20 bg-paper-warm/40 p-2 hover:bg-paper-warm transition-colors cursor-pointer"
            >
              <div className="text-[11px] font-medium text-ink-soft truncate">
                {rec.targetTitle}
              </div>
              <div className="text-[10px] text-ink-ghost/80 leading-relaxed line-clamp-2 mt-0.5">
                {rec.reason}
              </div>
              {rec.quote && (
                <div className="text-[9px] text-ink-ghost/60 mt-1 truncate">“{rec.quote}”</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
