import { useEffect, useState } from "react";
import { detectMood, moodColor, type MoodSnapshot } from "../features/agent/moodDetector";
import { getInkSession, listInkSessions } from "../features/ink/api";

interface WritingMoodIndicatorProps {
  noteId: string;
  enabled: boolean;
}

export function WritingMoodIndicator({ noteId, enabled }: WritingMoodIndicatorProps) {
  const [mood, setMood] = useState<MoodSnapshot | null>(null);

  useEffect(() => {
    if (!enabled || !noteId) {
      setMood(null);
      return;
    }

    let cancelled = false;

    async function refresh() {
      try {
        const sessions = await listInkSessions(noteId);
        if (sessions.length === 0) return;
        const latest = sessions[0];
        const session = await getInkSession(noteId, latest.id);
        if (cancelled) return;
        setMood(detectMood(session.events));
      } catch {
        // ignore
      }
    }

    void refresh();
    const timer = setInterval(refresh, 5_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, noteId]);

  if (!mood) return null;

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: moodColor(mood.mood) }}
      />
      <span className="text-[10px] text-ink-ghost font-mono">{mood.label}</span>
    </div>
  );
}
