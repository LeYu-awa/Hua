import { useEffect, useRef } from "react";
import type { CommunityArticle } from "../types";

interface LongPressMenuProps {
  article: CommunityArticle | null;
  x: number;
  y: number;
  onClose: () => void;
  onReadLater: (id: string) => void;
  onNotInterested: (id: string) => void;
}

export function LongPressMenu({
  article,
  x,
  y,
  onClose,
  onReadLater,
  onNotInterested,
}: LongPressMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!article) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleScroll = () => onClose();
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [article, onClose]);

  if (!article) return null;

  const menuWidth = 180;
  const menuHeight = 100;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let left = x;
  let top = y;

  if (left + menuWidth > viewportW - 16) left = viewportW - menuWidth - 16;
  if (top + menuHeight > viewportH - 16) top = viewportH - menuHeight - 16;
  if (left < 16) left = 16;
  if (top < 16) top = 16;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        ref={menuRef}
        style={{ left, top, position: "fixed" }}
        className="animate-menu-enter bg-[var(--color-cloud)] rounded-xl shadow-xl border border-[var(--color-paper-deep)] overflow-hidden min-w-[160px]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => {
            onReadLater(article.id);
            onClose();
          }}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--color-ink)] hover:bg-[var(--color-paper-warm)] transition-colors cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-ink-faint)]">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          稍后读
        </button>
        <div className="h-px bg-[var(--color-paper-deep)] mx-3" />
        <button
          onClick={() => {
            onNotInterested(article.id);
            onClose();
          }}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--color-ink)] hover:bg-[var(--color-paper-warm)] transition-colors cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-ink-faint)]">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          不感兴趣
        </button>
      </div>
    </div>
  );
}
