import { useState, useCallback, useRef, useEffect } from "react";
import { EditorCanvas, type EditorCanvasHandle } from "../components/EditorCanvas";
import { EditorSidebar } from "../components/EditorSidebar";
import { KanbanBoard } from "../components/KanbanBoard";
import { InspirationCollector } from "../components/InspirationCollector";
import { MaterialCollector } from "../components/MaterialCollector";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { SharePanel } from "../components/SharePanel";
import { useStudioStore } from "../stores/useStudioStore";
import { useActivityLog } from "../hooks/useActivityLog";
import { supabase } from "../../auth/supabase";
import type { GardenArticle } from "../../garden/types";

interface StudioEditorPageProps {
  userId: string;
}

export function StudioEditorPage({ userId }: StudioEditorPageProps) {
  const {
    kanbanView,
    setKanbanView,
    showSharePanel,
    setShowSharePanel,
    currentArticle,
    setCurrentArticle,
    setArticles,
  } = useStudioStore();
  const { logActivity } = useActivityLog();
  const [showInspiration, setShowInspiration] = useState(false);
  const [showMaterial, setShowMaterial] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const editorRef = useRef<EditorCanvasHandle>(null);

  // 加载文章列表
  const loadArticles = useCallback(async () => {
    const { data } = await supabase
      .from("garden_articles")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (data) {
      setArticles(data as GardenArticle[]);
    }
  }, [userId, setArticles]);

  // 初始化加载
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadArticles();
    }
  }, [loadArticles]);

  const handleCreateNew = useCallback(() => {
    setCurrentArticle(null);
    logActivity("create_draft");
  }, [setCurrentArticle, logActivity]);

  const handleSelectArticle = useCallback(
    (article: GardenArticle) => {
      setCurrentArticle(article);
      logActivity("edit", article.id);
    },
    [setCurrentArticle, logActivity],
  );

  const handleInsertToEditor = useCallback((content: string) => {
    editorRef.current?.insertText(content);
  }, []);

  const getTextContent = useCallback(() => {
    return editorRef.current?.getContentText() || "";
  }, []);

  // 工具栏右侧的小红书风格操作按钮
  const RightToolbar = () => (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setShowInspiration(true)}
        className="px-2.5 py-1.5 text-[11px] text-ink-ghost hover:text-ink-soft hover:bg-paper-warm/60 rounded-lg transition-colors cursor-pointer"
        title="灵感收集"
      >
        💡
      </button>
      <button
        type="button"
        onClick={() => setShowMaterial(true)}
        className="px-2.5 py-1.5 text-[11px] text-ink-ghost hover:text-ink-soft hover:bg-paper-warm/60 rounded-lg transition-colors cursor-pointer"
        title="素材收集"
      >
        📥
      </button>
      <button
        type="button"
        onClick={() => setShowTimeline(true)}
        className="px-2.5 py-1.5 text-[11px] text-ink-ghost hover:text-ink-soft hover:bg-paper-warm/60 rounded-lg transition-colors cursor-pointer"
        title="创作轨迹"
      >
        ⏱️
      </button>
      <div className="w-[1px] h-4 bg-paper-deep/10 mx-1" />
      <button
        type="button"
        onClick={() => setKanbanView(!kanbanView)}
        className={`px-2.5 py-1.5 text-[11px] rounded-lg transition-colors cursor-pointer ${
          kanbanView
            ? "bg-bamboo-mist/30 text-bamboo"
            : "text-ink-ghost hover:text-ink-soft hover:bg-paper-warm/60"
        }`}
        title="看板视图"
      >
        📋 看板
      </button>
      <button
        type="button"
        onClick={() => setShowSharePanel(true)}
        className="px-3 py-1.5 text-[11px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light transition-colors cursor-pointer"
      >
        分享
      </button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-paper-deep/10 bg-paper-warm/20 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[15px]">✦</span>
          <span className="text-[13px] font-medium text-ink">创作台</span>
          {currentArticle && (
            <>
              <span className="text-ink-ghost">/</span>
              <span className="text-[13px] text-ink-soft truncate max-w-[200px]">
                {currentArticle.title || "未命名"}
              </span>
            </>
          )}
        </div>
        <RightToolbar />
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {kanbanView ? (
          <KanbanBoard onSelectArticle={handleSelectArticle} />
        ) : (
          <>
            <EditorSidebar onCreateNew={handleCreateNew} onSelectArticle={handleSelectArticle} />
            <EditorCanvas ref={editorRef} />
          </>
        )}
      </div>

      {/* Modals */}
      {showInspiration && (
        <InspirationCollector
          onClose={() => setShowInspiration(false)}
          onInsertToEditor={handleInsertToEditor}
        />
      )}
      {showMaterial && <MaterialCollector onClose={() => setShowMaterial(false)} />}
      {showTimeline && <ActivityTimeline onClose={() => setShowTimeline(false)} />}
      {showSharePanel && (
        <SharePanel
          blocks={[]}
          imageUrls={[]}
          getTextContent={getTextContent}
          onClose={() => setShowSharePanel(false)}
        />
      )}
    </div>
  );
}
