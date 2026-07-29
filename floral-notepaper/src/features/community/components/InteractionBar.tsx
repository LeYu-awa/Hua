import type { CommunityArticle } from "../types";

interface InteractionBarProps {
  article: CommunityArticle;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onShare: (id: string) => void;
}

function formatCount(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + "w";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export function InteractionBar({ article, onLike, onBookmark, onShare }: InteractionBarProps) {
  return (
    <div className="flex items-center justify-between px-1 py-2">
      {/* 阅读量 */}
      <div className="flex items-center gap-1 text-[var(--color-ink-ghost)] text-xs">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span>{formatCount(article.viewCount)}</span>
      </div>

      {/* 点赞 */}
      <button
        onClick={() => onLike(article.id, !article.isLiked)}
        className={`flex items-center gap-1 text-xs transition-colors duration-200 cursor-pointer ${
          article.isLiked ? "text-[#FF2442]" : "text-[var(--color-ink-ghost)] hover:text-[var(--color-ink)]"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={article.isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
        <span>{formatCount(article.likeCount)}</span>
      </button>

      {/* 评论 */}
      <div className="flex items-center gap-1 text-[var(--color-ink-ghost)] text-xs">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>{formatCount(article.commentCount)}</span>
      </div>

      {/* 收藏 */}
      <button
        onClick={() => onBookmark(article.id, !article.isBookmarked)}
        className={`flex items-center gap-1 text-xs transition-colors duration-200 cursor-pointer ${
          article.isBookmarked ? "text-[#F5A623]" : "text-[var(--color-ink-ghost)] hover:text-[var(--color-ink)]"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={article.isBookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
        <span>{formatCount(article.bookmarkCount)}</span>
      </button>

      {/* 分享 - 突出高亮 */}
      <button
        onClick={() => onShare(article.id)}
        className="flex items-center gap-1 text-xs text-[#FF2442] font-medium cursor-pointer hover:opacity-80 transition-opacity"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        <span>分享</span>
      </button>
    </div>
  );
}
