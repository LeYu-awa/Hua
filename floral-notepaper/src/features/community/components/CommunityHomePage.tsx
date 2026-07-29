import { useEffect, useCallback, useRef } from "react";
import { useCommunityStore } from "../stores/useCommunityStore";
import { TopNavBar } from "./TopNavBar";
import { CategoryBar } from "./CategoryBar";
import { SortSwitcher } from "./SortSwitcher";
import { ArticleFeedCard } from "./ArticleFeedCard";
import { VirtualList } from "./VirtualList";
import { LongPressMenu } from "./LongPressMenu";
import { BottomTabBar } from "./BottomTabBar";
import { ArticleDetailPage } from "../pages/ArticleDetailPage";
import type { CommunityArticle, BottomTab } from "../types";

/* 卡片估算高度（含间距）：标题 ~50 + 摘要 ~44 + 封面图 ~340 + 作者行 ~32 + 互动栏 ~40 + padding ~24 = ~530px */
const CARD_HEIGHT = 560;

export function CommunityHomePage() {
  const initialized = useRef(false);

  const {
    categories,
    articles,
    filters,
    isLoading,
    isLoadingMore,
    isRefreshing,
    hasMore,
    showDetail,
    selectedArticle,
    showSearch,
    searchQuery,
    longPressArticle,
    longPressX,
    longPressY,
    loadCategories,
    setCategory,
    setSort,
    loadArticles,
    loadMore,
    refresh,
    toggleLikeArticle,
    toggleBookmarkArticle,
    markNotInterested,
    addToReadLater,
    openDetail,
    closeDetail,
    openLongPress,
    closeLongPress,
    setSearchQuery,
    setShowSearch,
  } = useCommunityStore();

  /* 初始化 */
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadCategories();
      loadArticles();
    }
  }, [loadCategories, loadArticles]);

  /* 分享 */
  const handleShare = useCallback((id: string) => {
    const article = articles.find((a) => a.id === id);
    if (!article) return;
    // 模拟分享：未来接入微信/系统原生分享
    if (navigator.share) {
      navigator.share({
        title: article.title,
        text: article.summary,
        url: window.location.href,
      }).catch(() => {});
    } else {
      // fallback: 复制链接
      navigator.clipboard.writeText(article.title + " — " + window.location.href).catch(() => {});
    }
  }, [articles]);

  /* 底部 Tab 切换 */
  const handleBottomTabChange = useCallback((tab: BottomTab) => {
    if (tab === "write") {
      // 未来：跳转到写文章页面
    } else if (tab === "profile") {
      // 未来：跳转到个人主页
    }
  }, []);

  /* 搜索过滤 */
  const filteredArticles = searchQuery.trim()
    ? articles.filter(
        (a) =>
          a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.summary.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : articles;

  /* 渲染单篇文章卡片 */
  const renderArticleCard = useCallback(
    (article: CommunityArticle) => (
      <div key={article.id} className="px-4">
        <ArticleFeedCard
          article={article}
          onLike={toggleLikeArticle}
          onBookmark={toggleBookmarkArticle}
          onShare={handleShare}
          onLongPress={(a, x, y) => openLongPress(a, x, y)}
          onClick={openDetail}
        />
      </div>
    ),
    [toggleLikeArticle, toggleBookmarkArticle, handleShare, openLongPress, openDetail],
  );

  return (
    <div className="h-full flex flex-col bg-[var(--color-paper)] relative overflow-hidden">
      {/* 顶部导航 */}
      <TopNavBar
        showSearch={showSearch}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onToggleSearch={() => setShowSearch(!showSearch)}
      />

      {/* 分类栏 + 排序切换（搜索模式下隐藏） */}
      {!showSearch && (
        <div className="flex-shrink-0 px-4 pt-1 pb-1.5 bg-[var(--color-cloud)] border-b border-[var(--color-paper-deep)]">
          <CategoryBar
            categories={categories}
            activeId={filters.categoryId}
            onSelect={setCategory}
          />
          <div className="flex justify-end mt-1">
            <SortSwitcher active={filters.sort} onChange={setSort} />
          </div>
        </div>
      )}

      {/* 加载状态：首屏加载 */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[var(--color-bamboo)] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[var(--color-ink-ghost)]">正在为您推荐优质内容...</span>
          </div>
        </div>
      )}

      {/* 文章列表（虚拟滚动） */}
      {!isLoading && (
        <div className="flex-1 min-h-0">
          <VirtualList
            items={filteredArticles}
            itemHeight={CARD_HEIGHT}
            renderItem={(item) => renderArticleCard(item)}
            getKey={(item) => item.id}
            overscan={3}
            onLoadMore={loadMore}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onRefresh={refresh}
            isRefreshing={isRefreshing}
            className="h-full"
          />

          {/* 无数据提示 */}
          {filteredArticles.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-ink-ghost)] gap-3">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-40">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span className="text-sm">暂无相关文章</span>
            </div>
          )}
        </div>
      )}

      {/* 底部 Tab 栏 */}
      <div className="flex-shrink-0">
        <BottomTabBar active="home" onChange={handleBottomTabChange} />
      </div>

      {/* 长按菜单 */}
      <LongPressMenu
        article={longPressArticle}
        x={longPressX}
        y={longPressY}
        onClose={closeLongPress}
        onReadLater={addToReadLater}
        onNotInterested={markNotInterested}
      />

      {/* 文章详情页（覆盖层） */}
      {showDetail && selectedArticle && (
        <ArticleDetailPage
          article={selectedArticle}
          onClose={closeDetail}
          onLike={toggleLikeArticle}
          onBookmark={toggleBookmarkArticle}
        />
      )}
    </div>
  );
}
