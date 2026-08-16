import { useState, useEffect } from "react";
import { LazyImage } from "../components/LazyImage";
import type { CommunityArticle } from "../types";

interface ArticleDetailPageProps {
  article: CommunityArticle;
  onClose: () => void;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatCount(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + "w";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export function ArticleDetailPage({
  article,
  onClose,
  onLike,
  onBookmark,
}: ArticleDetailPageProps) {
  const [exiting, setExiting] = useState(false);
  const [liked, setLiked] = useState(article.isLiked);
  const [bookmarked, setBookmarked] = useState(article.isBookmarked);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleClose = () => {
    setExiting(true);
    setTimeout(onClose, 250);
  };

  const handleLike = () => {
    setLiked(!liked);
    onLike(article.id, !liked);
  };

  const handleBookmark = () => {
    setBookmarked(!bookmarked);
    onBookmark(article.id, !bookmarked);
  };

  return (
    <div
      className={`fixed inset-0 z-40 bg-[var(--color-cloud)] flex flex-col ${exiting ? "animate-window-exit" : "animate-window-enter"}`}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-cloud)]/90 backdrop-blur-lg border-b border-[var(--color-paper-deep)] flex-shrink-0">
        <button
          onClick={handleClose}
          className="p-1 cursor-pointer text-[var(--color-ink)] hover:text-[var(--color-ink-soft)] transition-colors"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <h1 className="text-sm font-medium text-[var(--color-ink)] truncate mx-3 flex-1 text-center">
          {article.title}
        </h1>
        <button
          onClick={handleBookmark}
          className={`p-1 cursor-pointer transition-colors ${bookmarked ? "text-[#F5A623]" : "text-[var(--color-ink-ghost)]"}`}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill={bookmarked ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Cover Image */}
        {article.coverImage && (
          <div className="w-full max-h-[300px] overflow-hidden">
            <LazyImage src={article.coverImage} alt={article.title} className="w-full h-[280px]" />
          </div>
        )}

        <div className="px-5 pt-5 pb-24">
          {/* Title */}
          <h1 className="text-[22px] font-bold text-[var(--color-ink)] leading-tight mb-4">
            {article.title}
          </h1>

          {/* Author */}
          <div className="flex items-center gap-3 mb-5">
            <img
              src={article.author.avatarUrl}
              alt={article.author.name}
              className="w-9 h-9 rounded-full bg-[var(--color-paper-warm)]"
            />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-[var(--color-ink)]">
                {article.author.name}
              </span>
              <span className="text-xs text-[var(--color-ink-ghost)]">
                {formatDate(article.createdAt)} · {article.readTime} min read
              </span>
            </div>
          </div>

          {/* Summary callout */}
          <div className="bg-[var(--color-paper-warm)] rounded-xl p-4 mb-6">
            <p className="text-sm text-[var(--color-ink-soft)] leading-relaxed">
              {article.summary}
            </p>
          </div>

          {/* Divider */}
          <div className="h-px bg-[var(--color-paper-deep)] mb-6" />

          {/* Article content */}
          <div className="text-[15px] text-[var(--color-ink)] leading-[1.85] whitespace-pre-wrap">
            {article.content.split("\n").map((line, i) => {
              if (line.startsWith("# "))
                return (
                  <h2 key={i} className="text-xl font-bold mt-6 mb-3">
                    {line.slice(2)}
                  </h2>
                );
              if (line.startsWith("## "))
                return (
                  <h3 key={i} className="text-lg font-semibold mt-5 mb-2">
                    {line.slice(3)}
                  </h3>
                );
              if (line.trim() === "") return <div key={i} className="h-3" />;
              return (
                <p key={i} className="mb-2">
                  {line}
                </p>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom interaction bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-cloud)]/90 backdrop-blur-lg border-t border-[var(--color-paper-deep)] px-5 py-2.5 flex items-center justify-around">
        <button
          onClick={handleLike}
          className={`flex items-center gap-1.5 text-sm cursor-pointer transition-colors ${liked ? "text-[#FF2442]" : "text-[var(--color-ink-ghost)]"}`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill={liked ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
          <span>
            {formatCount(
              liked
                ? article.likeCount + (article.isLiked ? 0 : 1)
                : article.likeCount - (article.isLiked ? 1 : 0),
            )}
          </span>
        </button>

        <div className="flex items-center gap-1.5 text-sm text-[var(--color-ink-ghost)]">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>{formatCount(article.commentCount)}</span>
        </div>

        <button
          onClick={handleBookmark}
          className={`flex items-center gap-1.5 text-sm cursor-pointer transition-colors ${bookmarked ? "text-[#F5A623]" : "text-[var(--color-ink-ghost)]"}`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill={bookmarked ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          <span>
            {formatCount(
              bookmarked
                ? article.bookmarkCount + (article.isBookmarked ? 0 : 1)
                : article.bookmarkCount - (article.isBookmarked ? 1 : 0),
            )}
          </span>
        </button>

        <button className="flex items-center gap-1.5 text-sm text-[#FF2442] font-medium cursor-pointer">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span>分享</span>
        </button>
      </div>
    </div>
  );
}
