import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CanvasPage } from "../../../components/CanvasPage";
import { deleteCanvasDocument, listCanvasDocuments, saveCanvasDocument } from "../api";
import type { CanvasDocument } from "../types";
import type { ProviderConfig } from "../../settings/types";

interface CanvasWorkspacePageProps {
  providers: ProviderConfig[];
  /** Agent 总开关：关闭时画布内不显示任何 AI 建议 */
  agentEnabled?: boolean;
  userId?: string;
}

/** 生成唯一画布 id（本地 CanvasStore 主键，与 Rust 侧 canvas-{ts} 风格一致） */
function generateCanvasId(): string {
  return `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function CanvasGlyph({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-bamboo"
      aria-hidden="true"
    >
      <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3.2" />
      <path d="M8.25 8.5 15.75 15.5" opacity="0.45" />
      <path d="M8.4 8.5h.1" />
      <path d="M15.6 15.5h.1" />
    </svg>
  );
}

/**
 * 多画布工作台：进入后立即显示当前画布，顶部下拉用于展开/切换/管理画布。
 */
export function CanvasWorkspacePage({
  providers,
  agentEnabled = false,
  userId,
}: CanvasWorkspacePageProps) {
  const { t } = useTranslation();
  const [canvases, setCanvases] = useState<CanvasDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const createDocument = useCallback(
    (index: number): CanvasDocument => ({
      id: generateCanvasId(),
      title: `${t("canvas.untitled", "未命名画布")} ${index}`,
      nodes: [],
      edges: [],
      groups: [],
      noteIds: [],
    }),
    [t],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const docs = await listCanvasDocuments();
      if (docs.length > 0) {
        setCanvases(docs);
        setOpenId((current) => (current && docs.some((doc) => doc.id === current) ? current : docs[0].id));
        return;
      }
      const first = createDocument(1);
      await saveCanvasDocument(first).catch(() => undefined);
      setCanvases([first]);
      setOpenId(first.id);
    } catch {
      const first = createDocument(1);
      setCanvases([first]);
      setOpenId(first.id);
    } finally {
      setLoading(false);
    }
  }, [createDocument]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCanvas = useMemo(
    () => canvases.find((canvas) => canvas.id === openId) ?? canvases[0] ?? null,
    [canvases, openId],
  );

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const doc = createDocument(canvases.length + 1);
      await saveCanvasDocument(doc).catch(() => undefined);
      setCanvases((prev) => [...prev, doc]);
      setOpenId(doc.id);
      setSelectorOpen(false);
    } finally {
      setCreating(false);
    }
  }, [canvases.length, createDocument]);

  const handleRename = useCallback(
    async (id: string) => {
      const title = renameValue.trim();
      if (!title) {
        setRenamingId(null);
        return;
      }
      let updated: CanvasDocument | null = null;
      setCanvases((prev) =>
        prev.map((canvas) => {
          if (canvas.id !== id) return canvas;
          updated = { ...canvas, title };
          return updated;
        }),
      );
      if (updated) await saveCanvasDocument(updated).catch(() => undefined);
      setRenamingId(null);
    },
    [renameValue],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const target = canvases.find((canvas) => canvas.id === id);
      if (!target) return;
      const title = target.title || t("canvas.untitled", "未命名画布");
      if (!window.confirm(t("canvas.deleteConfirm", `删除画布「${title}」？该操作不可撤销。`))) return;

      await deleteCanvasDocument(id).catch(() => undefined);
      const remaining = canvases.filter((canvas) => canvas.id !== id);
      if (remaining.length > 0) {
        setCanvases(remaining);
        setOpenId((current) => (current === id ? remaining[0].id : current));
        return;
      }

      const first = createDocument(1);
      await saveCanvasDocument(first).catch(() => undefined);
      setCanvases([first]);
      setOpenId(first.id);
    },
    [canvases, createDocument, t],
  );

  const handleSaved = useCallback((doc: CanvasDocument) => {
    setCanvases((prev) => prev.map((canvas) => (canvas.id === doc.id ? { ...canvas, ...doc } : canvas)));
  }, []);

  if (loading || !openCanvas) {
    return (
      <div className="flex-1 flex items-center justify-center bg-paper text-[13px] text-ink-ghost">
        {t("canvas.loading", "加载画布…")}
      </div>
    );
  }

  const activeTitle = openCanvas.title || t("canvas.untitled", "未命名画布");
  const activeNotesCount = (openCanvas.noteIds?.length ?? 0) + (openCanvas.noteId ? 1 : 0);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper">
      <div className="relative z-50 flex h-12 shrink-0 items-center gap-3 border-b border-paper-deep/20 bg-paper-warm/55 px-4 backdrop-blur">
        <div className="relative">
          <button
            type="button"
            onClick={() => setSelectorOpen((open) => !open)}
            className="flex min-w-[240px] max-w-[360px] items-center gap-2 rounded-xl border border-paper-deep/25 bg-paper/75 px-3 py-2 text-left shadow-sm transition-all hover:border-bamboo/35 hover:bg-paper cursor-pointer"
            title={t("canvas.switchCanvas", "切换画布")}
          >
            <CanvasGlyph size={18} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-ink-soft">{activeTitle}</div>
              <div className="text-[10px] text-ink-ghost">
                {canvases.length} {t("canvas.workspace", "画布工作区")}
              </div>
            </div>
            <span className={`text-[11px] text-ink-ghost transition-transform ${selectorOpen ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>

          {selectorOpen && (
            <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[380px] max-w-[calc(100vw-120px)] rounded-2xl border border-paper-deep/25 bg-paper/95 p-2.5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="flex items-center justify-between px-1 pb-2">
                <div>
                  <div className="text-[12px] font-semibold text-ink-soft">
                    {t("canvas.workspace", "画布工作区")}
                  </div>
                  <div className="text-[10px] text-ink-ghost">
                    {t("canvas.workspaceHint", "展开后可直接进入不同画布")}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={creating}
                  onClick={handleCreate}
                  className="rounded-lg bg-bamboo px-3 py-1.5 text-[11px] font-medium text-cloud transition-colors hover:bg-bamboo-light disabled:opacity-60 cursor-pointer"
                >
                  {creating ? t("canvas.creating", "创建中…") : `+ ${t("canvas.newCanvas", "新建画布")}`}
                </button>
              </div>

              <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
                {canvases.map((canvas) => {
                  const title = canvas.title || t("canvas.untitled", "未命名画布");
                  const notesCount = (canvas.noteIds?.length ?? 0) + (canvas.noteId ? 1 : 0);
                  const active = canvas.id === openCanvas.id;
                  return (
                    <div
                      key={canvas.id}
                      className={`rounded-xl border p-2 transition-colors ${
                        active
                          ? "border-bamboo/35 bg-bamboo-mist/45"
                          : "border-transparent hover:border-paper-deep/25 hover:bg-paper-warm/60"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenId(canvas.id);
                            setSelectorOpen(false);
                          }}
                          className="flex min-w-0 flex-1 items-start gap-2 text-left cursor-pointer"
                        >
                          <CanvasGlyph size={26} />
                          <div className="min-w-0 flex-1">
                            {renamingId === canvas.id ? (
                              <input
                                autoFocus
                                value={renameValue}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => setRenameValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") void handleRename(canvas.id);
                                  if (event.key === "Escape") setRenamingId(null);
                                }}
                                onBlur={() => void handleRename(canvas.id)}
                                className="w-full rounded-lg border border-bamboo/40 bg-paper/85 px-2 py-1 text-[12px] font-medium text-ink-soft outline-none"
                              />
                            ) : (
                              <div className="truncate text-[12px] font-semibold text-ink-soft" title={title}>
                                {title}
                              </div>
                            )}
                            <div className="mt-0.5 text-[10px] text-ink-ghost">
                              {notesCount > 0 ? `${notesCount} ${t("canvas.notesMounted", "篇笔记")} · ` : ""}
                              {canvas.nodes.length} {t("canvas.nodes", "个节点")}
                            </div>
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setRenameValue(title);
                              setRenamingId(canvas.id);
                            }}
                            className="rounded-md px-2 py-1 text-[10px] text-ink-ghost transition-colors hover:bg-paper-deep/10 hover:text-ink-soft cursor-pointer"
                          >
                            {t("canvas.rename", "重命名")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(canvas.id)}
                            className="rounded-md px-2 py-1 text-[10px] text-ink-ghost transition-colors hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                          >
                            {t("canvas.delete", "删除")}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <span className="text-[11px] text-ink-ghost/75">
          {openCanvas.nodes.length} {t("canvas.nodes", "个节点")}
          {activeNotesCount > 0 ? ` · ${activeNotesCount} ${t("canvas.notesMounted", "篇笔记")}` : ""}
        </span>
        <div className="flex-1" />
        <span className="text-[11px] text-ink-faint/70">
          {t("canvas.autoSaveHint", "自动保存到本地")}
        </span>
      </div>

      <div className="flex-1 min-h-0">
        <CanvasPage
          key={openCanvas.id}
          documentId={openCanvas.id}
          title={openCanvas.title}
          noteId={openCanvas.noteId}
          noteIds={openCanvas.noteIds ?? []}
          initialDocument={openCanvas}
          providers={providers}
          agentEnabled={agentEnabled}
          conversationId={openCanvas.id}
          userId={userId}
          onSave={handleSaved}
        />
      </div>
    </div>
  );
}
