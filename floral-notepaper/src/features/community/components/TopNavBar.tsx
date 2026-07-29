interface TopNavBarProps {
  showSearch: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onToggleSearch: () => void;
}

export function TopNavBar({
  showSearch,
  searchQuery,
  onSearchChange,
  onToggleSearch,
}: TopNavBarProps) {
  if (showSearch) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-[var(--color-cloud)]/80 backdrop-blur-xl border-b border-[var(--color-paper-deep)]">
        <div className="flex items-center gap-3 px-4 h-14">
          <button
            onClick={onToggleSearch}
            className="flex items-center justify-center w-9 h-9 rounded-full text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-warm)] transition-colors duration-200 cursor-pointer"
            aria-label="返回"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-ghost)] pointer-events-none"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索文章…"
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-[var(--color-paper-warm)] text-[var(--color-ink)] text-sm placeholder:text-[var(--color-ink-ghost)] outline-none border border-[var(--color-paper-deep)] focus:border-[var(--color-bamboo)] transition-colors duration-200"
              autoFocus
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-[var(--color-cloud)]/80 backdrop-blur-xl border-b border-[var(--color-paper-deep)]">
      <div className="flex items-center justify-between px-4 h-14">
        <h1 className="text-lg font-bold text-[var(--color-ink)] tracking-wide select-none">
          花笺社区
        </h1>
        <button
          onClick={onToggleSearch}
          className="flex items-center justify-center w-9 h-9 rounded-full text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-warm)] transition-colors duration-200 cursor-pointer"
          aria-label="搜索"
        >
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
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>
    </div>
  );
}
