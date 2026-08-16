import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { deleteArticle } from "../api";
import { ArticleEditorPage } from "./ArticleEditorPage";
import { MarkdownPreview } from "../../markdown/MarkdownPreview";
import type { GardenArticle } from "../types";

interface ArticleDetailPageProps {
  userId: string;
  currentUserId?: string | null;
  article: GardenArticle;
  onBack: () => void;
  onRefresh?: () => void;
}

export function ArticleDetailPage({
  userId,
  currentUserId,
  article,
  onBack,
  onRefresh,
}: ArticleDetailPageProps) {
  const { t } = useTranslation();
  const [showEditor, setShowEditor] = useState(false);
  const [fullArticle, setFullArticle] = useState<GardenArticle | null>(article);

  const isOwner = currentUserId === userId;

  const handleDelete = useCallback(async () => {
    if (!window.confirm(t("garden.confirmDelete", "确定要删除这篇文章吗？"))) return;
    await deleteArticle(article.id);
    onRefresh?.();
    onBack();
  }, [article.id, deleteArticle, onBack, onRefresh, t]);

  if (showEditor) {
    return (
      <ArticleEditorPage
        userId={userId}
        article={fullArticle ?? article}
        onSave={(saved) => {
          setFullArticle(saved);
          setShowEditor(false);
        }}
        onClose={() => setShowEditor(false)}
      />
    );
  }

  const display = fullArticle || article;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-paper-deep/10">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[13px] text-ink-ghost hover:text-ink-soft transition-colors cursor-pointer"
        >
          ← {t("common.back", "返回")}
        </button>
        <div className="flex items-center gap-2">
          {isOwner && (
            <>
              <button
                onClick={() => setShowEditor(true)}
                className="px-3 py-1.5 text-[12px] text-ink-soft bg-paper-warm/80 hover:bg-paper-warm rounded-lg transition-colors cursor-pointer"
              >
                ✏️ {t("common.edit", "编辑")}
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-[12px] text-red-400 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
              >
                🗑 {t("common.delete", "删除")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Article Content */}
      <div className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        {/* Cover */}
        {display.coverImage && (
          <div className="w-full h-48 rounded-2xl overflow-hidden mb-6 bg-paper-warm">
            <img src={display.coverImage} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        {/* Title */}
        <h1 className="text-[28px] font-semibold text-ink-soft leading-tight">{display.title}</h1>

        {/* Meta */}
        <div className="flex items-center gap-4 mt-3 text-[12px] text-ink-ghost/70">
          <span>👁 {display.viewCount} 次浏览</span>
          <span>❤ {display.likeCount} 次点赞</span>
          <span>📅 {new Date(display.createdAt).toLocaleDateString()}</span>
          {display.tags.length > 0 && (
            <div className="flex gap-1">
              {display.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full bg-bamboo-mist/40 text-bamboo text-[11px]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Summary */}
        {display.summary && (
          <div className="mt-4 p-4 rounded-xl bg-paper-warm/60 border border-paper-deep/10 text-[14px] text-ink-ghost/80 leading-relaxed">
            {display.summary}
          </div>
        )}

        {/* Content：与编辑器一致的 Markdown 渲染，而非原样输出源码 */}
        <div className="mt-6">
          {display.content ? (
            <MarkdownPreview content={display.content} fontSize={15} />
          ) : (
            <p className="text-[15px] text-ink-ghost">
              {t("garden.noContent", "暂无内容")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
