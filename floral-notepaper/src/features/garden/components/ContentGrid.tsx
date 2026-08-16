import type { GardenArticle } from "../types";

interface ContentGridProps {
  articles: GardenArticle[];
  loading?: boolean;
  onArticleClick?: (article: GardenArticle) => void;
  emptyText?: string;
  variant?: "public" | "personal";
}

export function ContentGrid({
  articles,
  loading,
  onArticleClick,
  emptyText = "暂无内容",
  variant = "public",
}: ContentGridProps) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-[13px] text-ink-ghost">加载中...</div>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-[280px] text-center rounded-2xl border border-paper-deep/20 bg-paper/70 px-6 py-8">
          <div className="text-[20px] text-bamboo/70 mb-2">✦</div>
          <div className="text-[13px] text-ink-ghost">{emptyText}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4 overflow-y-auto content-start">
      {articles.map((article) => (
        <button
          key={article.id}
          onClick={() => onArticleClick?.(article)}
          className="text-left bg-paper rounded-2xl border border-paper-deep/20 p-4 hover:shadow-md hover:border-bamboo/30 transition-all cursor-pointer group"
        >
          {article.coverImage ? (
            <div className="w-full h-32 rounded-xl mb-3 overflow-hidden bg-paper-warm">
              <img src={article.coverImage} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-full h-24 rounded-xl mb-3 bg-gradient-to-br from-bamboo-mist/50 via-paper-warm to-paper-deep/20 flex items-center justify-center text-[11px] text-bamboo/70">
              {variant === "personal" ? "创作草稿" : "公开作品"}
            </div>
          )}
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded-full bg-bamboo-mist/45 text-[10px] text-bamboo">
              {article.isPublic ? "公开" : "私密"}
            </span>
            {article.tags[0] && (
              <span className="text-[10px] text-ink-ghost/70">#{article.tags[0]}</span>
            )}
          </div>
          <h3 className="text-[14px] font-medium text-ink-soft group-hover:text-bamboo transition-colors line-clamp-2">
            {article.title}
          </h3>
          <p className="text-[12px] text-ink-ghost/80 mt-1 line-clamp-2">{article.summary}</p>
          <div className="flex items-center gap-3 mt-3 text-[11px] text-ink-ghost/60">
            <span>{article.viewCount} 阅读</span>
            <span>{article.likeCount} 喜欢</span>
            <span className="ml-auto">
              {new Date(article.updatedAt || article.createdAt).toLocaleDateString()}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
