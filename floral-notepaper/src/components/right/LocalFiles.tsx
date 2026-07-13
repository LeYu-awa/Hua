import { useEffect, useState } from "react";
import { listNotes } from "../../features/notes/api";
import type { NoteMetadata } from "../../features/notes/types";

interface LocalFilesProps {
  /** 从右侧拖入画布时的回调 */
  onDragStart?: (noteId: string, title: string) => void;
}

/** 个人笔记列表（从笔记系统加载） */
export function LocalFiles({ onDragStart }: LocalFilesProps) {
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listNotes()
      .then((data) => {
        if (!cancelled) setNotes(data);
      })
      .catch((err) => {
        if (!cancelled) setError("无法加载笔记");
        console.warn("listNotes failed (non-Tauri environment?):", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      return "";
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 px-2 py-1.5 border-b border-paper-deep/20">
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-ink-faint shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z" />
            <polyline points="16 3 16 8 21 8" />
            <line x1="8" y1="12" x2="16" y2="12" />
            <line x1="8" y1="16" x2="14" y2="16" />
          </svg>
          <span className="text-[10px] text-ink-faint">我的笔记</span>
          <span className="text-[9px] text-ink-ghost ml-auto">{notes.length}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="text-[10px] text-ink-faint text-center py-6">加载中...</div>
        ) : error ? (
          <div className="text-[10px] text-ink-faint text-center py-6 px-2 leading-relaxed">
            <p>当前环境无法加载笔记</p>
            <p className="mt-1">（功能仅限桌面端）</p>
          </div>
        ) : notes.length === 0 ? (
          <div className="text-[10px] text-ink-faint text-center py-6 leading-relaxed">
            <p>暂无笔记</p>
            <p className="mt-1">先去主页创建笔记吧</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {notes.map((note) => (
              <div
                key={note.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors hover:bg-paper-warm/60 text-ink-soft cursor-grab active:cursor-grabbing group"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "text/plain",
                    JSON.stringify({
                      type: "collab-doc",
                      docId: note.id,
                      title: note.title,
                    }),
                  );
                  e.dataTransfer.effectAllowed = "copy";
                  onDragStart?.(note.id, note.title);
                }}
              >
                <svg className="w-3 h-3 text-ink-faint shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="12" x2="12" y2="18" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] truncate">{note.title || "未命名笔记"}</p>
                  {note.preview && (
                    <p className="text-[8px] text-ink-faint truncate mt-0.5">{note.preview}</p>
                  )}
                </div>
                <span className="text-[8px] text-ink-faint shrink-0">
                  {formatDate(note.updatedAt || note.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
