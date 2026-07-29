import type { GardenArticle } from '../types';

interface ContentGridProps {
  articles: GardenArticle[];
  loading?: boolean;
  onArticleClick?: (article: GardenArticle) => void;
  emptyText?: string;
}

export function ContentGrid({ articles, loading, onArticleClick, emptyText = '暂无内容' }: ContentGridProps) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-[13px] text-ink-ghost">加载中...</div>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-[13px] text-ink-ghost">{emptyText}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 grid grid-cols-2 lg:grid-cols-3 gap-4 p-4 overflow-y-auto">
      {articles.map(article => (
        <button
          key={article.id}
          onClick={() => onArticleClick?.(article)}
          className="text-left bg-paper rounded-xl border border-paper-deep/20 p-4 hover:shadow-md hover:border-bamboo/30 transition-all cursor-pointer group"
        >
          {article.coverImage && (
            <div className="w-full h-32 rounded-lg mb-3 overflow-hidden bg-paper-warm">
              <img src={article.coverImage} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <h3 className="text-[14px] font-medium text-ink-soft group-hover:text-bamboo transition-colors line-clamp-2">
            {article.title}
          </h3>
          <p className="text-[12px] text-ink-ghost/80 mt-1 line-clamp-2">{article.summary}</p>
          <div className="flex items-center gap-3 mt-2 text-[11px] text-ink-ghost/60">
            <span>👁 {article.viewCount}</span>
            <span>❤ {article.likeCount}</span>
            <span className="ml-auto">{new Date(article.createdAt).toLocaleDateString()}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
