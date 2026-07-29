import { useRef } from "react";
import { LazyImage } from "./LazyImage";
import { InteractionBar } from "./InteractionBar";
import type { CommunityArticle } from "../types";
import { formatRelativeTime } from "../utils";

interface ArticleFeedCardProps {
  article: CommunityArticle;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onShare: (id: string) => void;
  onLongPress: (article: CommunityArticle, x: number, y: number) => void;
  onClick: (article: CommunityArticle) => void;
}

const coverRatioClass: Record<string, string> = {
  "1:1": "aspect-square",
  "3:4": "aspect-[3/4]",
  "16:9": "aspect-video",
};

export function ArticleFeedCard({
  article,
  onLike,
  onBookmark,
  onShare,
  onLongPress,
  onClick,
}: ArticleFeedCardProps) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      const touch = e.touches[0];
      onLongPress(article, touch.clientX, touch.clientY);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchMove = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleClick = () => {
    if (isLongPress.current) {
      isLongPress.current = false;
      return;
    }
    onClick(article);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onLongPress(article, e.clientX, e.clientY);
  };

  const ratioClass = article.coverImage && article.coverRatio
    ? coverRatioClass[article.coverRatio] ?? "aspect-square"
    : "";

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_3px_var(--color-shadow)] hover:shadow-[0_4px_12px_var(--color-shadow-deep)] hover:-translate-y-px transition-all duration-200 ease-out overflow-hidden">
      {/* Card body — clickable, long-pressable */}
      <div
        className="px-4 pt-4 pb-3 cursor-pointer select-none"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        {/* Title */}
        <h3 className="text-[16px] sm:text-[18px] font-bold leading-snug text-[var(--color-ink)] mb-1.5">
          {article.title}
        </h3>

        {/* Summary */}
        <p className="text-sm leading-relaxed text-[var(--color-ink-faint)] line-clamp-2 mb-3">
          {article.summary}
        </p>

        {/* Cover image — optional */}
        {article.coverImage && (
          <div className={`rounded-xl overflow-hidden mb-3 ${ratioClass}`}>
            <LazyImage
              src={article.coverImage}
              alt={article.title}
              className="w-full h-full"
            />
          </div>
        )}

        {/* Author row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={article.author.avatarUrl}
              alt={article.author.name}
              className="w-7 h-7 rounded-full object-cover shrink-0"
            />
            <span className="text-xs text-[var(--color-ink-soft)] truncate">
              {article.author.name}
            </span>
          </div>
          <div className="text-xs text-[var(--color-ink-ghost)] whitespace-nowrap shrink-0 ml-3">
            {article.readTime} min read · {formatRelativeTime(article.createdAt)}
          </div>
        </div>
      </div>

      {/* Subtle separator between card body and interaction bar */}
      <div className="mx-4 border-b border-[var(--color-cloud)]" />

      {/* Full-width interaction bar */}
      <div className="px-4 pb-1">
        <InteractionBar
          article={article}
          onLike={onLike}
          onBookmark={onBookmark}
          onShare={onShare}
        />
      </div>
    </div>
  );
}
