import { useCallback, useEffect, useState } from "react";
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
 * 多画布工作台：画布列表（创建 / 自定义命名 / 重命名 / 删除 / 切换）。
 * 打开某张画布后进入全屏编辑（CanvasPage），标题栏提供返回工作台。
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const docs = await listCanvasDocuments();
      setCanvases(docs);
    } catch {
      setCanvases([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCanvas = canvases.find((c) => c.id === openId);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const doc: CanvasDocument = {
        id: generateCanvasId(),
        title: t("canvas.untitled", "未命名画布") + ` ${canvases.length + 1}`,
        nodes: [],
        edges: [],
        groups: [],
        noteIds: [],
      };
      await saveCanvasDocument(doc);
      setCanvases((prev) => [...prev, doc]);
      setOpenId(doc.id);
    } finally {
      setCreating(false);
    }
  }, [canvases.length, t]);

  const handleRename = useCallback(
    async (id: string) => {
      const title = renameValue.trim();
      if (!title) {
        setRenamingId(null);
        return;
      }
      setCanvases((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
      const target = canvases.find((c) => c.id === id);
      if (target) {
        await saveCanvasDocument({ ...target, title }).catch(() => undefined);
      }
      setRenamingId(null);
    },
    [canvases, renameValue],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const target = canvases.find((c) => c.id === id);
      const title = target?.title || t("canvas.untitled", "未命名画布");
      if (!window.confirm(t("canvas.deleteConfirm", `删除画布「${title}」？该操作不可撤销。`))) {
        return;
      }
      await deleteCanvasDocument(id).catch(() => undefined);
      setCanvases((prev) => prev.filter((c) => c.id !== id));
      if (openId === id) setOpenId(null);
    },
    [canvases, openId, t],
  );

  // ── 画布编辑态：标题栏 + 全屏画布 ─────────────────────────────
  if (openCanvas) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-paper">
        <div className="flex items-center gap-3 px-4 h-12 shrink-0 border-b border-paper-deep/20 bg-paper-warm/40">
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-ink-ghost hover:bg-paper-deep/10 hover:text-ink-soft transition-colors cursor-pointer"
          >
            ← {t("canvas.backToWorkspace", "返回工作台")}
          </button>
          <div className="h-4 w-px bg-paper-deep/20" />
          {renamingId === openCanvas.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename(openCanvas.id);
                if (e.key === "Escape") setRenamingId(null);
              }}
              onBlur={() => handleRename(openCanvas.id)}
              className="px-2 py-1 text-[13px] font-medium text-ink-soft bg-paper/80 rounded-lg border border-bamboo/40 outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setRenameValue(openCanvas.title || "");
                setRenamingId(openCanvas.id);
              }}
              title={t("canvas.renameTip", "重命名画布")}
              className="text-[13px] font-medium text-ink-soft hover:text-bamboo transition-colors cursor-pointer"
            >
              {openCanvas.title || t("canvas.untitled", "未命名画布")}
            </button>
          )}
          {(openCanvas.noteIds?.length || openCanvas.noteId ? 1 : 0) > 0 && (
            <span className="text-[11px] text-ink-ghost">
              {(openCanvas.noteIds?.length ?? 0) + (openCanvas.noteId ? 1 : 0)}{" "}
              {t("canvas.notesMounted", "篇笔记")}
            </span>
          )}
          <span className="text-[11px] text-ink-ghost/70">
            {openCanvas.nodes.length} {t("canvas.nodes", "个节点")}
          </span>
          <div className="flex-1" />
          <span className="text-[11px] text-ink-faint/70">
            {t("canvas.autoSaveHint", "自动保存到本地")}
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <CanvasPage
            documentId={openCanvas.id}
            title={openCanvas.title}
            noteId={openCanvas.noteId}
            noteIds={openCanvas.noteIds ?? []}
            providers={providers}
            agentEnabled={agentEnabled}
            conversationId={openCanvas.id}
            userId={userId}
            onSave={(doc) =>
              setCanvases((prev) => prev.map((c) => (c.id === doc.id ? doc : c)))
            }
          />
        </div>
      </div>
    );
  }

  // ── 工作台列表态 ─────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper overflow-y-auto">
      <div className="px-6 pt-5 pb-3 flex items-center gap-3">
        <div>
          <div className="text-[16px] font-semibold text-ink-soft">
            {t("canvas.workspace", "画布工作台")}
          </div>
          <div className="text-[12px] text-ink-ghost mt-0.5">
            {t("canvas.workspaceHint", "多画布创作：每个画布独立管理，可挂载多篇笔记")}
          </div>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          disabled={creating}
          onClick={handleCreate}
          className="rounded-xl bg-bamboo px-4 py-2 text-[13px] font-medium text-cloud transition-colors hover:bg-bamboo-light disabled:opacity-60 cursor-pointer"
        >
          {creating ? t("canvas.creating", "创建中…") : `+ ${t("canvas.newCanvas", "新建画布")}`}
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-ink-ghost">
          {t("canvas.loading", "加载画布…")}
        </div>
      ) : canvases.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <CanvasGlyph size={44} />
          <div className="text-[14px] font-medium text-ink-soft mt-3">
            {t("canvas.noCanvas", "还没有画布")}
          </div>
          <p className="text-[12px] text-ink-ghost mt-1 max-w-[340px]">
            {t("canvas.noCanvasHint", "创建一张画布，把多篇笔记挂载进来，开始你的创作项目")}
          </p>
          <button
            type="button"
            onClick={handleCreate}
            className="mt-4 rounded-xl bg-bamboo px-4 py-2 text-[13px] font-medium text-cloud transition-colors hover:bg-bamboo-light cursor-pointer"
          >
            + {t("canvas.newCanvas", "新建画布")}
          </button>
        </div>
      ) : (
        <div className="px-6 pb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {canvases.map((canvas) => {
            const notesCount = (canvas.noteIds?.length ?? 0) + (canvas.noteId ? 1 : 0);
            const title = canvas.title || t("canvas.untitled", "未命名画布");
            return (
              <div
                key={canvas.id}
                className="group rounded-2xl border border-paper-deep/20 bg-paper-warm/35 p-4 transition-shadow hover:shadow-md hover:border-bamboo/40"
              >
                <div className="flex items-start gap-2.5">
                  <CanvasGlyph size={32} />
                  <div className="flex-1 min-w-0">
                    {renamingId === canvas.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(canvas.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={() => handleRename(canvas.id)}
                        className="w-full px-2 py-1 text-[13px] font-medium text-ink-soft bg-paper/80 rounded-lg border border-bamboo/40 outline-none"
                      />
                    ) : (
                      <div
                        className="text-[13px] font-medium text-ink-soft truncate"
                        title={title}
                      >
                        {title}
                      </div>
                    )}
                    <div className="text-[11px] text-ink-ghost mt-1">
                      {notesCount > 0
                        ? `${notesCount} ${t("canvas.notesMounted", "篇笔记")} · `
                        : ""}
                      {canvas.nodes.length} {t("canvas.nodes", "个节点")}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-3">
                  <button
                    type="button"
                    onClick={() => setOpenId(canvas.id)}
                    className="flex-1 rounded-lg bg-bamboo/90 px-3 py-1.5 text-[12px] font-medium text-cloud transition-colors hover:bg-bamboo cursor-pointer"
                  >
                    {t("canvas.open", "进入")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenameValue(title);
                      setRenamingId(canvas.id);
                    }}
                    title={t("canvas.renameTip", "重命名画布")}
                    className="rounded-lg border border-paper-deep/25 px-2.5 py-1.5 text-[12px] text-ink-soft transition-colors hover:bg-paper-deep/10 cursor-pointer"
                  >
                    {t("canvas.rename", "重命名")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(canvas.id)}
                    title={t("canvas.deleteTip", "删除画布")}
                    className="rounded-lg border border-paper-deep/25 px-2.5 py-1.5 text-[12px] text-ink-ghost transition-colors hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                  >
                    {t("canvas.delete", "删除")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
