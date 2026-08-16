import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { createArticle, updateArticle, getCategories } from "../api";
import type { GardenArticle, Category } from "../types";

interface ArticleEditorPageProps {
  userId: string;
  article?: Partial<GardenArticle>;
  onSave?: (article: GardenArticle) => void;
  onClose?: () => void;
}

export function ArticleEditorPage({ userId, article, onSave, onClose }: ArticleEditorPageProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(article?.title ?? "");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [content, setContent] = useState(article?.content ?? "");
  const [categoryId, setCategoryId] = useState(article?.categoryId ?? "");
  const [isPublic, setIsPublic] = useState(article?.isPublic ?? false);
  const [tagsText, setTagsText] = useState((article?.tags ?? []).join(", "));
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCategories(userId).then(setCategories);
  }, [userId]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const payload = {
        title: title.trim(),
        summary: summary.trim(),
        content,
        categoryId,
        tags,
        isPublic,
      };

      if (article?.id) {
        await updateArticle(article.id, payload);
        onSave?.({ ...article, ...payload, id: article.id } as GardenArticle);
      } else {
        const result = await createArticle(payload, userId);
        if (result) onSave?.(result);
      }
      onClose?.();
    } finally {
      setSaving(false);
    }
  }, [title, summary, content, categoryId, isPublic, tagsText, article, userId, onSave, onClose]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-paper-deep/10">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-ink-ghost hover:text-ink-soft transition-colors cursor-pointer"
          >
            ← {t("common.back", "返回")}
          </button>
          <h2 className="text-[15px] font-medium text-ink-soft">
            {article?.id ? t("garden.editArticle", "编辑文章") : t("garden.newArticle", "新建文章")}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPublic(!isPublic)}
            className={`px-3 py-1.5 text-[12px] rounded-lg transition-colors cursor-pointer ${
              isPublic ? "bg-bamboo-mist/60 text-bamboo" : "bg-paper-warm/60 text-ink-ghost"
            }`}
          >
            {isPublic ? "🌍 " + t("garden.public", "公开") : "🔒 " + t("garden.private", "私密")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="px-4 py-1.5 text-[13px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light disabled:opacity-50 transition-colors cursor-pointer"
          >
            {saving ? t("common.saving", "保存中...") : t("common.publish", "发布")}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 max-w-3xl mx-auto w-full px-6 py-6 space-y-4">
        {/* Title */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full text-[24px] font-semibold text-ink-soft bg-transparent outline-none placeholder:text-ink-ghost/30"
          placeholder={t("garden.titlePlaceholder", "输入文章标题...")}
        />

        {/* Summary */}
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={2}
          className="w-full text-[14px] text-ink-ghost/80 bg-paper-warm/40 rounded-lg px-4 py-3 outline-none resize-none border border-paper-deep/10 focus:border-bamboo/30"
          placeholder={t("garden.summaryPlaceholder", "输入文章摘要...")}
        />

        {/* Meta row */}
        <div className="flex items-center gap-4">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-1.5 text-[13px] bg-paper-warm/80 rounded-lg border border-paper-deep/20 outline-none focus:border-bamboo/50 text-ink-soft"
          >
            <option value="">{t("garden.noCategory", "无分类")}</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.icon} {cat.name}
              </option>
            ))}
          </select>

          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            className="flex-1 px-3 py-1.5 text-[13px] bg-paper-warm/80 rounded-lg border border-paper-deep/20 outline-none focus:border-bamboo/50 text-ink-ghost"
            placeholder={t("garden.tagsPlaceholder", "标签（逗号分隔）")}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-h-[400px]">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full min-h-[400px] text-[15px] text-ink-soft leading-relaxed bg-paper-warm/30 rounded-xl px-4 py-4 outline-none resize-none border border-paper-deep/10 focus:border-bamboo/30"
            placeholder={t(
              "garden.contentPlaceholder",
              "开始创作你的内容...\n\n支持 Markdown 格式",
            )}
          />
        </div>
      </div>
    </div>
  );
}
