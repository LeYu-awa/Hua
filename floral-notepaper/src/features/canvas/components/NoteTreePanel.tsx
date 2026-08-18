import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listNotes } from "../../notes/api";
import type { NoteMetadata } from "../../notes/types";

interface NoteTreePanelProps {
  /** 已挂载到当前画布的笔记 id（单画布多文件关联） */
  mountedIds: string[];
  /** 切换某篇笔记的挂载状态 */
  onToggle: (noteId: string, checked: boolean) => void;
  /** 选中某篇笔记（后续用于内容可视化等操作） */
  onSelectNote?: (note: NoteMetadata) => void;
  /** 文章智能绘图：基于该笔记内容生成可视化素材 */
  onVisualize?: (note: NoteMetadata) => void;
}

interface TreeFolder {
  category: string;
  notes: NoteMetadata[];
}

/**
 * 笔记工作树：按分类（文件夹）层级化展示全部本地笔记。
 * 支持检索过滤、分类折叠、复选框多选——选中即挂载到当前画布。
 */
export function NoteTreePanel({ mountedIds, onToggle, onSelectNote, onVisualize }: NoteTreePanelProps) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState<Set<string>>(new Set(mountedIds));

  useEffect(() => {
    setMounted(new Set(mountedIds));
  }, [mountedIds]);

  useEffect(() => {
    let cancelled = false;
    listNotes()
      .then((all) => {
        if (!cancelled) setNotes(all);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const folders = useMemo<TreeFolder[]>(() => {
    const grouped = new Map<string, NoteMetadata[]>();
    for (const note of notes) {
      const key = note.category || t("notes.uncategorized", "未分类");
      const list = grouped.get(key);
      if (list) list.push(note);
      else grouped.set(key, [note]);
    }
    const q = query.trim().toLowerCase();
    const result: TreeFolder[] = [];
    for (const [category, list] of grouped) {
      const filtered = q
        ? list.filter(
            (n) => n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q),
          )
        : list;
      if (filtered.length > 0) {
        result.push({ category, notes: filtered });
      }
    }
    return result;
  }, [notes, query, t]);

  const toggleFolder = useCallback((category: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-3 pt-2.5 pb-1.5">
        <div className="flex items-center justify-between">
          <span className="canvas-panel-title">
            {t("canvas.noteTree", "笔记工作树")}
          </span>
          <span className="text-[11px] text-ink-ghost">
            {t("canvas.mountedNotes", "已挂载")} {mounted.size}
          </span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("canvas.noteSearchPlaceholder", "搜索笔记标题 / 内容…")}
          className="mt-2 w-full px-2.5 py-1.5 text-[12px] bg-paper/80 rounded-lg border border-paper-deep/25 outline-none focus:border-bamboo/50 placeholder:text-ink-faint/70"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {loading ? (
          <div className="px-2 py-6 text-center text-[12px] text-ink-ghost">
            {t("canvas.loadingNotes", "加载笔记…")}
          </div>
        ) : folders.length === 0 ? (
          <div className="px-2 py-6 text-center text-[12px] text-ink-ghost">
            {query ? t("canvas.noNoteMatch", "没有匹配的笔记") : t("canvas.noNotes", "暂无笔记")}
          </div>
        ) : (
          folders.map((folder) => {
            const isCollapsed = collapsed.has(folder.category);
            return (
              <div key={folder.category}>
                <button
                  type="button"
                  onClick={() => toggleFolder(folder.category)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left hover:bg-paper-deep/10 transition-colors cursor-pointer"
                >
                  <span
                    className={`text-[10px] text-ink-faint transition-transform ${
                      isCollapsed ? "" : "rotate-90"
                    }`}
                  >
                    ▶
                  </span>
                  <span className="text-[12px] font-medium text-ink-soft truncate">
                    {folder.category}
                  </span>
                  <span className="ml-auto text-[11px] text-ink-faint">{folder.notes.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="ml-3 border-l border-paper-deep/20 pl-1.5">
                    {folder.notes.map((note) => {
                      const checked = mounted.has(note.id);
                      return (
                        <label
                          key={note.id}
                          className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-paper-deep/10 transition-colors cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => onToggle(note.id, e.target.checked)}
                            className="accent-bamboo shrink-0"
                          />
                          <span
                            className={`flex-1 min-w-0 text-[12px] truncate ${
                              checked ? "text-bamboo font-medium" : "text-ink-soft"
                            }`}
                            title={note.title}
                          >
                            {note.title}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              onVisualize?.(note);
                            }}
                            title={t("canvas.visualizeNote", "智能绘图：解析内容生成可视化素材")}
                            className="opacity-0 group-hover:opacity-100 text-[11px] text-ink-ghost hover:text-bamboo transition-opacity cursor-pointer"
                          >
                            🎨
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              onSelectNote?.(note);
                            }}
                            title={t("canvas.previewNote", "预览此笔记")}
                            className="opacity-0 group-hover:opacity-100 text-[11px] text-ink-ghost hover:text-bamboo transition-opacity cursor-pointer"
                          >
                            👁
                          </button>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
