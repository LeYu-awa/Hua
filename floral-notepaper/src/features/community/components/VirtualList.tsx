import { useRef, useState, useCallback, useEffect, useMemo } from "react";

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  className?: string;
  getKey: (item: T, index: number) => string | number;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const LOAD_MORE_THRESHOLD = 200;

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  overscan = 5,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  className = "",
  getKey,
  onRefresh,
  isRefreshing = false,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const rafRef = useRef<number | null>(null);
  const touchStartY = useRef(0);
  const touchOffsetY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        setScrollTop(container.scrollTop);
        setContainerHeight(container.clientHeight);
        rafRef.current = null;
      });
    };

    const handleResize = () => {
      setContainerHeight(container.clientHeight);
    };

    setScrollTop(container.scrollTop);
    setContainerHeight(container.clientHeight);

    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Load more when near bottom
  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore) return;
    const scrollBottom = scrollTop + containerHeight;
    const totalHeight = items.length * itemHeight;
    if (totalHeight - scrollBottom < LOAD_MORE_THRESHOLD) {
      onLoadMore();
    }
  }, [scrollTop, containerHeight, items.length, itemHeight, onLoadMore, hasMore, isLoadingMore]);

  // Pull-to-refresh touch handlers
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!onRefresh || isRefreshing) return;
      if (containerRef.current && containerRef.current.scrollTop <= 0) {
        touchStartY.current = e.touches[0].clientY;
        touchOffsetY.current = 0;
      }
    },
    [onRefresh, isRefreshing],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!onRefresh || isRefreshing) return;
      if (touchStartY.current === 0) return;
      const currentY = e.touches[0].clientY;
      const diff = currentY - touchStartY.current;
      if (diff > 0) {
        touchOffsetY.current = diff * 0.4; //阻尼系数
        setPullDistance(touchOffsetY.current);
      }
    },
    [onRefresh, isRefreshing],
  );

  const handleTouchEnd = useCallback(() => {
    if (!onRefresh || isRefreshing) return;
    if (pullDistance > 60) {
      onRefresh();
    }
    touchStartY.current = 0;
    touchOffsetY.current = 0;
    setPullDistance(0);
  }, [onRefresh, isRefreshing, pullDistance]);

  const { startIdx, visibleItems, totalHeight, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(items.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan);
    return {
      startIdx: start,
      endIdx: end,
      visibleItems: items.slice(start, end),
      totalHeight: items.length * itemHeight,
      offsetY: start * itemHeight,
    };
  }, [scrollTop, containerHeight, items, itemHeight, overscan]);

  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto overflow-x-hidden ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ overscrollBehavior: "contain" }}
    >
      {/* Pull-to-refresh indicator */}
      {onRefresh && (
        <div
          className="flex items-center justify-center transition-all duration-200 overflow-hidden"
          style={{
            height: Math.min(pullDistance, 80),
            opacity: Math.min(pullDistance / 40, 1),
          }}
        >
          {isRefreshing ? (
            <div className="flex items-center gap-2 text-sm text-[var(--color-bamboo)]">
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span>刷新中…</span>
            </div>
          ) : (
            <span className="text-sm text-[var(--color-ink-ghost)]">
              {pullDistance > 60 ? "释放刷新" : "下拉刷新"}
            </span>
          )}
        </div>
      )}

      <div style={{ position: "relative", height: totalHeight + (isRefreshing ? 80 : 0) }}>
        {/* Visible items */}
        {visibleItems.map((item, i) => {
          const index = startIdx + i;
          return (
            <div
              key={getKey(item, index)}
              style={{
                position: "absolute",
                top: 0,
                transform: `translateY(${offsetY + i * itemHeight}px)`,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}

        {/* Load more indicator */}
        {(hasMore || isLoadingMore) && (
          <div
            className="flex items-center justify-center py-4"
            style={{
              position: "absolute",
              top: totalHeight,
              left: 0,
              right: 0,
            }}
          >
            {isLoadingMore ? (
              <div className="flex items-center gap-2 text-sm text-[var(--color-bamboo)]">
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <span>加载更多…</span>
              </div>
            ) : (
              <span className="text-sm text-[var(--color-ink-ghost)]">上拉加载更多</span>
            )}
          </div>
        )}

        {/* All loaded indicator */}
        {!hasMore && items.length > 0 && (
          <div
            className="flex items-center justify-center py-4 text-sm text-[var(--color-ink-ghost)]"
            style={{
              position: "absolute",
              top: totalHeight,
              left: 0,
              right: 0,
            }}
          >
            <span>已加载全部</span>
          </div>
        )}
      </div>
    </div>
  );
}
